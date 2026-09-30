"""
V2 任务内容流式生成服务
产出与 types/learning-v2/events.ts LearningSseEvent 外壳对齐的结构化事件
（SSE 字节包装与 [DONE] 收尾在 main.py 端点层完成）

Content Recipe（切片 1）：按 teachingPattern 配方输出多块内容，
markdown 段落实时流式；:::type…::: 结构化块在完整接收后一次性产出。
"""
import re
import time
from typing import AsyncGenerator
from uuid import uuid4

from lib.minimax import MiniMaxClient, extract_usage
from services.search_evidence import build_evidence_pack_with_context, needs_search
from services.evidence_store import evidence_to_prompt, get_chapter_evidence, task_evidence_coverage
from services.content_stream_parser import ContentStreamParser
from prompts import build_prompt
from prompts.task_content import get_recipe
from schemas.learning_v2 import TaskStreamRequest
from services.chapter_plan_service import TEACHING_PATTERNS
from services.learning_v2_errors import classify_llm_error

PROMPT_VERSION = "task-content-v3"

_LEVEL_LABELS = {"beginner": "初级", "intermediate": "中级", "advanced": "高级"}

# 首句切分：中英文句末标点之后断开
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？!?])")

# 清理 ::: 定界符行（用于 extract_takeaway）
_MARKER_LINE_RE = re.compile(r"^:::(\w+)?\s*$", re.MULTILINE)


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
) -> str:
    """构建任务内容 system prompt（evidence 非空时注入搜索证据包，§搜索策略）"""
    learner = request.learnerStartingPoint
    learner_lines = [f"当前水平：{_LEVEL_LABELS.get(learner.estimatedLevel, learner.estimatedLevel)}"]
    if learner.confirmedKnowledge:
        learner_lines.append(f"已确认掌握：{'、'.join(learner.confirmedKnowledge)}")
    if learner.likelyGaps:
        learner_lines.append(f"潜在缺口：{'、'.join(learner.likelyGaps)}")

    if request.previousTasks:
        previous_lines = []
        for previous in request.previousTasks:
            line = f"- {previous.title}"
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
    return build_prompt(
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
        ) + _format_course_mission(request.courseMission) + _format_teaching_state(request.teachingState) + evidence_section


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
    elif kind == "structured_block":
        results.append(make_event("content_block_completed", {"block": event["block"]}))
    elif kind == "markdown_end":
        md = event["markdown"]
        if md.strip():
            block = {"type": "markdown", "blockId": event["blockId"], "markdown": md}
            results.append(make_event("content_block_completed", {"block": block}))

    return results


async def stream_task_events(request: TaskStreamRequest, client: MiniMaxClient | None = None) -> AsyncGenerator[dict, None]:
    """流式生成单个任务的学习内容，yield 完整事件 dict 序列

    正常序列：task_started → sources_ready? → N×(content_block_started/delta/completed)
    → task_completed → request_completed
    异常时发 request_error 后必须补发 request_completed（status=failed）
    """
    client = client or MiniMaxClient()
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

    # 证据策略：先判断章节 EvidencePack 是否覆盖当前任务；
    # 覆盖则直接复用，不足且任务本身需要外部证据时，才用章节标题联合任务标题补搜一次。
    evidence_pack = None
    chapter_pack = get_chapter_evidence(request.courseId, request.chapterId)
    coverage = task_evidence_coverage(
        chapter_pack,
        request.task.title,
        request.task.taskGoal,
    )
    if coverage.get("covered"):
        evidence, sources = evidence_to_prompt(
            chapter_pack,
            request.task.title,
            request.task.taskGoal,
            max_sources=3,
        )
        if evidence:
            evidence_pack = {"evidence": evidence, "sources": sources}
            print(f"[任务流] 复用章节证据包: {len(sources)} 个来源")
    elif needs_search(request.task.title, request.task.taskGoal):
        pack = await build_evidence_pack_with_context(
            request.courseTopic,
            request.task.title,
            request.task.taskGoal,
            request.chapter.title,
        )
        if pack:
            evidence_pack = pack
            print(f"[任务流] 任务级补搜证据包: {len(pack['sources'])} 个来源")

    # 章节证据未覆盖但任务无需外部证据时，仍用章节证据做轻量兜底，
    # 避免稳定概念任务因为中文分词偶然不匹配而额外搜索。
    if evidence_pack is None and chapter_pack:
        evidence, sources = evidence_to_prompt(
            chapter_pack,
            request.task.title,
            request.task.taskGoal,
            max_sources=2,
        )
        if evidence:
            evidence_pack = {"evidence": evidence, "sources": sources}

    system_prompt = build_task_content_prompt(
        request,
        evidence=evidence_pack["evidence"] if evidence_pack else None,
        sources=evidence_pack["sources"] if evidence_pack else None,
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"请撰写任务「{request.task.title}」的学习正文。"},
    ]

    started = time.monotonic()
    yield make_event("task_started", {"taskId": request.taskId, "title": request.task.title})
    if evidence_pack and evidence_pack.get("sources"):
        yield make_event("sources_ready", {"sources": evidence_pack["sources"]})

    parser = ContentStreamParser()
    started_blocks: set = set()
    accumulated = ""
    received_delta = False
    stream_usage = None
    try:
        # glm-5.3-flash 思考长度方差大（3.4k~12k 字），max_tokens 预算必须给思考留足余量
        async for chunk in client.stream_chat(messages=messages, max_tokens=16000, include_usage=True):
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
            **({"sourceRefs": evidence_pack["sources"]} if evidence_pack and evidence_pack.get("sources") else {}),
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
