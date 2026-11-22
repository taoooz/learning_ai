"""
V2 任务内容流式生成服务
产出与 types/learning-v2/events.ts LearningSseEvent 外壳对齐的结构化事件
（SSE 字节包装与 [DONE] 收尾在 main.py 端点层完成）

Content Recipe（切片 1）：按 teachingPattern 配方输出多块内容，
markdown 段落实时流式；:::type…::: 结构化块在完整接收后一次性产出。
"""
import asyncio
import os
import re
import time
from typing import AsyncGenerator
from uuid import uuid4

from lib.minimax_agent import AgentClient
from lib.minimax import MiniMaxClient, extract_usage
from lib.tools.search_tools import SEARCH_TOOLS
from services.search_evidence import ChapterEvidenceCollector, format_search_decision_policy
from services.evidence_store import evidence_to_prompt, task_evidence_coverage
from services.content_stream_parser import ContentStreamParser
from services.style_lint import lint_task_blocks, log_prose_findings
from prompts import build_prompt
from prompts.task_content import get_recipe
from schemas.learning_v2 import TaskStreamRequest
from services.chapter_plan_service import TEACHING_PATTERNS
from services.learning_v2_errors import classify_llm_error
from services.memory_context_v4 import format_memory_context_for_prompt

PROMPT_VERSION = "task-content-v4"

_LEVEL_LABELS = {"beginner": "初级", "intermediate": "中级", "advanced": "高级"}

# 首句切分：中英文句末标点之后断开
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？!?])")

# 清理 ::: 定界符行（用于 extract_takeaway）
_MARKER_LINE_RE = re.compile(r"^:::(\w+)?\s*$", re.MULTILINE)

# 正文是“按已确定结构成稿”的末段任务；默认关闭额外推理以控制首字延迟，
# 复杂任务或质量回归时可用环境变量恢复 low/medium/high。
_TASK_CONTENT_REASONING_EFFORT = os.getenv("TASK_CONTENT_REASONING_EFFORT", "none").strip() or None


def _format_teaching_state(teaching_state: dict | None) -> str:
    if not teaching_state:
        return ""
    sections = []

    insights = [
        item for item in (teaching_state.get("insights") or [])
        if item.get("status") in ("candidate", "used") and item.get("content")
    ]
    if insights:
        lines = [f"- {item.get('content')}" for item in insights[-3:]]
        sections.append("## 前序章节素材\n" + "\n".join(lines))

    notes = teaching_state.get("notes") or []
    if notes:
        lines = [f"- {item.get('content')}" for item in notes[-3:]]
        sections.append("## 课程教学备注\n" + "\n".join(lines))

    if not sections:
        return ""
    return (
        "\n\n<teaching_state>\n"
        + "\n".join(sections)
        + "\n\n写作要求：任务内容应承接前序章节素材，但不要机械复述。"
        + "\n</teaching_state>"
    )


def _format_course_mission(mission: dict | None) -> str:
    if not mission:
        return ""
    lines = [
        f"- 学习动机：{mission.get('why', '')}",
        f"- 目标场景：{mission.get('targetScenario', '')}",
    ]
    success = mission.get("successCriteria") or []
    if success:
        lines.append("- 完成标准：" + "；".join(str(item) for item in success))
    out_of_scope = mission.get("outOfScope") or []
    if out_of_scope:
        lines.append("- 不学：" + "、".join(str(item) for item in out_of_scope))
    return (
        "\n\n## 课程使命\n" + "\n".join(lines) +
        "\n\n本任务必须服务这个使命；不要为了知识完整性扩展使命外内容。"
    )


def build_task_content_prompt(
    request: TaskStreamRequest,
    evidence: str | None = None,
    sources: list[dict] | None = None,
    memory_context: dict | None = None,
    allow_search: bool = False,
) -> str:
    """构建任务内容 system prompt（evidence 非空时注入搜索证据包，§搜索策略）"""
    learner = request.learnerStartingPoint
    learner_lines = [f"当前水平：{_LEVEL_LABELS.get(learner.estimatedLevel, learner.estimatedLevel)}"]
    if learner.confirmedKnowledge:
        learner_lines.append(f"已确认掌握：{'、'.join(learner.confirmedKnowledge)}")
    if learner.likelyGaps:
        learner_lines.append(f"潜在缺口：{'、'.join(learner.likelyGaps)}")
    if learner.excludedTopics:
        learner_lines.append(f"已掌握且不要再从零讲：{'、'.join(learner.excludedTopics)}")
    if learner.backgroundSummary:
        learner_lines.append(f"相关背景（仅用于校准和必要时选例）：{learner.backgroundSummary}")
    if learner.preferredExampleDomains or learner.personalExampleLimit is not None:
        domains = '、'.join(learner.preferredExampleDomains) if learner.preferredExampleDomains else '通用行业场景'
        learner_lines.append(
            f"例子策略：优先 {domains}；个人经历不是默认案例库，每章最多引用 {learner.personalExampleLimit} 次"
        )

    if request.previousTasks:
        previous_lines = []
        for previous in request.previousTasks:
            line = f"- {previous.title}"
            if previous.teachingPattern:
                line += f"（模式：{previous.teachingPattern}"
                if previous.conceptKeys:
                    line += f"；概念：{'、'.join(previous.conceptKeys)}"
                line += "）"
            if previous.exampleScenarios:
                line += f"；已用例子场景：{'；'.join(previous.exampleScenarios)}"
            if previous.takeaway:
                line += f"（要点：{previous.takeaway}）"
            previous_lines.append(line)
        previous_section = "\n".join(previous_lines)
    else:
        previous_section = "无（这是本章第一个任务）"

    evidence_section = ""
    if evidence:
        source_lines = "\n".join(f"- {s.get('title', '')}（{s.get('url', '')}）" for s in (sources or []))
        evidence_section = (
            f"\n\n## 搜索证据包（外部资料，引用时须注明来源）\n{evidence}\n\n"
            f"## 可引用来源\n{source_lines}\n\n"
            "引用上述证据时保持事实准确，不要编造未在证据中出现的内容。\n"
            "结构化块若依赖证据，请在块末单独写一行：证据：ev-01, ev-02（只使用证据包中的 ID）。"
        )
    pattern = request.task.teachingPattern
    prompt = build_prompt(
        "task_content",
        course_topic=request.courseTopic,
        chapter_title=request.chapter.title,
        chapter_goal=request.chapter.teachingGoal,
        task_title=request.task.title,
        task_goal=request.task.taskGoal,
        pattern_label=TEACHING_PATTERNS.get(pattern, pattern),
        observable_outcome=request.task.observableOutcome,
        learner_section="\n".join(learner_lines),
        previous_section=previous_section,
        content_recipe=get_recipe(pattern),
        ) + _format_course_mission(request.courseMission) + _format_teaching_state(request.teachingState) + format_memory_context_for_prompt(memory_context or {}) + evidence_section
    if allow_search:
        prompt += "\n\n" + format_search_decision_policy(max_searches=2)
    return prompt


def build_task_search_decision_prompt(
    request: TaskStreamRequest,
    evidence: str | None = None,
    sources: list[dict] | None = None,
) -> str:
    """构建只负责检索判断的紧凑 prompt，避免复用完整正文教学配方。"""
    source_lines = "\n".join(
        f"- {source.get('title', '')}（{source.get('url', '')}）"
        for source in (sources or [])
        if source.get('url')
    ) or '无'
    evidence_text = evidence or '无'
    return (
        "你是课程内容检索决策器，只判断当前任务是否需要补充联网证据，不要撰写正文。\n\n"
        f"## 课程与任务\n"
        f"- 课程主题：{request.courseTopic}\n"
        f"- 章节：{request.chapter.title}｜{request.chapter.teachingGoal}\n"
        f"- 当前任务：{request.task.title}｜{request.task.taskGoal}\n\n"
        f"## 已有证据\n{evidence_text}\n\n"
        f"## 可引用来源\n{source_lines}\n\n"
        + format_search_decision_policy(max_searches=1)
        + "\n\n完成判断后：需要补充时调用搜索工具；不需要时只输出 NO_SEARCH。"
    )


def extract_takeaway(markdown: str) -> str:
    """提取可带走要点：优先最后一个 > 引用块；缺省取末段第一句；再缺省为空串"""
    block_lines: list[str] = []
    for line in reversed(markdown.splitlines()):
        stripped = line.strip()
        if stripped.startswith(">"):
            block_lines.append(stripped.lstrip(">").strip())
        elif block_lines:
            break
    if block_lines:
        text = " ".join(part for part in reversed(block_lines) if part).strip()
        if text:
            return text

    paragraphs = [p.strip() for p in markdown.split("\n\n") if p.strip()]
    for paragraph in reversed(paragraphs):
        lines = [l.strip() for l in paragraph.splitlines() if l.strip() and not l.strip().startswith(">")]
        if not lines:
            continue
        parts = _SENTENCE_SPLIT_RE.split(lines[0])
        sentence = next((p.strip() for p in parts if p.strip()), "")
        if sentence:
            return sentence
    return ""


def _parser_event_to_sse(event: dict, make_event, started_blocks: set) -> list[dict]:
    """将解析器事件转换为 SSE 事件 dict 列表"""
    kind = event["kind"]
    results = []

    if kind == "markdown_delta":
        bid = event["blockId"]
        if bid not in started_blocks:
            started_blocks.add(bid)
            results.append(make_event("content_block_started", {"blockId": bid, "blockType": "markdown"}))
        results.append(make_event("content_block_delta", {"blockId": bid, "delta": event["delta"]}))
    elif kind == "structured_started":
        bid = event["block"]["blockId"]
        started_blocks.add(bid)
        results.append(make_event("content_block_started", {
            "blockId": bid,
            "blockType": event["block"]["type"],
            # 块壳骨架：前端立即渲染样式容器
            "block": event["block"],
        }))
    elif kind == "structured_delta":
        bid = event["block"]["blockId"]
        # 部分块整体下发：前端按 blockId 原位替换，内容渐进呈现
        results.append(make_event("content_block_delta", {"blockId": bid, "block": event["block"]}))
    elif kind == "structured_block":
        results.append(make_event("content_block_completed", {"block": event["block"]}))
    elif kind == "markdown_end":
        md = event["markdown"]
        if md.strip():
            block = {"type": "markdown", "blockId": event["blockId"], "markdown": md}
            results.append(make_event("content_block_completed", {"block": block}))

    return results


async def stream_task_events(request: TaskStreamRequest, client: MiniMaxClient | None = None, memory_context: dict | None = None) -> AsyncGenerator[dict, None]:
    """流式生成单个任务的学习内容，yield 完整事件 dict 序列

    正常序列：task_started → sources_ready? → N×(content_block_started/delta/completed)
    → task_completed → request_completed
    异常时发 request_error 后必须补发 request_completed（status=failed）
    """
    client = client or AgentClient()
    request_id = f"req-{uuid4().hex[:12]}"
    sequence = 0

    def make_event(event_type: str, payload: dict) -> dict:
        nonlocal sequence
        sequence += 1
        return {
            "eventId": f"{request_id}:{sequence}",
            "requestId": request_id,
            "type": event_type,
            "courseId": request.courseId,
            "chapterId": request.chapterId,
            "taskId": request.taskId,
            "planVersion": request.planVersion,
            "sequence": sequence,
            "timestamp": time.time_ns() // 1_000_000,
            "payload": payload,
        }

    # 章节 EvidencePack 作为已有上下文；是否需要补充搜索由模型通过工具调用决定。
    collector = ChapterEvidenceCollector(
        request.courseId,
        request.chapterId,
        request.courseTopic,
        request.chapter.title,
        task_title=request.task.title,
        task_goal=request.task.taskGoal,
    )
    evidence, sources = evidence_to_prompt(
        collector.pack,
        request.task.title,
        request.task.taskGoal,
        max_sources=3,
    )
    coverage = task_evidence_coverage(
        collector.pack,
        request.task.title,
        request.task.taskGoal,
    )

    system_prompt = build_task_content_prompt(
        request,
        evidence=evidence,
        sources=sources,
        memory_context=memory_context,
        # 搜索工具只在独立决策阶段使用；正文阶段不再向模型暴露搜索承诺。
        allow_search=False,
    )
    final_user_message = {"role": "user", "content": f"请撰写任务「{request.task.title}」的学习正文。"}
    messages = [
        {"role": "system", "content": system_prompt},
        final_user_message,
    ]

    started = time.monotonic()
    yield make_event("task_started", {"taskId": request.taskId, "title": request.task.title})
    if sources:
        yield make_event("sources_ready", {"sources": sources})

    parser = ContentStreamParser()
    started_blocks: set = set()
    accumulated = ""
    received_delta = False
    stream_usage = None
    try:
        needs_search_decision = (
            hasattr(client, "prepare_search_context")
            and not coverage["covered"]
        )
        print(
            f"[任务流] requestId={request_id} 证据覆盖={coverage['covered']} "
            f"命中词={coverage['matchedTerms']} 搜索判断={needs_search_decision}"
        )
        if needs_search_decision:
            decision_prompt = build_task_search_decision_prompt(
                request,
                evidence=evidence,
                sources=sources,
            )
            decision_messages = [
                {"role": "system", "content": decision_prompt},
                {
                    "role": "user",
                    "content": (
                        "只做检索判断：需要补充时调用搜索工具，否则只回复 NO_SEARCH。不要写正文。"
                    ),
                },
            ]
            try:
                await asyncio.to_thread(
                    client.prepare_search_context,
                    messages=decision_messages,
                    tools=SEARCH_TOOLS,
                    tool_functions=collector.tool_functions,
                    max_tokens=1200,
                    reasoning_split=True,
                    max_iterations=1,
                    max_searches=1,
                )
                # 检索决策使用紧凑 system prompt；正文仍必须使用完整教学 prompt。
                # 只保留工具调用产生的 assistant/tool 上下文，避免模型丢掉内容配方。
                tool_context = decision_messages[2:]
                messages = [
                    {"role": "system", "content": system_prompt},
                    *tool_context,
                    final_user_message,
                ]
                searched_evidence, searched_sources = evidence_to_prompt(
                    collector.pack,
                    request.task.title,
                    request.task.taskGoal,
                    max_sources=3,
                )
                if searched_sources and searched_sources != sources:
                    yield make_event("sources_ready", {"sources": searched_sources})
                evidence, sources = searched_evidence, searched_sources
            except Exception as exc:  # noqa: BLE001 搜索决策失败不应阻断正文
                print(f"[任务流] requestId={request_id} 搜索决策失败，继续生成正文: {exc}")

        # 推理型模型思考长度方差大，max_tokens 预算必须给思考留足余量。
        async for chunk in client.stream_chat(
            messages=messages,
            max_tokens=16000,
            include_usage=True,
            reasoning_effort=_TASK_CONTENT_REASONING_EFFORT,
        ):
            if not chunk.get("choices") and chunk.get("usage"):
                stream_usage = extract_usage(chunk)
                continue
            delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content", "")
            if not delta:
                continue
            received_delta = True
            accumulated += delta
            for pe in parser.feed(delta):
                for sse in _parser_event_to_sse(pe, make_event, started_blocks):
                    yield sse

        for pe in parser.finish():
            for sse in _parser_event_to_sse(pe, make_event, started_blocks):
                yield sse

    except Exception as exc:  # noqa: BLE001
        if received_delta:
            code, message = "UPSTREAM_STREAM_BROKEN", "内容流中断，请重试"
        else:
            code, message = classify_llm_error(exc)
        print(f"[任务流] requestId={request_id} 生成失败 code={code}: {exc}")
        yield make_event("request_error", {"code": code, "message": message, "retryable": True, "taskId": request.taskId})
        yield make_event("request_completed", {"requestId": request_id, "status": "failed", "errorCode": code})
        return

    if not accumulated.strip():
        yield make_event("request_error", {"code": "EMPTY_CONTENT", "message": "任务内容生成为空，请重试", "retryable": True, "taskId": request.taskId})
        yield make_event("request_completed", {"requestId": request_id, "status": "failed", "errorCode": "EMPTY_CONTENT"})
        return

    final_blocks = parser.collect_blocks()
    log_prose_findings(f"task:{request.taskId}", lint_task_blocks(final_blocks))
    if not final_blocks:
        final_blocks = [{"type": "markdown", "blockId": "b1", "markdown": accumulated.strip()}]

    clean_text = _MARKER_LINE_RE.sub("", accumulated)
    boundary_prompt: dict = {"takeaway": extract_takeaway(clean_text)}
    if request.nextTaskTitle:
        boundary_prompt["nextHint"] = f"接下来：{request.nextTaskTitle}"

    yield make_event("task_completed", {
        "task": {
            "taskId": request.taskId,
            "planVersion": request.planVersion,
            "title": request.task.title,
            "blocks": final_blocks,
            "boundaryPrompt": boundary_prompt,
            **({"sourceRefs": sources} if sources else {}),
            "generationMeta": {
                "promptVersion": PROMPT_VERSION,
                "modelVersion": client.model,
                "generatedAt": time.time_ns() // 1_000_000,
                "durationMs": int((time.monotonic() - started) * 1000),
                "degraded": False,
                **({"tokenUsage": stream_usage} if stream_usage else {}),
            },
        }
    })
    yield make_event("request_completed", {"requestId": request_id, "status": "completed"})

    print(f"[任务流] requestId={request_id} 完成 {len(final_blocks)} 块 耗时 {int((time.monotonic() - started) * 1000)}ms")
