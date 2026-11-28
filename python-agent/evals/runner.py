"""离线全链路 runner：golden set → architect → chapter_plan → 抽样任务正文 → checkpoints → trace。

用法（在 python-agent 目录下）：
    python -m evals.runner GOLDEN.json [--specs id1,id2] [--max-tasks 2]
        [--max-chapters N] [--run-id RUN] [--trace-dir DIR] [--dry-run]
        [--no-search] [--no-checkpoints] [--env-file PATH] [--evidence-dir DIR]

- golden set 宽松契约：JSON 列表，每条含 topic（必需）、id/difficulty/
  learningGoal/learnerPositioning/intentType（可选，缺省给默认值）。
- 真实调用复用现有服务函数（generate_course_architecture /
  generate_chapter_plan / stream_task_events），不重写生成逻辑。
- --dry-run 不调 LLM：用内置 DryRunClient 走真实服务与真实 trace hook，
  验证 blueprint 编译、请求装配、course 组装与 trace 契约完整性。
- trace 输出：EVAL_TRACE_DIR/<run_id>/<spec_id>/（契约见 evals/trace.py）。
  runner 默认把 EVAL_TRACE_DIR 设为 --trace-dir（默认 ./eval-traces）。
- 证据隔离：默认 EVIDENCE_STORE_DIR 指向 <trace_dir>/<run_id>/_evidence，
  不污染 python-agent/data；--evidence-dir 可复用已有证据库。
- --no-search：architect allow_search=False，且 DISABLE_WEB_SEARCH=1 /
  DISABLE_EVIDENCE_SEARCH=1 关闭章节/任务阶段的联网搜索（控成本）。
- checkpoints：默认每章为每个成功任务生成一道理解检查题（复用
  services/checkpoint_service.generate_checkpoint，每任务 +1 次 LLM 调用），
  写入 course.json 顶层 checkpoints 键与 stage_checkpoints_<chapterId>_* 四件套；
  --no-checkpoints 关闭该阶段。
- 阶段作用域：runner 用 eval_trace.scope(chapter_id, task_id) 包住章/任务调用，
  阶段文件展开为 stage_chapter_plan_<ch>_* / stage_search_decision_<ch>_<tid>_* /
  stage_task_content_<ch>_<tid>_*，跨章同名任务（如每章的 t1）不再互相覆盖。

blueprint 编译是 lib/learning-v2/blueprint-from-architecture.ts 的确定性
Python 移植（course-architecture-compiler-v1），映射规则与 TS 侧一致。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals import trace as eval_trace  # noqa: E402

AGENT_ROOT = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# spec 归一化（宽松契约）
# ---------------------------------------------------------------------------

DEFAULT_LEARNER: dict[str, Any] = {
    "estimatedLevel": "beginner",
    "backgroundSummary": "",
    "skipBasics": [],
    "likelyGaps": [],
    "levelConfidence": 0.8,
    "preferredExampleDomains": [],
    "personalExampleLimit": 1,
}


def normalize_spec(raw: dict, index: int) -> dict:
    topic = str(raw.get("topic") or "").strip()
    if not topic:
        raise ValueError(f"golden set 第 {index + 1} 条缺少 topic")
    learner = raw.get("learnerPositioning")
    if isinstance(learner, str):
        learner = {"backgroundSummary": learner}
    if not isinstance(learner, dict):
        learner = {}
    learner = {**DEFAULT_LEARNER, **learner}
    difficulty = raw.get("difficulty")
    raw_learner = raw.get("learnerPositioning")
    if difficulty and not (isinstance(raw_learner, dict) and raw_learner.get("estimatedLevel")):
        learner["estimatedLevel"] = difficulty
    learning_goal = str(raw.get("learningGoal") or f"完成 {topic} 的独立学习目标")
    spec = {
        "id": str(raw.get("id") or f"spec-{index + 1:02d}"),
        "topic": topic,
        "difficulty": difficulty or learner["estimatedLevel"],
        "learningGoal": learning_goal,
        "learnerPositioning": learner,
        "intentType": raw.get("intentType"),
    }
    # 保真度：权威来源与要点必须透传，否则 --seed-topic-evidence 永远拿不到 URL，
    # 计划层会在零证据下自拟分类与口径。
    for key in ("authoritativeSources", "goldenNotes"):
        if raw.get(key):
            spec[key] = raw[key]
    return spec


def build_architect_inputs(spec: dict) -> tuple[str, dict, dict, dict]:
    """与 scripts/spike_course_architecture.py 的 _build_inputs 对齐。"""
    topic = spec["topic"]
    learner = spec["learnerPositioning"]
    goal = spec["learningGoal"]
    outline = {
        "topic": topic,
        "learningDirection": goal,
        "learningGoal": goal,
        "learnerPositioning": learner,
    }
    memory = {
        "scene": "course_architecture",
        "core": {
            "goals": [{"text": goal}],
            "constraints": [],
            "activePreferences": [],
            "riskConcepts": [],
            "reviewQueue": [],
        },
        "learningState": {"conceptStates": [], "topicStates": []},
        "index": [],
        "bodies": [],
        "evidence": [],
        "fallback": "none",
    }
    return topic, outline, learner, memory


# ---------------------------------------------------------------------------
def _seed_topic_evidence(topic: str, spec: dict) -> None:
    """实验用：按 spec.authoritativeSources 抓全文，写入主题证据包。

    等价于生产里架构阶段之前已经存在的预搜结果，让计划层与生产一样有据可依。
    抓取失败不阻塞（退回空包，与生产同样处理）。
    """
    import time as _t
    from services.evidence_store import EVIDENCE_SCHEMA_VERSION, save_topic_evidence

    sources = []
    for item in (spec.get("authoritativeSources") or []):
        url = item.get("url") if isinstance(item, dict) else str(item)
        if not url:
            continue
        body = _fetch_source_text(url)
        if not body:
            print(f"[seed] 抓取失败，跳过 {url}", flush=True)
            continue
        print(f"[seed] 抓取成功 {len(body)} 字 {url}", flush=True)
        sources.append({
            "evidenceId": f"ev-{len(sources) + 1:02d}",
            "title": (item.get("title") if isinstance(item, dict) else "") or url,
            "url": url,
            "summary": body[:260],
            "excerpt": body[:8000],
            "isPrimary": True,
        })
    if not sources:
        return
    now = _t.time()
    save_topic_evidence({
        "schemaVersion": EVIDENCE_SCHEMA_VERSION,
        "topic": topic,
        "sources": sources,
        "createdAt": now,
        "expiresAt": now + 86400,
    })


def _fetch_source_text(url: str) -> str | None:
    """直抓正文（绕开搜索引擎），失败返回 None。"""
    import os
    import re as _re
    try:
        import httpx
        from lxml import html as _html
    except Exception:
        return None
    try:
        resp = httpx.get(
            url,
            proxy=os.getenv("EVIDENCE_FETCH_PROXY") or None,
            follow_redirects=True,
            timeout=20,
            headers={"User-Agent": "EvidenceBot/1.0"},
        )
        resp.raise_for_status()
        if "html" not in resp.headers.get("content-type", ""):
            return None
        doc = _html.fromstring(resp.text)
        for bad in doc.xpath("//script|//style|//nav|//header|//footer|//aside|//noscript"):
            bad.getparent().remove(bad)
        nodes = doc.xpath("//main") or doc.xpath("//article") or [doc]
        text = " ".join(nodes[0].itertext())
        text = _re.sub(r"\s+", " ", text).strip()
        return text or None
    except Exception:
        return None


# blueprint 编译（blueprint-from-architecture.ts 的 Python 移植）
# ---------------------------------------------------------------------------

BLUEPRINT_COMPILER_VERSION = "course-architecture-compiler-v1"
DEPTH_RANK = {"skip": 0, "refresh": 1, "understand": 2, "apply": 3, "transfer": 4}
_INTENT_TYPES = {"conceptual_understanding", "skill_mastery", "problem_solving", "fast_review"}


def _normalize_estimated_level(value: Any) -> str:
    if value in ("intermediate", "中级"):
        return "intermediate"
    if value in ("advanced", "高级"):
        return "advanced"
    return "beginner"


def _infer_intent_type(text: str) -> str:
    if re.search(r"复习|速成|快速|突击", text):
        return "fast_review"
    if re.search(r"解决|排障|排查|诊断|故障", text):
        return "problem_solving"
    if re.search(r"实操|动手|搭建|步骤|流程|怎么做", text):
        return "skill_mastery"
    return "conceptual_understanding"


def compile_blueprint(
    course_id: str,
    architecture: dict,
    learner: dict | None = None,
    intent_type: str | None = None,
    model_version: str | None = None,
    now: int | None = None,
) -> dict:
    """CourseArchitecture → CourseBlueprint（确定性映射，与 TS 编译器一致）。"""
    learner = learner or {}
    thesis = architecture.get("thesis") or {}
    chapters = architecture.get("chapters") or []
    concepts = {c["conceptId"]: c for c in architecture.get("conceptGraph") or []}
    example_policy = architecture.get("examplePolicy") or {}

    seen_concepts: set[str] = set()
    for concept in architecture.get("conceptGraph") or []:
        cid = concept["conceptId"]
        if cid in seen_concepts:
            raise ValueError(f"conceptId 重复：{cid}")
        seen_concepts.add(cid)
    seen_chapters: set[str] = set()
    for chapter in chapters:
        chid = chapter["chapterId"]
        if chid in seen_chapters:
            raise ValueError(f"chapterId 重复：{chid}")
        seen_chapters.add(chid)
    for chapter in chapters:
        for cid in chapter.get("conceptIds") or []:
            if cid not in concepts:
                raise ValueError(f"章节 {chapter['chapterId']} 引用了不存在的概念 {cid}")
        for prereq in chapter.get("prerequisites") or []:
            if prereq not in seen_chapters:
                raise ValueError(f"章节 {chapter['chapterId']} 引用了不存在的前置章节 {prereq}")

    course_objectives: list[dict] = []
    blueprint_chapters: list[dict] = []
    for index, chapter in enumerate(chapters):
        objective_id = f"obj-{index + 1}"
        chapter_concepts = [concepts[cid] for cid in chapter.get("conceptIds") or [] if cid in concepts]
        max_rank = max((DEPTH_RANK.get(c.get("targetDepth", ""), 0) for c in chapter_concepts), default=0)
        importance = "core" if max_rank >= DEPTH_RANK["apply"] else "supporting" if max_rank >= DEPTH_RANK["understand"] else "optional"
        assessment = chapter.get("assessmentMode") or "none"
        evidence_requirement = (
            "demonstration" if assessment == "checkpoint"
            else "self_report" if assessment == "self_report"
            else "exposure"
        )
        course_objectives.append({
            "objectiveId": objective_id,
            "description": chapter.get("roleInCourse", ""),
            "observableOutcome": chapter.get("deliverable", ""),
            "importance": importance,
            "evidenceRequirement": evidence_requirement,
            "conceptKeys": [c["label"] for c in chapter_concepts if c.get("label")],
        })
        blueprint_chapters.append({
            "chapterId": chapter["chapterId"],
            "index": index + 1,
            "title": chapter.get("title", ""),
            "objectiveIds": [objective_id],
            "prerequisites": chapter.get("prerequisites") or [],
            "teachingGoal": chapter.get("roleInCourse", ""),
            "completionCriteria": [chapter.get("deliverable", "")],
        })
    if course_objectives and not any(o["importance"] == "core" for o in course_objectives):
        course_objectives[-1]["importance"] = "core"

    target_capability = thesis.get("targetCapability", "")
    learning_delta = thesis.get("learningDelta") or []
    goal_text = "，".join([target_capability, *learning_delta, *[c.get("deliverable", "") for c in chapters]])
    resolved_intent = intent_type if intent_type in _INTENT_TYPES else _infer_intent_type(goal_text)

    learner_starting_point: dict[str, Any] = {
        "estimatedLevel": _normalize_estimated_level(learner.get("estimatedLevel")),
        "confirmedKnowledge": learner.get("skipBasics") or [],
        "likelyGaps": learner.get("likelyGaps") or [],
        "excludedTopics": learner.get("skipBasics") or [],
        "preferredExampleDomains": learner.get("preferredExampleDomains") or example_policy.get("preferredDomains") or [],
        "personalExampleLimit": learner.get("personalExampleLimit", example_policy.get("personalExampleLimit", 1)),
    }
    # TaskStreamRequest 的 levelConfidence 契约是数值；非数值（如 "high"）省略
    confidence = learner.get("levelConfidence")
    if isinstance(confidence, (int, float)):
        learner_starting_point["levelConfidence"] = confidence
    elif isinstance(confidence, str):
        try:
            learner_starting_point["levelConfidence"] = float(confidence)
        except ValueError:
            pass
    if learner.get("backgroundSummary"):
        learner_starting_point["backgroundSummary"] = learner["backgroundSummary"]

    return {
        "blueprintId": f"bp-{course_id}",
        "protocolVersion": 2,
        "topic": architecture.get("courseTopic", ""),
        "intentType": resolved_intent,
        "mission": {
            "why": learning_delta[0] if learning_delta else target_capability,
            "targetScenario": target_capability,
            "successCriteria": [c.get("deliverable", "") for c in chapters],
            "constraints": [],
            "outOfScope": thesis.get("nonGoals") or [],
        },
        "learnerStartingPoint": learner_starting_point,
        "courseObjectives": course_objectives,
        "chapters": blueprint_chapters,
        "createdAt": now if now is not None else int(time.time() * 1000),
        "promptVersion": BLUEPRINT_COMPILER_VERSION,
        "modelVersion": model_version or "course-architecture-derived",
    }


# ---------------------------------------------------------------------------
# dry-run 假客户端：走真实服务与真实 trace hook，不调 LLM
# ---------------------------------------------------------------------------

class DryRunClient:
    """按 response_format 的 schema 名分发罐头输出；model 标记 dry-run。"""

    model = "dry-run-model"

    def __init__(self, spec: dict):
        self.spec = spec

    @staticmethod
    def _rf_name(response_format: dict | None) -> str:
        return ((response_format or {}).get("json_schema") or {}).get("name") or ""

    def _chapters_payload(self) -> dict:
        topic = self.spec["topic"]
        return {
            "architectureVersion": 1,
            "courseTopic": topic,
            "chapters": [
                {
                    "chapterId": "ch-1", "title": f"{topic}的核心概念",
                    "roleInCourse": f"建立 {topic} 的核心概念框架",
                    "conceptIds": ["c-1"],
                    "deliverable": f"独立说明 {topic} 的核心机制并给出一个实例",
                    "prerequisites": [], "assessmentMode": "self_report",
                },
                {
                    "chapterId": "ch-2", "title": f"{topic}的动手应用",
                    "roleInCourse": f"把 {topic} 用到一次最小实操任务中",
                    "conceptIds": ["c-2"],
                    "deliverable": f"完成一次 {topic} 的最小实操示例并记录结果",
                    "prerequisites": ["ch-1"], "assessmentMode": "checkpoint",
                },
            ],
        }

    def _meta_payload(self) -> dict:
        topic = self.spec["topic"]
        return {
            "thesis": {
                "audience": self.spec["learnerPositioning"].get("backgroundSummary") or "零基础学习者",
                "currentBoundary": [],
                "targetCapability": f"独立完成一次 {topic} 的入门实操任务",
                "learningDelta": [
                    f"从说不清 {topic} 是什么到能解释其核心机制",
                    f"从不会动手到能完成一次最小示例",
                ],
                "nonGoals": [],
            },
            "conceptGraph": [
                {"conceptId": "c-1", "label": f"{topic}核心概念", "targetDepth": "apply",
                 "rationale": "理解后续实操步骤的前提", "prerequisiteConceptIds": []},
                {"conceptId": "c-2", "label": f"{topic}实操方法", "targetDepth": "apply",
                 "rationale": "直接支撑课程最终交付物", "prerequisiteConceptIds": ["c-1"]},
            ],
            "examplePolicy": {"preferredDomains": [], "personalExampleLimit": 1, "avoidRepeatedScenarios": True},
        }

    def _plan_payload(self, messages: list[dict]) -> dict:
        objective_id = "obj-1"
        # 从后往前找真实目标 ID：user 消息的目标列表格式为「- obj-1：描述…」；
        # system 提示词里的 JSON 模板含占位符 "本章课程目标 ID"，须跳过。
        for message in reversed(messages):
            content = str(message.get("content") or "")
            section = content.split("## 本章课程目标", 1)
            if len(section) > 1:
                match = re.search(r"-\s*([A-Za-z0-9_-]+)：", section[1])
                if match:
                    objective_id = match.group(1)
                    break
            matches = re.findall(r'"objectiveId"\s*:\s*"([^"]+)"', content)
            real = [m for m in matches if m != "本章课程目标 ID"]
            if real:
                objective_id = real[0]
                break
        return {"tasks": [
            {"taskId": "t-1", "order": 1, "title": "概念讲解", "objectiveId": objective_id,
             "taskGoal": "讲清本章核心概念的定义与边界", "observableOutcome": "能用自己的话说出概念的定义与边界",
             "conceptKeys": ["概念定义"], "prerequisiteTaskIds": [], "teachingPattern": "explain", "expectedMinutes": 3},
            {"taskId": "t-2", "order": 2, "title": "示例演练", "objectiveId": objective_id,
             "taskGoal": "通过最小示例巩固概念", "observableOutcome": "能完成示例并解释每步理由",
             "conceptKeys": ["示例演练"], "prerequisiteTaskIds": ["t-1"], "teachingPattern": "worked_example", "expectedMinutes": 4},
        ]}

    @staticmethod
    def _wrap(content: str) -> dict:
        return {
            "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 200, "total_tokens": 300},
        }

    def _traced(self, response: dict, messages: list[dict], kwargs: dict, source: str) -> dict:
        # dry-run 不走 minimax/minimax_agent，这里模拟 LLM 层的修复前 raw 捕获点
        if eval_trace.is_enabled():
            request: dict[str, Any] = {"model": self.model, "messages": messages}
            for key in ("max_tokens", "response_format", "reasoning_effort", "tools"):
                if key in kwargs:
                    request[key] = kwargs[key]
            eval_trace.capture_llm_response(response, request=request, source=source)
        return response

    def chat_with_tools(self, messages, tools=None, tool_functions=None, **kwargs) -> dict:
        name = self._rf_name(kwargs.get("response_format"))
        if name == "course_chapters":
            payload = self._chapters_payload()
        elif name == "course_meta":
            payload = self._meta_payload()
        elif name == "chapter_plan":
            payload = self._plan_payload(messages)
        else:
            payload = {}
        return self._traced(self._wrap(json.dumps(payload, ensure_ascii=False)), messages, kwargs, "dry-run.chat_with_tools")

    async def chat(self, messages, **kwargs) -> dict:
        # 与真实 MiniMaxClient.chat 一致为 async（checkpoint_service._call_for_json 会 await）
        user_text = "\n".join(str(m.get("content") or "") for m in messages if m.get("role") == "user")
        if "理解检查题" in user_text:
            # checkpoint 生成路径（checkpoint_service._call_for_json 的固定 user 消息）
            payload = self._checkpoint_payload()
        else:
            # 审查路径（architect_review / chapter_plan_review）
            payload = {"passed": True, "issues": [], "repairNotes": ""}
        response = self._wrap(json.dumps(payload, ensure_ascii=False))
        return self._traced(response, messages, kwargs, "dry-run.chat")

    def _checkpoint_payload(self) -> dict:
        topic = self.spec["topic"]
        return {
            "kind": "scenario_choice",
            "prompt": f"关于{topic}的核心概念，下列哪种说法正确？",
            "options": [
                {"id": "opt-a", "text": f"{topic}的核心机制可以被解释并用于最小示例"},
                {"id": "opt-b", "text": f"{topic}不需要理解，只要记住步骤"},
            ],
            "correctAnswer": "opt-a",
            "rubric": "能选出正确说法并说明理由",
            "remediationHint": "回看本章的概念讲解与示例任务",
            "estimatedSeconds": 45,
        }

    def prepare_search_context(self, messages, **kwargs) -> dict:
        return self._traced(self._wrap("NO_SEARCH"), messages, kwargs, "dry-run.prepare_search_context")

    async def stream_chat(self, messages, **kwargs):
        text = (
            f"这是 dry-run 装配验证正文，主题：{self.spec['topic']}。先讲清核心概念，再给出最小示例。\n\n"
            ":::key_point\n- 要点一：概念的定义与边界\n- 要点二：最小示例的操作步骤\n:::\n\n"
            "收尾段落：完成示例后，用自己的话复述一遍核心机制。\n"
        )
        for start in range(0, len(text), 64):
            yield {"choices": [{"delta": {"content": text[start:start + 64]}}]}
        usage = {"prompt_tokens": 100, "completion_tokens": 200, "total_tokens": 300}
        yield {"usage": usage}
        if eval_trace.is_enabled():
            eval_trace.capture_llm_response(
                {"choices": [{"message": {"content": text}}], "usage": usage},
                request={"model": self.model, "messages": messages, "stream": True},
                source="dry-run.stream_chat",
            )


# ---------------------------------------------------------------------------
# checkpoint 生成阶段（复用 services/checkpoint_service，只调用不修改）
# ---------------------------------------------------------------------------

async def _generate_chapter_checkpoints(
    *,
    course_id: str,
    blueprint_chapter: dict,
    plan: dict,
    generated_tasks: list[dict],
    client,
    course_topic: str,
    course_mission: dict | None,
) -> list[dict]:
    """为本章每个成功生成的任务生成一道 checkpoint（每任务 +1 次 LLM 调用）。

    trace 阶段名 checkpoints（章作用域 → stage_checkpoints_<chapterId>_*），
    四件套契约同其他阶段；单题失败记 failed 条目不中断整章。
    objectiveId 来自 plan.tasks 映射（生成内容任务不带 objectiveId）。
    证据走 get_chapter_evidence + evidence_to_prompt（只读，失败不阻塞，
    与 routers/learning_v2.py 的真实调用同契约）。
    """
    from services.checkpoint_service import generate_checkpoint
    from services.evidence_store import evidence_to_prompt, get_chapter_evidence
    from .judge import _blocks_to_text

    chapter_id = blueprint_chapter["chapterId"]
    plan_by_id = {str(t.get("taskId")): t for t in plan.get("tasks") or [] if isinstance(t, dict)}
    try:
        pack = get_chapter_evidence(course_id, chapter_id)
        evidence, sources = evidence_to_prompt(pack)
    except Exception:  # noqa: BLE001 证据失败不阻塞 checkpoint 生成
        evidence, sources = None, None

    entries: list[dict] = []
    with eval_trace.scope(chapter_id=chapter_id):
        for task in generated_tasks:
            tid = str(task.get("taskId") or "")
            blocks = task.get("blocks") or []
            if not tid or not blocks:
                continue  # 失败/无内容任务不生成 checkpoint
            plan_task = plan_by_id.get(tid) or {}
            objective_id = str(plan_task.get("objectiveId") or task.get("objectiveId") or "").strip()
            if not objective_id:
                entries.append({"taskId": tid, "chapterId": chapter_id, "status": "failed",
                                "error": "plan 缺少 objectiveId 映射，无法生成 checkpoint"})
            else:
                try:
                    with eval_trace.scope(task_id=tid):
                        with eval_trace.stage("checkpoints"):
                            definition = await generate_checkpoint(
                                course_topic=course_topic,
                                chapter_title=blueprint_chapter["title"],
                                teaching_goal=blueprint_chapter["teachingGoal"],
                                task_id=tid,
                                task_title=task.get("title") or plan_task.get("title", ""),
                                task_goal=plan_task.get("taskGoal", ""),
                                objective_id=objective_id,
                                task_content_summary=_blocks_to_text(blocks)[:1500],
                                course_mission=course_mission,
                                evidence=evidence,
                                sources=sources,
                                client=client,
                            )
                    entry = definition.model_dump()
                    entry["chapterId"] = chapter_id
                    entries.append(entry)
                except Exception as exc:  # noqa: BLE001 单题失败不中断整章
                    entries.append({"taskId": tid, "chapterId": chapter_id, "status": "failed",
                                    "error": f"{type(exc).__name__}: {exc}"})
            eval_trace.record_stage_parsed(
                "checkpoints",
                {"chapterId": chapter_id, "checkpoints": entries},
                parser="checkpoint_service",
            )
    return entries


# ---------------------------------------------------------------------------
# 单 spec 全链路
# ---------------------------------------------------------------------------

async def run_spec(spec: dict, args, run_id: str) -> dict:
    from schemas.learning_v2 import ChapterPlanRequest, TaskStreamRequest
    from services.course_architect_service import generate_course_architecture
    from services.chapter_plan_service import generate_chapter_plan
    from services.task_content_service import stream_task_events

    spec_id = spec["id"]
    course_id = f"eval-{spec_id}"
    started = time.monotonic()
    client = DryRunClient(spec) if args.dry_run else None
    eval_trace.begin_spec(run_id, spec_id, spec)

    course: dict[str, Any] = {
        "specId": spec_id,
        "topic": spec["topic"],
        "dryRun": bool(args.dry_run),
        "architecture": None,
        "blueprint": None,
        "chapters": [],
        "checkpoints": [],
        "generatedAt": int(time.time() * 1000),
    }
    status, error = "completed", None
    try:
        topic, outline, learner, memory = build_architect_inputs(spec)
        # 与生产 toc_agent 一致：架构层必须拿到主题证据包（此前 runner 从不传，
        # 配合 --no-search 会让计划层零证据，自拟分类/口径）。
        from services.evidence_store import (
            evidence_to_prompt, get_topic_evidence, save_topic_evidence,
        )
        if getattr(args, "seed_topic_evidence", False):
            _seed_topic_evidence(topic, spec)
        arch_evidence, arch_sources = evidence_to_prompt(get_topic_evidence(topic))
        architect_result = await generate_course_architecture(
            topic=topic, outline=outline, learner=learner, memory_context=memory,
            evidence=arch_evidence, sources=arch_sources,
            client=client, allow_search=not args.no_search,
        )
        architecture = architect_result["architecture"]
        course["architecture"] = architecture
        course["architectMeta"] = {
            key: architect_result.get(key)
            for key in ("promptVersion", "modelVersion", "reviewSkipped", "reviewUnavailable", "reviewIssues")
        }
        blueprint = compile_blueprint(
            course_id, architecture, learner,
            intent_type=spec.get("intentType"),
            model_version=architect_result.get("modelVersion"),
        )
        course["blueprint"] = blueprint

        chapters = blueprint["chapters"]
        if args.max_chapters > 0:
            chapters = chapters[:args.max_chapters]
        completed_chapters: list[dict] = []
        for blueprint_chapter in chapters:
            chapter_entry: dict[str, Any] = {
                "chapterId": blueprint_chapter["chapterId"],
                "title": blueprint_chapter["title"],
                "plan": None,
                "tasks": [],
            }
            course["chapters"].append(chapter_entry)
            with eval_trace.scope(chapter_id=blueprint_chapter["chapterId"]):
                plan = await generate_chapter_plan(
                    ChapterPlanRequest(
                        courseId=course_id,
                        chapterId=blueprint_chapter["chapterId"],
                        blueprint=blueprint,
                        completedChapters=completed_chapters,
                    ),
                    client=client,
                )
            chapter_entry["plan"] = plan
            completed_chapters.append({
                "chapterId": blueprint_chapter["chapterId"],
                "title": blueprint_chapter["title"],
            })

            sampled = sorted(plan["tasks"], key=lambda t: t["order"])[:args.max_tasks]
            previous_tasks: list[dict] = []
            for task_index, task in enumerate(sampled):
                next_title = sampled[task_index + 1]["title"] if task_index + 1 < len(sampled) else None
                request = TaskStreamRequest(
                    courseId=course_id,
                    chapterId=blueprint_chapter["chapterId"],
                    planId=plan["planId"],
                    planVersion=plan["planVersion"],
                    taskId=task["taskId"],
                    attempt=1,
                    task={
                        "taskId": task["taskId"], "title": task["title"],
                        "taskGoal": task["taskGoal"], "teachingPattern": task["teachingPattern"],
                        "observableOutcome": task["observableOutcome"],
                        "conceptKeys": task.get("conceptKeys") or [],
                    },
                    chapter={"title": blueprint_chapter["title"], "teachingGoal": blueprint_chapter["teachingGoal"]},
                    courseTopic=blueprint["topic"],
                    courseMission=blueprint.get("mission"),
                    learnerStartingPoint=blueprint["learnerStartingPoint"],
                    previousTasks=previous_tasks,
                    nextTaskTitle=next_title,
                )
                task_result: dict | None = None
                task_error: dict | None = None
                # 章+任务作用域：search_decision / task_content_<taskId> 阶段
                # 展开为带章/任务 ID 的名字，跨章同名任务不再互相覆盖
                with eval_trace.scope(chapter_id=blueprint_chapter["chapterId"], task_id=task["taskId"]):
                    async for event in stream_task_events(request, client=client):
                        if event["type"] == "task_completed":
                            task_result = event["payload"]["task"]
                        elif event["type"] == "request_error":
                            task_error = event["payload"]
                if task_result is not None:
                    chapter_entry["tasks"].append(task_result)
                    previous_tasks.append({
                        "title": task["title"],
                        "takeaway": (task_result.get("boundaryPrompt") or {}).get("takeaway"),
                        "teachingPattern": task["teachingPattern"],
                        "conceptKeys": task.get("conceptKeys") or [],
                    })
                else:
                    chapter_entry["tasks"].append({"taskId": task["taskId"], "status": "failed", "error": task_error})
                    status = "partial"

            # checkpoint 生成阶段（默认开启；--no-checkpoints 关闭）。
            # 评估缺失不再被误记为"目标无评估"断裂。
            if not getattr(args, "no_checkpoints", False):
                cp_entries = await _generate_chapter_checkpoints(
                    course_id=course_id,
                    blueprint_chapter=blueprint_chapter,
                    plan=plan,
                    generated_tasks=chapter_entry["tasks"],
                    client=client,
                    course_topic=blueprint["topic"],
                    course_mission=blueprint.get("mission"),
                )
                course["checkpoints"].extend(cp_entries)
                if any(e.get("status") == "failed" for e in cp_entries):
                    status = "partial"
    except Exception as exc:  # noqa: BLE001 单 spec 失败不中断整批
        status, error = "failed", f"{type(exc).__name__}: {exc}"
        print(f"[eval-runner] spec={spec_id} 失败：{error}")
    finally:
        course["status"] = status
        if error:
            course["error"] = error
        eval_trace.write_course(course)
        call_counts = eval_trace.stage_call_counts()
        eval_trace.end_spec()

    return {
        "id": spec_id,
        "topic": spec["topic"],
        "status": status,
        "error": error,
        "durationMs": int((time.monotonic() - started) * 1000),
        "llmCalls": call_counts,
        "llmCallTotal": sum(call_counts.values()),
        "chapters": len(course["chapters"]),
        "tasks": sum(len(c["tasks"]) for c in course["chapters"]),
        "checkpoints": sum(1 for cp in course["checkpoints"] if cp.get("status") != "failed"),
    }


async def run_all(specs: list[dict], args, run_id: str) -> dict:
    started = time.monotonic()
    results = []
    for spec in specs:
        print(f"[eval-runner] spec={spec['id']} topic={spec['topic']} dry_run={args.dry_run}")
        results.append(await run_spec(spec, args, run_id))
    meta = {
        "runId": run_id,
        "dryRun": bool(args.dry_run),
        "startedAt": int(time.time() * 1000),
        "durationMs": int((time.monotonic() - started) * 1000),
        "specCount": len(specs),
        "maxTasksPerChapter": args.max_tasks,
        "maxChapters": args.max_chapters,
        "checkpoints": not getattr(args, "no_checkpoints", False),
        "allowSearch": not args.no_search,
        "model": os.getenv("LLM_MODEL", ""),
        "strictSchema": os.getenv("LLM_STRICT_JSON_SCHEMA", "1"),
        "specs": results,
        "llmCallTotal": sum(r["llmCallTotal"] for r in results),
    }
    eval_trace.write_run_meta(run_id, meta)
    return meta


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def load_golden_set(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        if "specs" not in data and "items" not in data:
            raise ValueError("golden set 对象必须含 specs 或 items 列表")
        data = data.get("specs") or data.get("items") or []
    if not isinstance(data, list):
        raise ValueError("golden set 必须是列表（或含 specs/items 列表的对象）")
    return [normalize_spec(raw, index) for index, raw in enumerate(data) if isinstance(raw, dict)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="课程生成全链路离线 runner（trace 采集）")
    parser.add_argument("golden", help="golden set JSON 路径")
    parser.add_argument("--specs", default="", help="按 id 过滤，逗号分隔")
    parser.add_argument("--max-tasks", type=int, default=2, help="每章最多生成正文的任务数（默认 2，控成本）")
    parser.add_argument("--max-chapters", type=int, default=0, help="每门课最多跑的章节数（0=全部）")
    parser.add_argument("--run-id", default="", help="运行 id（默认 run-<时间戳>）")
    parser.add_argument("--trace-dir", default="eval-traces", help="trace 根目录（设为 EVAL_TRACE_DIR）")
    parser.add_argument("--dry-run", action="store_true", help="不调 LLM，用罐头输出验证装配与 trace 契约")
    parser.add_argument("--no-search", action="store_true", help="关闭全链路联网搜索（控成本/离线复跑）")
    parser.add_argument("--no-checkpoints", action="store_true", help="关闭 checkpoint 生成阶段（默认每任务 +1 次调用）")
    parser.add_argument("--env-file", default=str(AGENT_ROOT / ".env"), help="dotenv 文件（LLM_API_KEY 等）")
    parser.add_argument("--seed-topic-evidence", action="store_true",
                        help="按 spec.authoritativeSources 抓全文 seeding 主题证据包（实验用）")
    parser.add_argument("--evidence-dir", default="", help="证据库目录（默认隔离到 <trace_dir>/<run_id>/_evidence）")
    args = parser.parse_args(argv)

    env_file = Path(args.env_file)
    if env_file.is_file():
        from dotenv import load_dotenv
        load_dotenv(env_file)

    run_id = args.run_id or f"run-{time.strftime('%Y%m%d-%H%M%S')}"
    trace_dir = Path(args.trace_dir).resolve()
    os.environ["EVAL_TRACE_DIR"] = str(trace_dir)
    os.environ["EVIDENCE_STORE_DIR"] = str(
        Path(args.evidence_dir).resolve() if args.evidence_dir else trace_dir / run_id / "_evidence"
    )
    if args.no_search or args.dry_run:
        os.environ["DISABLE_WEB_SEARCH"] = "1"
        os.environ["DISABLE_EVIDENCE_SEARCH"] = "1"

    specs = load_golden_set(Path(args.golden))
    if args.specs:
        wanted = {item.strip() for item in args.specs.split(",") if item.strip()}
        specs = [spec for spec in specs if spec["id"] in wanted]
    if not specs:
        print("[eval-runner] 没有匹配的 spec")
        return 1

    meta = asyncio.run(run_all(specs, args, run_id))
    failed = [r for r in meta["specs"] if r["status"] == "failed"]
    print(
        f"[eval-runner] 完成 run_id={run_id} specs={meta['specCount']} "
        f"failed={len(failed)} llm_calls={meta['llmCallTotal']} "
        f"trace={trace_dir / run_id}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
