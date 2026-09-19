"""
V2 任务内容流式生成服务
产出与 types/learning-v2/events.ts LearningSseEvent 外壳对齐的结构化事件
（SSE 字节包装与 [DONE] 收尾在 main.py 端点层完成）
"""
import re
import time
from typing import AsyncGenerator
from uuid import uuid4

from lib.minimax import MiniMaxClient, extract_usage
from prompts import build_prompt
from schemas.learning_v2 import TaskStreamRequest
from services.chapter_plan_service import TEACHING_PATTERNS
from services.learning_v2_errors import classify_llm_error

PROMPT_VERSION = "task-content-v1"
BLOCK_ID = "b1"

_LEVEL_LABELS = {"beginner": "初级", "intermediate": "中级", "advanced": "高级"}

# 首句切分：中英文句末标点之后断开
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？!?])")


def build_task_content_prompt(request: TaskStreamRequest) -> str:
    """构建任务内容 system prompt"""
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

    return build_prompt(
        "task_content",
        course_topic=request.courseTopic,
        chapter_title=request.chapter.title,
        chapter_goal=request.chapter.teachingGoal,
        task_title=request.task.title,
        task_goal=request.task.taskGoal,
        pattern_label=TEACHING_PATTERNS.get(request.task.teachingPattern, request.task.teachingPattern),
        observable_outcome=request.task.observableOutcome,
        learner_section="\n".join(learner_lines),
        previous_section=previous_section,
    )


def extract_takeaway(markdown: str) -> str:
    """提取可带走要点：优先最后一个 > 引用块；缺省取末段第一句；再缺省为空串"""
    # 从末尾向前收集最后一段连续的引用行
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

    # 无引用块：取最后一个非引用段落的第一句
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


async def stream_task_events(request: TaskStreamRequest, client: MiniMaxClient | None = None) -> AsyncGenerator[dict, None]:
    """流式生成单个任务的学习内容，yield 完整事件 dict 序列

    正常序列：task_started → content_block_started → N×content_block_delta
    → content_block_completed → task_completed → request_completed
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

    system_prompt = build_task_content_prompt(request)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"请撰写任务「{request.task.title}」的学习正文。"},
    ]

    started = time.monotonic()
    yield make_event("task_started", {"taskId": request.taskId, "title": request.task.title})
    yield make_event("content_block_started", {"blockId": BLOCK_ID, "blockType": "markdown"})

    # 必须用 stream_chat（async）：stream_chat_sync 会阻塞事件循环
    accumulated = ""
    received_delta = False
    stream_usage = None
    try:
        async for chunk in client.stream_chat(messages=messages, max_tokens=2000, include_usage=True):
            # include_usage：最后一个 chunk choices 为空、携带 usage（P5.4 观测）
            if not chunk.get("choices") and chunk.get("usage"):
                stream_usage = extract_usage(chunk)
                continue
            delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content", "")
            if not delta:
                continue
            received_delta = True
            accumulated += delta
            # 每个 LLM chunk 直接发一个增量事件，不再二次缓冲
            yield make_event("content_block_delta", {"blockId": BLOCK_ID, "delta": delta})
    except Exception as exc:  # noqa: BLE001 流的任何异常都统一走错误事件路径
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

    now_ms = time.time_ns() // 1_000_000
    block = {"type": "markdown", "blockId": BLOCK_ID, "markdown": accumulated}
    yield make_event("content_block_completed", {"block": block})

    boundary_prompt: dict = {"takeaway": extract_takeaway(accumulated)}
    if request.nextTaskTitle:
        boundary_prompt["nextHint"] = f"接下来：{request.nextTaskTitle}"

    yield make_event("task_completed", {
        "task": {
            "taskId": request.taskId,
            "planVersion": request.planVersion,
            "title": request.task.title,
            "blocks": [block],
            "boundaryPrompt": boundary_prompt,
            "generationMeta": {
                "promptVersion": PROMPT_VERSION,
                "modelVersion": getattr(client, "model", None) or "unknown",
                "generatedAt": now_ms,
                "durationMs": int((time.monotonic() - started) * 1000),
                "degraded": False,
                **({"tokenUsage": stream_usage} if stream_usage else {}),
            },
        },
    })
    yield make_event("request_completed", {"requestId": request_id, "status": "completed"})
