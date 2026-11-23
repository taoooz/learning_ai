"""Course Prompt Lab：复用生产 Prompt Builder 的隔离调试 Runner。"""
from __future__ import annotations

import json
import time
from typing import Any, Generator

from lib.minimax import parse_json_response
from lib.minimax_agent import AgentClient
from lib.tools.search_tools import SEARCH_TOOLS, TOOL_FUNCTIONS
from schemas.course_architecture import (
    CourseArchitecture,
    CourseArchitectureMeta,
    CourseChapterPlan,
    validate_course_chapters,
)
from schemas.learning_v2 import TaskStreamRequest
from schemas.prompt_lab import PromptLabRunRequest
from services.chapter_plan_service import (
    _normalize_task,
    build_chapter_plan_prompt,
    build_chapter_plan_review_prompt,
    validate_plan_tasks,
)
from services.content_stream_parser import ContentStreamParser
from services.course_architect_service import (
    build_course_architect_chapters_prompt,
    build_course_architect_meta_prompt,
    build_course_architect_review_prompt,
)
from services.outline_agent import _format_clarification_answers
from services.outline_service import build_initial_prompt, parse_content_blocks
from services.task_content_service import (
    build_task_content_prompt,
    build_task_search_decision_prompt,
)


STAGE_DEFAULTS: dict[str, dict[str, Any]] = {
    "outline_initial": {
        "user_message": "请开始。",
        "tools_enabled": True,
        "max_tokens": 12000,
        "max_searches": 3,
        "max_iterations": 8,
        "reasoning_effort": "low",
    },
    "outline_answer": {
        "user_message": "请基于这些澄清回答继续生成课程纲要。",
        "tools_enabled": True,
        "max_tokens": 12000,
        "max_searches": 3,
        "max_iterations": 8,
        "reasoning_effort": "low",
    },
    "architect_chapters": {
        "user_message": "请先完成这门课的章节目录设计。",
        "tools_enabled": True,
        "max_tokens": 6000,
        "max_searches": 1,
        "max_iterations": 2,
        "reasoning_effort": "none",
    },
    "architect_meta": {
        "user_message": "请基于已确定章节补全课程元信息。",
        "tools_enabled": False,
        "max_tokens": 8000,
        "max_searches": 0,
        "max_iterations": 1,
        "reasoning_effort": "none",
    },
    "architect_review": {
        "user_message": "请审查这份课程架构。",
        "tools_enabled": False,
        "max_tokens": 12000,
        "max_searches": 0,
        "max_iterations": 1,
        "reasoning_effort": "none",
    },
    "chapter_plan": {
        "user_message": "请为这个章节生成任务计划。",
        "tools_enabled": True,
        "max_tokens": 16000,
        "max_searches": 1,
        "max_iterations": 2,
        "reasoning_effort": "low",
    },
    "chapter_plan_review": {
        "user_message": "请审查这份章节计划。",
        "tools_enabled": False,
        "max_tokens": 8000,
        "max_searches": 0,
        "max_iterations": 1,
        "reasoning_effort": "none",
    },
    "task_search_decision": {
        "user_message": "只做检索判断：需要补充时调用搜索工具，否则只回复 NO_SEARCH。不要写正文。",
        "tools_enabled": True,
        "max_tokens": 1200,
        "max_searches": 1,
        "max_iterations": 1,
        "reasoning_effort": "none",
    },
    "task_content": {
        "user_message": "请撰写当前任务的学习正文。",
        "tools_enabled": False,
        "max_tokens": 16000,
        "max_searches": 0,
        "max_iterations": 1,
        "reasoning_effort": "none",
    },
}


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _sources(value: Any) -> list[dict]:
    return [item for item in _as_list(value) if isinstance(item, dict)]


def _derive_chapter_from_blueprint(blueprint: dict, chapter_id: str) -> tuple[dict, list[dict]]:
    chapter = next(
        (item for item in _as_list(blueprint.get("chapters")) if item.get("chapterId") == chapter_id),
        {},
    )
    objectives_by_id = {
        item.get("objectiveId"): item
        for item in _as_list(blueprint.get("courseObjectives"))
        if isinstance(item, dict)
    }
    objectives = [
        objectives_by_id[objective_id]
        for objective_id in _as_list(chapter.get("objectiveIds"))
        if objective_id in objectives_by_id
    ]
    return chapter, objectives


def _task_request(inputs: dict) -> TaskStreamRequest:
    request = inputs.get("request")
    if isinstance(request, dict) and request:
        return TaskStreamRequest.model_validate(request)
    raise ValueError("该环节需要输入完整的 request（TaskStreamRequest）")


def compile_prompt_lab_stage(stage: str, inputs: dict) -> dict[str, Any]:
    """返回生产 Builder 针对当前 stage + inputs 生成的默认 Prompt。"""
    defaults = STAGE_DEFAULTS.get(stage)
    if not defaults:
        raise ValueError(f"未知调试环节：{stage}")

    topic = str(inputs.get("topic") or "")
    user_profile = _as_dict(inputs.get("userProfile"))
    planning_memory = _as_dict(inputs.get("planningMemory"))
    memory_context = _as_dict(inputs.get("memoryContext"))
    evidence = inputs.get("evidence")
    evidence_text = str(evidence).strip() if evidence else None
    sources = _sources(inputs.get("sources"))

    if stage in {"outline_initial", "outline_answer"}:
        prompt = build_initial_prompt(
            topic,
            user_profile,
            planning_memory,
            needs_calibration=bool(inputs.get("needsCalibration")),
        )
        if stage == "outline_answer":
            answers = [item for item in _as_list(inputs.get("answers")) if isinstance(item, dict)]
            user_message = _format_clarification_answers(answers, str(inputs.get("answer") or ""))
            if not user_message:
                user_message = defaults["user_message"]
        else:
            user_message = defaults["user_message"]

    elif stage == "architect_chapters":
        prompt = build_course_architect_chapters_prompt(
            topic,
            _as_dict(inputs.get("outline")),
            _as_dict(inputs.get("learner")),
            memory_context,
            evidence_text,
            sources,
            allow_search=bool(inputs.get("allowSearch", True)),
        )
        user_message = defaults["user_message"]

    elif stage == "architect_meta":
        plan = CourseChapterPlan.model_validate(_as_dict(inputs.get("chapterPlan")))
        prompt = build_course_architect_meta_prompt(
            topic,
            _as_dict(inputs.get("outline")),
            _as_dict(inputs.get("learner")),
            plan,
            memory_context,
            evidence_text,
            sources,
        )
        user_message = defaults["user_message"]

    elif stage == "architect_review":
        architecture = CourseArchitecture.model_validate(_as_dict(inputs.get("architecture")))
        prompt = build_course_architect_review_prompt(
            architecture,
            _as_dict(inputs.get("learner")),
        )
        user_message = defaults["user_message"]

    elif stage in {"chapter_plan", "chapter_plan_review"}:
        blueprint = _as_dict(inputs.get("blueprint"))
        chapter_id = str(inputs.get("chapterId") or "")
        chapter, objectives = _derive_chapter_from_blueprint(blueprint, chapter_id)
        if not chapter:
            raise ValueError("blueprint 中未找到当前 chapterId")
        learner = _as_dict(blueprint.get("learnerStartingPoint"))
        if stage == "chapter_plan":
            prompt = build_chapter_plan_prompt(
                topic=str(blueprint.get("topic") or topic),
                chapter=chapter,
                objectives=objectives,
                learner=learner,
                evidence=evidence_text,
                sources=sources,
                mission=_as_dict(blueprint.get("mission")),
                teaching_state=_as_dict(blueprint.get("teachingState")),
                completed_chapters=_as_list(inputs.get("completedChapters")),
                intent_type=str(blueprint.get("intentType") or ""),
                memory_context=memory_context,
                allow_search=bool(inputs.get("allowSearch", True)),
            )
        else:
            tasks = [item for item in _as_list(inputs.get("tasks")) if isinstance(item, dict)]
            prompt = build_chapter_plan_review_prompt(
                str(chapter.get("title") or ""),
                str(chapter.get("teachingGoal") or chapter.get("roleInCourse") or ""),
                learner,
                tasks,
            )
        user_message = defaults["user_message"]

    elif stage == "task_search_decision":
        request = _task_request(inputs)
        prompt = build_task_search_decision_prompt(
            request,
            evidence=evidence_text,
            sources=sources,
        )
        user_message = defaults["user_message"]

    elif stage == "task_content":
        request = _task_request(inputs)
        prompt = build_task_content_prompt(
            request,
            evidence=evidence_text,
            sources=sources,
            memory_context=memory_context,
            allow_search=bool(inputs.get("allowSearch", False)),
        )
        user_message = f"请撰写任务「{request.task.title}」的学习正文。"

    else:  # pragma: no cover - Pydantic Literal 已提前限制
        raise ValueError(f"未知调试环节：{stage}")

    return {
        "stage": stage,
        "systemPrompt": prompt,
        "userMessage": user_message,
        "history": [item for item in _as_list(inputs.get("history")) if isinstance(item, dict)],
        "config": {
            "toolsEnabled": defaults["tools_enabled"],
            "maxTokens": defaults["max_tokens"],
            "maxSearches": defaults["max_searches"],
            "maxIterations": defaults["max_iterations"],
            "reasoningEffort": defaults["reasoning_effort"],
        },
    }


def _validation(
    errors: list[dict] | list[str],
    warnings: list[dict] | list[str] | None = None,
) -> dict[str, Any]:
    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings or [],
    }


def _parse_stage_output(stage: str, content: str, inputs: dict, tool_results: list[dict]) -> dict[str, Any]:
    if stage == "outline_initial" or stage == "outline_answer":
        parsed = parse_content_blocks(content)
        has_output = bool(parsed.get("outline") or parsed.get("questions"))
        return {
            "parsed": parsed,
            "validation": _validation([] if has_output else ["未解析出 outline 或 questions"]),
        }

    if stage == "architect_chapters":
        parsed = parse_json_response(content)
        plan = CourseChapterPlan.model_validate(parsed)
        errors = validate_course_chapters(plan.chapters)
        if not plan.courseTopic.strip():
            errors.append("课程主题为空。")
        return {"parsed": plan.model_dump(), "validation": _validation(errors)}

    if stage == "architect_meta":
        parsed = parse_json_response(content)
        meta = CourseArchitectureMeta.model_validate(parsed)
        chapter_plan = CourseChapterPlan.model_validate(_as_dict(inputs.get("chapterPlan")))
        required = {
            concept_id
            for chapter in chapter_plan.chapters
            for concept_id in chapter.conceptIds
            if concept_id.strip()
        }
        actual = {concept.conceptId for concept in meta.conceptGraph}
        errors: list[str] = []
        if required != actual:
            errors.append(
                f"conceptId 不一致：缺少 {sorted(required - actual)}，多出 {sorted(actual - required)}"
            )
        return {"parsed": meta.model_dump(), "validation": _validation(errors)}

    if stage in {"architect_review", "chapter_plan_review"}:
        parsed = parse_json_response(content)
        if not isinstance(parsed.get("passed"), bool):
            return {"parsed": parsed, "validation": _validation(["缺少布尔字段 passed"])}
        return {"parsed": parsed, "validation": _validation([])}

    if stage == "chapter_plan":
        parsed = parse_json_response(content)
        blueprint = _as_dict(inputs.get("blueprint"))
        chapter_id = str(inputs.get("chapterId") or "")
        _, objectives = _derive_chapter_from_blueprint(blueprint, chapter_id)
        raw_tasks = parsed.get("tasks") if isinstance(parsed.get("tasks"), list) else []
        tasks = [_normalize_task(item, index) for index, item in enumerate(raw_tasks) if isinstance(item, dict)]
        errors, warnings = validate_plan_tasks(tasks, [item.get("objectiveId", "") for item in objectives])
        parsed["tasks"] = tasks
        return {"parsed": parsed, "validation": _validation(errors, warnings)}

    if stage == "task_search_decision":
        return {
            "parsed": {
                "decision": "NO_SEARCH" if "NO_SEARCH" in content else "SEARCHED",
                "toolResults": tool_results,
            },
            "validation": _validation([]),
        }

    if stage == "task_content":
        parser = ContentStreamParser()
        parser.feed(content)
        parser.finish()
        blocks = parser.collect_blocks()
        return {
            "parsed": {"blocks": blocks},
            "validation": _validation([] if blocks else ["未解析出内容块"]),
        }

    return {"parsed": {"raw": content}, "validation": _validation([])}


def _json_event(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def run_prompt_lab_stream(req: PromptLabRunRequest) -> Generator[str, None, None]:
    """真实调用模型；不写课程、Memory、lesson 或 engagement。"""
    client = AgentClient()
    messages = [{"role": "system", "content": req.system_prompt}]
    for item in req.history:
        role = str(item.get("role") or "")
        content = str(item.get("content") or "")
        if role in {"user", "assistant", "tool"} and content:
            messages.append({"role": role, "content": content})
    if req.user_message.strip():
        messages.append({"role": "user", "content": req.user_message})

    started = time.monotonic()
    raw_content = ""
    finish_reason = None
    tool_results: list[dict] = []
    try:
        tools = SEARCH_TOOLS if req.tools_enabled else []
        for event in client.stream_chat_with_tools(
            messages=messages,
            tools=tools,
            tool_functions=TOOL_FUNCTIONS,
            max_tokens=req.max_tokens,
            reasoning_split=True,
            max_iterations=req.max_iterations if req.tools_enabled else 1,
            max_searches=req.max_searches if req.tools_enabled else 0,
            reasoning_effort=req.reasoning_effort,
        ):
            event_type = event.get("type")
            if event_type == "thinking":
                yield _json_event({"type": "thinking", "message": event.get("message", "")})
            elif event_type == "content_delta":
                content = str(event.get("content") or "")
                raw_content += content
                yield _json_event({"type": "content_delta", "content": content})
            elif event_type == "tool_call":
                yield _json_event({
                    "type": "tool_call",
                    "tool": event.get("tool"),
                    "args": event.get("args") or {},
                })
            elif event_type == "tool_result":
                result = str(event.get("result") or "")
                tool_results.append({"tool": event.get("tool"), "result": result})
                yield _json_event({
                    "type": "tool_result",
                    "tool": event.get("tool"),
                    "result": result,
                })
            elif event_type == "done":
                finish_reason = event.get("finish_reason")

        parsed = _parse_stage_output(req.stage, raw_content, req.inputs, tool_results)
        yield _json_event({
            "type": "parsed",
            **parsed,
            "toolResults": tool_results,
        })
        yield _json_event({
            "type": "metrics",
            "elapsedMs": int((time.monotonic() - started) * 1000),
            "finishReason": finish_reason,
        })
    except Exception as exc:  # noqa: BLE001 调试接口必须把完整失败信息回传前端
        yield _json_event({"type": "error", "message": str(exc)})
    yield "data: [DONE]\n\n"
