"""Course Architect Agent：生成并校验课程设计架构。"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any, Generator

from lib.minimax import MiniMaxClient, parse_enforced_json, parse_json_response
from lib.minimax_agent import AgentClient
from lib.structured_output import plan_response_format
from lib.tools.memory_tools import MEMORY_SEARCH_POLICY, MEMORY_SEARCH_TOOL, create_memory_search
from lib.tools.search_tools import SEARCH_TOOLS, TOOL_FUNCTIONS
from prompts import build_prompt
from schemas.course_architecture import (
    COURSE_CHAPTERS_JSON_SCHEMA,
    COURSE_META_JSON_SCHEMA,
    CourseArchitecture,
    CourseArchitectureMeta,
    CourseChapterPlan,
    validate_course_architecture,
    validate_course_chapters,
)
from services.evidence_store import task_evidence_coverage
from services.memory_context_v4 import wrap_untrusted_context
from services.search_evidence import format_coverage_hint, format_search_decision_policy

PROMPT_VERSION = "course-architect-v2-two-stage"
ARCHITECT_REASONING_EFFORT = os.getenv("ARCHITECT_REASONING_EFFORT", "none").strip() or None
ARCHITECT_CHAPTERS_MAX_TOKENS = int(os.getenv("ARCHITECT_CHAPTERS_MAX_TOKENS", "6000"))
ARCHITECT_META_MAX_TOKENS = int(os.getenv("ARCHITECT_META_MAX_TOKENS", "8000"))


def build_course_architect_prompt(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    memory_context: dict[str, Any] | None = None,
    evidence: str | None = None,
    sources: list[dict[str, Any]] | None = None,
    allow_search: bool = True,
) -> str:
    """兼容入口：默认返回第一阶段章节 Prompt。"""
    return build_course_architect_chapters_prompt(
        topic,
        outline,
        learner,
        memory_context,
        evidence,
        sources,
        allow_search,
    )


def _prompt_context(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    memory_context: dict[str, Any] | None,
    evidence: str | None,
    sources: list[dict[str, Any]] | None,
) -> dict[str, str]:
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
    return {
        "topic": wrap_untrusted_context("learning_request", topic),
        "outline_section": wrap_untrusted_context("outline", outline),
        "memory_section": wrap_untrusted_context("learner_memory", memory_payload),
        "evidence_section": evidence_section,
    }


def build_course_architect_chapters_prompt(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    memory_context: dict[str, Any] | None = None,
    evidence: str | None = None,
    sources: list[dict[str, Any]] | None = None,
    allow_search: bool = True,
    allow_memory_search: bool = False,
) -> str:
    prompt_context = _prompt_context(
        topic, outline, learner, memory_context, evidence, sources
    )
    prompt = build_prompt(
        "course_architect",
        ["chapters"],
        **prompt_context,
        search_policy=(
            format_search_decision_policy(max_searches=1)
            if allow_search
            else "本阶段已有上下文足够，不提供联网搜索工具，也不要引用未提供的来源。"
        ),
    )
    if allow_memory_search:
        prompt += "\n\n" + MEMORY_SEARCH_POLICY
    return prompt


def _split_embedded_context(
    prompt: str,
    start_tag: str,
    end_tag: str,
) -> dict[str, str]:
    """把完整 Prompt 中的动态上下文块从 system 移到 user。"""
    start = prompt.find(start_tag)
    if start < 0:
        return {"system": prompt, "user": "请完成当前阶段任务。"}
    end = prompt.find(end_tag, start)
    if end < 0:
        return {"system": prompt, "user": "请完成当前阶段任务。"}
    end += len(end_tag)
    return {
        "system": (prompt[:start] + prompt[end:]).strip(),
        "user": prompt[start:end].strip(),
    }


def build_course_architect_chapters_messages(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    memory_context: dict[str, Any] | None = None,
    evidence: str | None = None,
    sources: list[dict[str, Any]] | None = None,
    allow_search: bool = True,
    allow_memory_search: bool = False,
) -> dict[str, str]:
    parts = _split_embedded_context(
        build_course_architect_chapters_prompt(
            topic,
            outline,
            learner,
            memory_context,
            evidence,
            sources,
            allow_search=allow_search,
            allow_memory_search=allow_memory_search,
        ),
        "<input_context>",
        "</input_context>",
    )
    # B3：关键词覆盖只是提示信号，不再一票否决搜索；是否搜索由模型判断。
    coverage = task_evidence_coverage(
        {"sources": sources or []},
        topic,
        str(outline.get("learningGoal") or outline.get("learningDirection") or ""),
    )
    coverage_hint = format_coverage_hint(coverage)
    if coverage_hint:
        parts["user"] = parts["user"] + "\n\n" + coverage_hint
    return parts


def build_course_architect_meta_prompt(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    chapter_plan: CourseChapterPlan,
    memory_context: dict[str, Any] | None = None,
    evidence: str | None = None,
    sources: list[dict[str, Any]] | None = None,
) -> str:
    prompt_context = _prompt_context(
        topic, outline, learner, memory_context, evidence, sources
    )
    required_concept_ids = sorted({
        concept_id
        for chapter in chapter_plan.chapters
        for concept_id in chapter.conceptIds
        if concept_id.strip()
    })
    return build_prompt(
        "course_architect",
        ["meta"],
        **prompt_context,
        chapters_json=wrap_untrusted_context("chapters", chapter_plan.model_dump()),
        required_concept_ids="\n".join(f"- {concept_id}" for concept_id in required_concept_ids),
    )


def build_course_architect_meta_messages(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    chapter_plan: CourseChapterPlan,
    memory_context: dict[str, Any] | None = None,
    evidence: str | None = None,
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    return _split_embedded_context(
        build_course_architect_meta_prompt(
            topic,
            outline,
            learner,
            chapter_plan,
            memory_context,
            evidence,
            sources,
        ),
        "<input_context>",
        "</input_context>",
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


def build_course_architect_review_prompt(
    architecture: CourseArchitecture,
    learner: dict[str, Any],
) -> str:
    """生产与 Prompt Lab 共用的架构审查 system prompt。"""
    return build_prompt(
        "course_architect",
        ["review"],
        learner_section=_format_learner_for_review(learner),
        architecture_json=wrap_untrusted_context(
            "architecture_under_review",
            _compact_architecture_for_review(architecture),
        ),
    )


def build_course_architect_review_messages(
    architecture: CourseArchitecture,
    learner: dict[str, Any],
) -> dict[str, str]:
    return _split_embedded_context(
        build_course_architect_review_prompt(architecture, learner),
        "<input_data>",
        "</input_data>",
    )


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


def _review_strict() -> bool:
    """语义审查是否升级为硬门。

    默认软门：定向修复一次后仍不通过则记录意见并放行（与章节计划审查一致，
    LLM 语义意见不应一票否决整课）；设 ARCHITECT_REVIEW_STRICT=1 恢复硬门。
    确定性结构校验不受此开关影响，始终硬拦截。
    """
    return os.getenv("ARCHITECT_REVIEW_STRICT", "0").strip().lower() in {"1", "true", "yes"}


async def _review_course_architecture(
    client: MiniMaxClient,
    architecture: CourseArchitecture,
    learner: dict[str, Any],
) -> dict[str, Any]:
    try:
        review_messages = build_course_architect_review_messages(architecture, learner)
        messages = [
            {"role": "system", "content": review_messages["system"]},
            {"role": "user", "content": "请审查以下课程架构。\n\n" + review_messages["user"]},
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
            response = await client.chat(messages=messages, max_tokens=12000, response_format={"type": "json_object"})
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


def _chapters_response_format() -> dict:
    """章节阶段输出约束：strict schema（LLM_STRICT_JSON_SCHEMA=0 时退回 json_object）。"""
    return plan_response_format("course_chapters", COURSE_CHAPTERS_JSON_SCHEMA)


def _meta_response_format() -> dict:
    """元信息阶段输出约束：strict schema（含 nullable evidenceIds）。"""
    return plan_response_format("course_meta", COURSE_META_JSON_SCHEMA)


def _parse_chapter_plan(content: str) -> CourseChapterPlan:
    # 约束输出解析：引号修复/XML/Thinking 启发式已在本路径退役
    parsed = parse_enforced_json(content)
    candidate = parsed.get("courseChapterPlan") if isinstance(parsed, dict) else None
    return CourseChapterPlan.model_validate(candidate or parsed)


def _parse_architecture_meta(content: str) -> CourseArchitectureMeta:
    parsed = parse_enforced_json(content)
    candidate = parsed.get("courseArchitectureMeta") if isinstance(parsed, dict) else None
    return CourseArchitectureMeta.model_validate(candidate or parsed)


def _chapter_plan_issues(plan: CourseChapterPlan) -> list[str]:
    issues: list[str] = []
    if not plan.courseTopic.strip():
        issues.append("课程主题为空。")
    issues.extend(validate_course_chapters(plan.chapters))
    return issues


def _assemble_architecture(
    plan: CourseChapterPlan,
    meta: CourseArchitectureMeta,
) -> CourseArchitecture:
    return CourseArchitecture(
        architectureVersion=plan.architectureVersion,
        courseTopic=plan.courseTopic,
        thesis=meta.thesis,
        conceptGraph=meta.conceptGraph,
        chapters=plan.chapters,
        examplePolicy=meta.examplePolicy,
    )


def _response_content(response: dict[str, Any]) -> str:
    return str((response.get("choices") or [{}])[0].get("message", {}).get("content", ""))


def _call_nonstream_stage(
    client: MiniMaxClient,
    messages: list[dict[str, Any]],
    *,
    max_tokens: int,
    tools: list[dict[str, Any]] | None = None,
    max_iterations: int = 1,
    max_searches: int = 0,
    response_format: dict | None = None,
) -> str:
    """同步执行一次非流式阶段；只用于阶段内定向修复，不重生成整门课。

    response_format 透传到客户端；网关拒绝时客户端自动降级（lib/structured_output.py）。
    """
    if hasattr(client, "chat_with_tools"):
        response = client.chat_with_tools(
            messages=messages,
            tools=tools or [],
            tool_functions=TOOL_FUNCTIONS,
            max_tokens=max_tokens,
            reasoning_split=True,
            max_iterations=max_iterations,
            max_searches=max_searches,
            reasoning_effort=ARCHITECT_REASONING_EFFORT,
            response_format=response_format,
        )
        return _response_content(response)
    if hasattr(client, "_call_llm"):
        response = client._call_llm(
            messages,
            tools,
            getattr(client, "model", None),
            max_tokens,
            True,
            1,
            reasoning_effort=ARCHITECT_REASONING_EFFORT,
            response_format=response_format,
        )
        return _response_content(response)
    if hasattr(client, "chat"):
        response = asyncio.run(client.chat(messages=messages, max_tokens=max_tokens, response_format=response_format))
        return _response_content(response)
    raise RuntimeError("当前模型客户端不支持同步阶段调用")


def _chapter_messages(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    memory_context: dict[str, Any] | None,
    evidence: str | None,
    sources: list[dict[str, Any]] | None,
    allow_search: bool,
    allow_memory_search: bool = False,
) -> list[dict[str, Any]]:
    messages = build_course_architect_chapters_messages(
        topic,
        outline,
        learner,
        memory_context,
        evidence,
        sources,
        allow_search=allow_search,
        allow_memory_search=allow_memory_search,
    )
    return [
        {"role": "system", "content": messages["system"]},
        {"role": "user", "content": "请先完成这门课的章节目录设计。\n\n" + messages["user"]},
    ]


def _meta_messages(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    plan: CourseChapterPlan,
    memory_context: dict[str, Any] | None,
    evidence: str | None,
    sources: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    messages = build_course_architect_meta_messages(
        topic,
        outline,
        learner,
        plan,
        memory_context,
        evidence,
        sources,
    )
    return [
        {"role": "system", "content": messages["system"]},
        {"role": "user", "content": "请基于已确定章节补全课程元信息。\n\n" + messages["user"]},
    ]


def _repair_chapter_plan_sync(
    client: MiniMaxClient,
    base_messages: list[dict[str, Any]],
    previous_content: str,
    issues: list[str],
) -> CourseChapterPlan:
    messages = list(base_messages)
    if previous_content.strip():
        messages.append({"role": "assistant", "content": previous_content})
    messages.append({
        "role": "user",
        "content": (
            "章节目录未通过校验。只修复 chapters 阶段，输出完整且闭合的 chapters JSON；"
            "不要生成 thesis、conceptGraph 或 examplePolicy，也不要输出解释。\n"
            + "\n".join(f"- {issue}" for issue in issues)
        ),
    })
    content = _call_nonstream_stage(
        client,
        messages,
        max_tokens=ARCHITECT_CHAPTERS_MAX_TOKENS,
        response_format=_chapters_response_format(),
    )
    plan = _parse_chapter_plan(content)
    repaired_issues = _chapter_plan_issues(plan)
    if repaired_issues:
        raise ValueError("章节目录定向修复未通过：" + "；".join(repaired_issues))
    return plan


def _repair_meta_sync(
    client: MiniMaxClient,
    base_messages: list[dict[str, Any]],
    previous_content: str,
    issues: list[str],
) -> CourseArchitectureMeta:
    messages = list(base_messages)
    if previous_content.strip():
        messages.append({"role": "assistant", "content": previous_content})
    messages.append({
        "role": "user",
        "content": (
            "课程元信息未通过校验。章节已固定，不得改动；只修复 thesis、conceptGraph 与 examplePolicy，"
            "输出完整且闭合的 JSON，不要输出解释。\n"
            + "\n".join(f"- {issue}" for issue in issues)
        ),
    })
    content = _call_nonstream_stage(
        client,
        messages,
        max_tokens=ARCHITECT_META_MAX_TOKENS,
        response_format=_meta_response_format(),
    )
    return _parse_architecture_meta(content)


def _generate_meta_with_repair(
    client: MiniMaxClient,
    messages: list[dict[str, Any]],
    plan: CourseChapterPlan,
) -> tuple[CourseArchitectureMeta, CourseArchitecture, str]:
    content = _call_nonstream_stage(
        client,
        messages,
        max_tokens=ARCHITECT_META_MAX_TOKENS,
        response_format=_meta_response_format(),
    )
    try:
        meta = _parse_architecture_meta(content)
    except Exception as exc:  # noqa: BLE001
        issues = [f"课程元信息 JSON 解析失败：{exc}"]
    else:
        architecture = _assemble_architecture(plan, meta)
        issues = validate_course_architecture(architecture)
        if not issues:
            return meta, architecture, content

    print(f"[Course Architect] 元信息定向修复，不重生成章节：{issues}")
    meta = _repair_meta_sync(client, messages, content, issues)
    architecture = _assemble_architecture(plan, meta)
    repaired_issues = validate_course_architecture(architecture)
    if repaired_issues:
        raise ValueError("课程元信息定向修复未通过：" + "；".join(repaired_issues))
    return meta, architecture, content


_JSON_STRING_FIELD_TEMPLATE = r'"{field}"\s*:\s*"((?:\\.|[^"\\])*)"'


def _extract_json_string_field(content: str, field: str) -> str | None:
    """从仍在增长的 JSON 文本里提取一个已闭合的字符串字段。"""
    match = re.search(_JSON_STRING_FIELD_TEMPLATE.format(field=re.escape(field)), content)
    if not match:
        return None
    try:
        return json.loads(f'"{match.group(1)}"')
    except json.JSONDecodeError:
        return None


def _complete_chapter_objects(content: str) -> list[dict[str, Any]]:
    """提取 chapters 数组中已经闭合的章节对象，不要求整个 JSON 已闭合。"""
    key_index = content.find('"chapters"')
    if key_index < 0:
        return []
    array_start = content.find("[", key_index)
    if array_start < 0:
        return []

    objects: list[dict[str, Any]] = []
    in_string = False
    escaped = False
    depth = 0
    start = -1
    for index in range(array_start + 1, len(content)):
        char = content[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            if depth == 0:
                start = index
            depth += 1
        elif char == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    raw = content[start:index + 1]
                    try:
                        parsed = json.loads(raw)
                    except json.JSONDecodeError:
                        pass
                    else:
                        if isinstance(parsed, dict):
                            objects.append(parsed)
                    start = -1
        elif char == "]" and depth == 0:
            break
    return objects


def architecture_chapter_to_node(chapter: dict[str, Any], index: int) -> dict[str, Any]:
    """把已闭合的章节对象转换成前端 TOC node。"""
    return {
        "index": index,
        "title": str(chapter.get("title") or ""),
        "description": f"{chapter.get('roleInCourse', '')}。本章交付：{chapter.get('deliverable', '')}",
    }


def _review_issues(
    client: MiniMaxClient,
    architecture: CourseArchitecture,
    learner: dict[str, Any],
    review_mode: str | None,
) -> tuple[bool, bool, bool, list[str]]:
    if not should_review_architecture(architecture, learner, review_mode):
        return True, True, False, []
    review = asyncio.run(_review_course_architecture(client, architecture, learner))
    unavailable = bool(review.get("reviewUnavailable"))
    if review["passed"]:
        return True, False, unavailable, []
    issues = [
        f"[{item.get('code', 'QUALITY')}] {item.get('message', '')}"
        for item in (review.get("issues") or [])
    ] or ["课程架构语义审查未通过"]
    repair_notes = str(review.get("repairNotes") or "").strip()
    if repair_notes:
        issues.append(repair_notes)
    return False, False, unavailable, issues


def _generate_chapter_plan_sync(
    client: MiniMaxClient,
    chapter_messages: list[dict[str, Any]],
    allow_search: bool,
) -> tuple[CourseChapterPlan, str]:
    content = _call_nonstream_stage(
        client,
        chapter_messages,
        max_tokens=ARCHITECT_CHAPTERS_MAX_TOKENS,
        tools=SEARCH_TOOLS if allow_search else None,
        max_iterations=2 if allow_search else 1,
        max_searches=1 if allow_search else 0,
        response_format=_chapters_response_format(),
    )
    try:
        plan = _parse_chapter_plan(content)
    except Exception as exc:  # noqa: BLE001
        issues = [f"章节目录 JSON 解析失败：{exc}"]
    else:
        issues = _chapter_plan_issues(plan)
        if not issues:
            return plan, content

    print(f"[Course Architect] 章节目录定向修复：{issues}")
    return _repair_chapter_plan_sync(client, chapter_messages, content, issues), content


def _generate_course_architecture_sync(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    memory_context: dict[str, Any] | None,
    evidence: str | None,
    sources: list[dict[str, Any]] | None,
    client: MiniMaxClient,
    review_mode: str | None,
    allow_search: bool,
) -> dict[str, Any]:
    started_at = time.monotonic()
    chapter_messages = _chapter_messages(
        topic, outline, learner, memory_context, evidence, sources, allow_search
    )
    plan, _ = _generate_chapter_plan_sync(client, chapter_messages, allow_search)
    print(
        f"[Course Architect] 章节目录完成 chapters={len(plan.chapters)} "
        f"elapsed={int((time.monotonic() - started_at) * 1000)}ms"
    )

    meta_messages = _meta_messages(
        topic, outline, learner, plan, memory_context, evidence, sources
    )
    _meta, architecture, _ = _generate_meta_with_repair(
        client, meta_messages, plan
    )
    print(
        f"[Course Architect] 元信息完成 elapsed={int((time.monotonic() - started_at) * 1000)}ms"
    )

    soft_review_issues: list[str] = []
    review_passed, review_skipped, review_unavailable, review_issues = _review_issues(
        client, architecture, learner, review_mode
    )
    if not review_passed:
        print(f"[Course Architect] 审查失败，定向修复章节：{review_issues}")
        plan = _repair_chapter_plan_sync(
            client, chapter_messages, json.dumps(plan.model_dump(), ensure_ascii=False), review_issues
        )
        meta_messages = _meta_messages(
            topic, outline, learner, plan, memory_context, evidence, sources
        )
        _meta, architecture, _ = _generate_meta_with_repair(
            client, meta_messages, plan
        )
        review_passed, review_skipped, review_unavailable, reassessment_issues = _review_issues(
            client, architecture, learner, review_mode
        )
        if not review_passed:
            final_issues = reassessment_issues or review_issues
            if _review_strict():
                raise ValueError("课程架构审查未通过：" + "；".join(final_issues))
            print(f"[Course Architect] 语义审查未通过，软门放行（ARCHITECT_REVIEW_STRICT=1 可改硬门）：{final_issues}")
            soft_review_issues = final_issues

    print(
        f"[Course Architect] 两阶段架构完成 reviewSkipped={review_skipped} "
        f"elapsed={int((time.monotonic() - started_at) * 1000)}ms"
    )
    return {
        "architecture": architecture.model_dump(),
        "issues": [],
        "reviewIssues": soft_review_issues,
        "reviewUnavailable": review_unavailable,
        "reviewSkipped": review_skipped,
        "promptVersion": PROMPT_VERSION,
        "modelVersion": getattr(client, "model", "unknown"),
    }


async def generate_course_architecture(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    memory_context: dict[str, Any] | None = None,
    evidence: str | None = None,
    sources: list[dict[str, Any]] | None = None,
    client: MiniMaxClient | None = None,
    review_mode: str | None = None,
    allow_search: bool = True,
) -> dict[str, Any]:
    """非流式兼容入口：章节目录与元信息仍分两阶段生成。"""
    client = client or AgentClient()
    return await asyncio.to_thread(
        _generate_course_architecture_sync,
        topic,
        outline,
        learner,
        memory_context,
        evidence,
        sources,
        client,
        review_mode,
        allow_search,
    )


def _emit_plan_nodes(plan: CourseChapterPlan) -> Generator[dict[str, Any], None, None]:
    for index, chapter in enumerate(plan.chapters, start=1):
        chapter_dict = chapter.model_dump()
        node = architecture_chapter_to_node(chapter_dict, index)
        if node["title"]:
            yield {"type": "node", "node": node}


def stream_course_architecture(
    topic: str,
    outline: dict[str, Any],
    learner: dict[str, Any],
    memory_context: dict[str, Any] | None = None,
    evidence: str | None = None,
    sources: list[dict[str, Any]] | None = None,
    client: MiniMaxClient | None = None,
    review_mode: str | None = None,
    allow_search: bool = True,
    account_id: str | None = None,
) -> Generator[dict[str, Any], None, None]:
    """两阶段流式架构：先逐章输出目录，再定向补齐课程元信息。"""
    started_at = time.monotonic()
    client = client or AgentClient()
    chapter_messages = _chapter_messages(
        topic, outline, learner, memory_context, evidence, sources, allow_search,
        allow_memory_search=bool(account_id),
    )
    raw_content = ""
    emitted_chapters = 0
    emitted_course_name = False
    finish_reason: str | None = None

    plan: CourseChapterPlan | None = None
    chapter_issues: list[str] = []

    if hasattr(client, "stream_chat_with_tools"):
        try:
            print(f"[Course Architect] 第一阶段流式生成章节目录：{topic}")
            tools = list(SEARCH_TOOLS) if allow_search else []
            tool_functions = dict(TOOL_FUNCTIONS)
            if account_id:
                tools.append(MEMORY_SEARCH_TOOL)
                tool_functions["memory_search"] = create_memory_search(account_id)
            for event in client.stream_chat_with_tools(
                messages=chapter_messages,
                tools=tools,
                tool_functions=tool_functions,
                max_tokens=ARCHITECT_CHAPTERS_MAX_TOKENS,
                reasoning_split=True,
                max_iterations=2 if tools else 1,
                max_searches=1 if allow_search else 0,
                reasoning_effort=ARCHITECT_REASONING_EFFORT,
                response_format=_chapters_response_format(),
            ):
                event_type = event.get("type")
                if event_type == "tool_call":
                    raw_content = ""
                    emitted_chapters = 0
                    emitted_course_name = False
                    print(f"[Course Architect] 章节阶段调用工具：{event.get('tool')}")
                    continue
                if event_type == "done":
                    finish_reason = event.get("finish_reason")
                    continue
                if event_type != "content_delta":
                    continue

                raw_content += str(event.get("content") or "")
                if not emitted_course_name:
                    course_name = _extract_json_string_field(raw_content, "courseTopic")
                    if course_name:
                        emitted_course_name = True
                        yield {"type": "course_name", "value": course_name}

                chapters = _complete_chapter_objects(raw_content)
                for chapter in chapters[emitted_chapters:]:
                    emitted_chapters += 1
                    node = architecture_chapter_to_node(chapter, emitted_chapters)
                    if node["title"]:
                        print(
                            f"[Course Architect] node={emitted_chapters} "
                            f"elapsed={int((time.monotonic() - started_at) * 1000)}ms"
                        )
                        yield {"type": "node", "node": node}
                        if emitted_chapters == 1:
                            yield {"type": "progress", "message": "章节骨架正在生成，先展示已完成的章节…"}
            print(
                f"[Course Architect] 章节目录流结束 nodes={emitted_chapters} "
                f"finishReason={finish_reason or 'unknown'} "
                f"elapsed={int((time.monotonic() - started_at) * 1000)}ms"
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[Course Architect] 章节目录流失败：{exc}")
            chapter_issues = [str(exc)]

    if raw_content.strip():
        try:
            plan = _parse_chapter_plan(raw_content)
            chapter_issues = _chapter_plan_issues(plan)
        except Exception as exc:  # noqa: BLE001
            chapter_issues = [f"章节目录 JSON 解析失败：{exc}"]

    if plan is None or chapter_issues:
        print(f"[Course Architect] 章节目录需要定向修复：{chapter_issues}")
        yield {"type": "progress", "message": "章节目录需要补齐，正在修复结构…"}
        plan = _repair_chapter_plan_sync(
            client, chapter_messages, raw_content, chapter_issues or ["章节目录生成失败"]
        )
        yield {"type": "course_name", "value": plan.courseTopic}
        yield from _emit_plan_nodes(plan)

    print(
        f"[Course Architect] 章节阶段校验完成 chapters={len(plan.chapters)} "
        f"elapsed={int((time.monotonic() - started_at) * 1000)}ms"
    )
    yield {
        "type": "progress",
        "message": "章节结构已确定，正在定义课程目标、概念关系与例子策略…",
    }

    meta_messages = _meta_messages(
        topic, outline, learner, plan, memory_context, evidence, sources
    )
    try:
        meta, architecture, _ = _generate_meta_with_repair(client, meta_messages, plan)
    except Exception as exc:  # noqa: BLE001
        print(f"[Course Architect] 元信息阶段失败：{exc}")
        raise

    print(
        f"[Course Architect] 元信息阶段完成 elapsed={int((time.monotonic() - started_at) * 1000)}ms"
    )

    soft_review_issues: list[str] = []
    review_passed, review_skipped, review_unavailable, review_issues = _review_issues(
        client, architecture, learner, review_mode
    )
    if not review_passed:
        yield {"type": "progress", "message": "正在按审查意见调整课程设计…"}
        print(f"[Course Architect] 审查失败，定向修复章节：{review_issues}")
        plan = _repair_chapter_plan_sync(
            client,
            chapter_messages,
            json.dumps(plan.model_dump(), ensure_ascii=False),
            review_issues,
        )
        yield {"type": "course_name", "value": plan.courseTopic}
        yield from _emit_plan_nodes(plan)
        meta_messages = _meta_messages(
            topic, outline, learner, plan, memory_context, evidence, sources
        )
        meta, architecture, _ = _generate_meta_with_repair(client, meta_messages, plan)
        review_passed, review_skipped, review_unavailable, reassessment_issues = _review_issues(
            client, architecture, learner, review_mode
        )
        if not review_passed:
            final_issues = reassessment_issues or review_issues
            if _review_strict():
                raise ValueError("课程架构审查未通过：" + "；".join(final_issues))
            print(f"[Course Architect] 语义审查未通过，软门放行（ARCHITECT_REVIEW_STRICT=1 可改硬门）：{final_issues}")
            soft_review_issues = final_issues

    print(
        f"[Course Architect] 流式两阶段架构完成 reviewSkipped={review_skipped} "
        f"elapsed={int((time.monotonic() - started_at) * 1000)}ms"
    )
    result = {
        "architecture": architecture.model_dump(),
        "issues": [],
        "reviewIssues": soft_review_issues,
        "reviewUnavailable": review_unavailable,
        "reviewSkipped": review_skipped,
        "promptVersion": PROMPT_VERSION,
        "modelVersion": getattr(client, "model", "unknown"),
    }
    yield {"type": "course_description", "value": architecture.thesis.targetCapability}
    yield {"type": "result", "result": result}


def generate_course_architecture_sync(*args, **kwargs) -> dict[str, Any]:
    """供同步 SSE generator / 脚本调用的兼容入口。"""
    return asyncio.run(generate_course_architecture(*args, **kwargs))
