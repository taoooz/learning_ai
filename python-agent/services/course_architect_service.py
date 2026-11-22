"""Course Architect Agent：生成并校验课程设计架构。"""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

from lib.minimax import MiniMaxClient, parse_json_response
from lib.minimax_agent import AgentClient
from lib.tools.search_tools import SEARCH_TOOLS, TOOL_FUNCTIONS
from prompts import build_prompt
from schemas.course_architecture import CourseArchitecture, validate_course_architecture
from services.memory_context_v4 import wrap_untrusted_context
from services.search_evidence import format_search_decision_policy

PROMPT_VERSION = "course-architect-v1"


def build_course_architect_prompt(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    memory_context: dict[str, Any] | None = None,
    evidence: str | None = None,
    sources: list[dict[str, Any]] | None = None,
) -> str:
    memory_payload = {
        "learner": learner,
        "memoryContext": memory_context or {},
    }
    source_lines = "\n".join(
        f"- {item.get('title', '')}（{item.get('url', '')}）"
        for item in (sources or [])
    )
    evidence_section = "无"
    if evidence:
        evidence_section = f"{evidence}\n\n来源：\n{source_lines}"
    return build_prompt(
        "course_architect",
        ["system"],
        topic=topic,
        outline_section=wrap_untrusted_context("outline", outline),
        memory_section=wrap_untrusted_context("learner_memory", memory_payload),
        evidence_section=evidence_section,
        search_policy=format_search_decision_policy(max_searches=2),
    )


def _format_learner_for_review(learner: dict[str, Any]) -> str:
    lines = [f"- 当前水平：{learner.get('estimatedLevel', 'unknown')}"]
    for label, key in (
        ("背景", "backgroundSummary"),
        ("已掌握", "skipBasics"),
        ("可能缺口", "likelyGaps"),
    ):
        value = learner.get(key)
        if value:
            rendered = "、".join(value) if isinstance(value, list) else str(value)
            lines.append(f"- {label}：{rendered}")
    return "\n".join(lines)


def _compact_architecture_for_review(architecture: CourseArchitecture) -> dict[str, Any]:
    """审查只看章节级设计风险，概念引用与覆盖由确定性校验负责。"""
    return {
        "courseTopic": architecture.courseTopic,
        "thesis": {
            "targetCapability": architecture.thesis.targetCapability,
            "learningDelta": architecture.thesis.learningDelta,
            "nonGoals": architecture.thesis.nonGoals,
        },
        "chapters": [
            {
                "chapterId": chapter.chapterId,
                "title": chapter.title,
                "roleInCourse": chapter.roleInCourse,
                "deliverable": chapter.deliverable,
                "assessmentMode": chapter.assessmentMode,
            }
            for chapter in architecture.chapters
        ],
    }


def _text_terms(text: str) -> set[str]:
    normalized = text.strip().lower()
    terms = set(re.findall(r"[a-z0-9_]+", normalized))
    cjk = "".join(re.findall(r"[一-鿿]", normalized))
    terms.update(cjk[index:index + 2] for index in range(max(0, len(cjk) - 1)))
    return terms


def _text_similarity(left: str, right: str) -> float:
    left_terms = _text_terms(left)
    right_terms = _text_terms(right)
    if not left_terms or not right_terms:
        return 0.0
    return len(left_terms & right_terms) / max(1, len(left_terms | right_terms))


def should_review_architecture(
    architecture: CourseArchitecture,
    learner: dict[str, Any],
    review_mode: str | None = None,
) -> bool:
    """仅在高风险架构上触发 LLM 审查；默认结构合法即跳过。"""
    mode = (review_mode or os.getenv("ARCHITECT_REVIEW_MODE", "auto")).lower()
    if mode == "off":
        return False
    if mode == "always":
        return True

    if len(architecture.chapters) > 7:
        return True
    if sum(1 for chapter in architecture.chapters if len(chapter.conceptIds) == 1) >= 6:
        return True

    chapter_roles = [f"{chapter.title} {chapter.roleInCourse} {chapter.deliverable}" for chapter in architecture.chapters]
    for index, left in enumerate(chapter_roles):
        for right in chapter_roles[index + 1:]:
            if _text_similarity(left, right) >= 0.62:
                return True

    concept_sets = [frozenset(chapter.conceptIds) for chapter in architecture.chapters]
    if len(concept_sets) != len(set(concept_sets)):
        return True

    skip_basics = {
        str(item).strip().lower()
        for item in (learner.get("skipBasics") or [])
        if str(item).strip()
    }
    for concept in architecture.conceptGraph:
        if concept.targetDepth not in {"skip", "refresh"} and concept.label.strip().lower() in skip_basics:
            return True
    return False


async def _review_course_architecture(
    client: MiniMaxClient,
    architecture: CourseArchitecture,
    learner: dict[str, Any],
) -> dict[str, Any]:
    try:
        messages = [
            {
                "role": "system",
                "content": build_prompt(
                    "course_architect",
                    ["review"],
                    learner_section=_format_learner_for_review(learner),
                    architecture_json=json.dumps(_compact_architecture_for_review(architecture), ensure_ascii=False, indent=2),
                ),
            },
            {"role": "user", "content": "请审查这份课程架构。"},
        ]
        if hasattr(client, "_call_llm"):
            response = await asyncio.to_thread(
                client._call_llm,
                messages,
                None,
                getattr(client, "model", None),
                12000,
                True,
                1,
            )
        else:
            response = await client.chat(messages=messages, max_tokens=12000)
        content = (response.get("choices") or [{}])[0].get("message", {}).get("content", "")
        parsed = parse_json_response(content)
        if not isinstance(parsed, dict) or not isinstance(parsed.get("passed"), bool):
            raise ValueError("review schema invalid")
        issues = parsed.get("issues") if isinstance(parsed.get("issues"), list) else []
        return {
            "passed": parsed["passed"],
            "issues": [item for item in issues if isinstance(item, dict)],
            "repairNotes": str(parsed.get("repairNotes") or ""),
            "reviewUnavailable": False,
        }
    except Exception as exc:  # noqa: BLE001 审查不可用时记录并放行结构合法架构
        print(f"[Course Architect] 语义审查不可用：{exc}")
        return {"passed": True, "issues": [], "repairNotes": "", "reviewUnavailable": True}


def _parse_architecture(content: str) -> CourseArchitecture:
    parsed = parse_json_response(content)
    candidate = parsed.get("courseArchitecture") if isinstance(parsed, dict) else None
    return CourseArchitecture.model_validate(candidate or parsed)


async def generate_course_architecture(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    memory_context: dict[str, Any] | None = None,
    evidence: str | None = None,
    sources: list[dict[str, Any]] | None = None,
    client: MiniMaxClient | None = None,
    review_mode: str | None = None,
) -> dict[str, Any]:
    """生成课程架构；结构失败时让模型修复一次，返回最终校验结果。"""
    client = client or AgentClient()
    system_prompt = build_course_architect_prompt(
        topic,
        outline,
        learner,
        memory_context,
        evidence,
        sources,
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "请完成这门课的架构设计。"},
    ]

    response: dict[str, Any] = {}
    architecture: CourseArchitecture | None = None
    issues: list[str] = []
    review_unavailable = False
    review_skipped = False
    for attempt in range(2):
        if hasattr(client, "chat_with_tools"):
            response = await asyncio.to_thread(
                client.chat_with_tools,
                messages=messages,
                tools=SEARCH_TOOLS,
                tool_functions=TOOL_FUNCTIONS,
                max_tokens=12000,
                reasoning_split=True,
                max_iterations=3,
                max_searches=2,
            )
        else:
            response = await client.chat(messages=messages, max_tokens=12000)

        content = (response.get("choices") or [{}])[0].get("message", {}).get("content", "")
        try:
            architecture = _parse_architecture(content)
        except Exception as exc:
            issues = [f"架构 JSON 解析失败：{exc}"]
        else:
            issues = validate_course_architecture(architecture)
            if not issues:
                if not should_review_architecture(architecture, learner, review_mode):
                    review_skipped = True
                    break
                review = await _review_course_architecture(client, architecture, learner)
                review_unavailable = bool(review.get("reviewUnavailable"))
                if review["passed"]:
                    break
                review_issues = review.get("issues") or []
                issues = [
                    f"[{item.get('code', 'QUALITY')}] {item.get('message', '')}"
                    for item in review_issues
                ] or ["课程架构语义审查未通过"]
                custom_notes = review.get("repairNotes") or ""
                if custom_notes:
                    issues.append(custom_notes)

        messages.append({"role": "assistant", "content": content})
        messages.append({
            "role": "user",
            "content": (
                "架构未通过校验。请修复以下问题并重新输出完整 JSON：\n"
                + "\n".join(f"- {issue}" for issue in issues)
            ),
        })

    if architecture is None:
        raise ValueError("课程架构生成失败：" + "；".join(issues))

    return {
        "architecture": architecture.model_dump(),
        "issues": issues,
        "reviewUnavailable": review_unavailable,
        "reviewSkipped": review_skipped,
        "promptVersion": PROMPT_VERSION,
        "modelVersion": getattr(client, "model", "unknown"),
    }


def generate_course_architecture_sync(*args, **kwargs) -> dict[str, Any]:
    """供同步 SSE generator / 脚本调用的兼容入口。"""
    return asyncio.run(generate_course_architecture(*args, **kwargs))
