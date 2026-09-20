"""
V2 流内答疑（Tutor）流式生成服务
产出与 types/learning-v2/events.ts LearningSseEvent 外壳对齐的结构化事件
（SSE 字节包装与 [DONE] 收尾在 main.py 端点层完成）

最小上下文红线（设计文档 §3.2）：请求只含当前任务的最小上下文，
事件中不生成 evidence 字段，错误只返回稳定 code/中文 message/retryable。

P2 四意图：LLM 首行输出 [ACTION:type:reasonCode] 标记行，
服务端解析后剥离标记，action 随 tutor_completed 载荷下发。
"""
import re
import time
from dataclasses import dataclass
from typing import AsyncGenerator
from uuid import uuid4

from lib.minimax import MiniMaxClient
from prompts.inline_tutor import build_inline_tutor_prompt
from schemas.tutor import (
    InlineTutorRequest,
    InlineTutorResponse,
    TutorActionField,
)
from services.learning_v2_errors import classify_llm_error

PROMPT_VERSION = "inline-tutor-v2"
# 第一版固定单个 markdown 块（设计文档 §2.1）
BLOCK_ID = "tb1"

# Tutor 请求幂等键：tutor:{chapterId}:v{planVersion}:{taskId}:{questionId}
# 幂等键是请求中章节/计划版本的唯一来源（最小上下文不携带课程全量对象）
_TUTOR_KEY_RE = re.compile(
    r"^tutor:(?P<chapterId>.+):v(?P<planVersion>\d+):(?P<taskId>[^:]+):(?P<questionId>[^:]+)$"
)

# LLM 输出首行动作标记解析（P2 四意图 §2.6.2）
_ACTION_LINE_RE = re.compile(r"^\[ACTION:(\w+):(\w+)\]\s*\n?")
_ACTION_FALLBACK = TutorActionField(type="answer_inline", reasonCode="LOCAL_QUESTION")


class TutorRequestDataError(ValueError):
    """幂等键无效或与请求字段不一致；端点层在流开始前返回 422"""


@dataclass(frozen=True)
class TutorStreamError:
    """用户可见的答疑错误：稳定 code + 中文 message + retryable；
    不含堆栈、密钥或内部 URL（设计文档 §6）"""
    code: str
    message: str
    retryable: bool


def classify_tutor_error(exc: Exception) -> TutorStreamError:
    """将 LLM 调用异常分类为 Tutor 错误；与任务流一致均视为可重试

    复用既有 V2 错误分类约定（learning_v2_errors.classify_llm_error）；
    额外把内置/asyncio 超时（TimeoutError）也归为 LLM_TIMEOUT。
    """
    if isinstance(exc, TimeoutError):  # httpx.TimeoutException 不是其子类，走下方既有分类
        return TutorStreamError("LLM_TIMEOUT", "模型响应超时，请稍后重试", True)
    code, message = classify_llm_error(exc)
    return TutorStreamError(code, message, True)


def extract_tutor_envelope_ids(request: InlineTutorRequest) -> tuple[str, int]:
    """从幂等键解析事件外壳所需的 (chapterId, planVersion)（设计文档 §2.2 守卫字段）

    同时校验键内 taskId/questionId 与请求字段一致，
    防止过期/错配的键产出被客户端守卫拒写的无效事件流。
    """
    match = _TUTOR_KEY_RE.match(request.idempotencyKey)
    if not match:
        raise TutorRequestDataError("幂等键格式无效")
    if match["taskId"] != request.task.taskId:
        raise TutorRequestDataError("幂等键与当前任务不一致")
    if match["questionId"] != request.question.questionId:
        raise TutorRequestDataError("幂等键与当前问题不一致")
    return match["chapterId"], int(match["planVersion"])


def parse_action_marker(text: str) -> tuple[TutorActionField, str]:
    """从 LLM 累积输出中解析首行动作标记并剥离标记行

    返回 (action, 纯正文)；无标记或格式无效时回退 answer_inline。
    """
    match = _ACTION_LINE_RE.match(text)
    if not match:
        return _ACTION_FALLBACK, text.strip()
    try:
        action = TutorActionField(type=match.group(1), reasonCode=match.group(2))
    except Exception:  # noqa: BLE001  无效动作值回退
        return _ACTION_FALLBACK, text[match.end():].strip()
    return action, text[match.end():].strip()


async def stream_tutor_events(
    request: InlineTutorRequest,
    chapter_id: str,
    plan_version: int,
    client: MiniMaxClient | None = None,
) -> AsyncGenerator[dict, None]:
    """流式生成 Tutor 回答，yield 完整事件 dict 序列

    正常序列：tutor_started → tutor_block_started → N×tutor_block_delta
    → tutor_block_completed → tutor_completed → request_completed
    异常时发 request_error 后必须补发 request_completed（status=failed）

    P2 四意图：LLM 输出首行 [ACTION:...] 标记行在 tutor_block_delta 中照常流式下发
    （客户端只渲染 delta 文本标记行不影响体验），tutor_completed 载荷的 action 字段
    为解析后的教学动作。标记行不在 tutor_block_completed 的最终 markdown 中出现。
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
            "chapterId": chapter_id,
            "taskId": request.task.taskId,
            "questionId": request.question.questionId,
            "planVersion": plan_version,
            "sequence": sequence,
            "timestamp": time.time_ns() // 1_000_000,
            "payload": payload,
        }

    system_prompt = build_inline_tutor_prompt(request)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": request.question.text},
    ]

    started = time.monotonic()
    yield make_event("tutor_started", {"questionId": request.question.questionId})
    yield make_event("tutor_block_started", {"blockId": BLOCK_ID})

    accumulated = ""
    received_delta = False
    # 动作标记 buffer：LLM 首行 [ACTION:type:reasonCode] 不下发 delta，
    # 直到标记解析完毕或确定无标记后才流式输出正文
    MARKER_PREFIX = "[ACTION:"
    MAX_MARKER_DETECT_CHARS = 100
    marker_resolved = False
    marker_check_buffer = ""
    try:
        # 思考预算与正文分离计数：1500 曾致答疑偶发空内容（9/6 同源教训）
        async for chunk in client.stream_chat(messages=messages, max_tokens=8000):
            delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content", "")
            if not delta:
                continue
            received_delta = True
            accumulated += delta
            if not marker_resolved:
                marker_check_buffer += delta
                if marker_check_buffer.startswith(MARKER_PREFIX):
                    # 已确认标记前缀 → 等换行确认标记完整
                    if "\n" in marker_check_buffer:
                        marker_resolved = True
                        newline_idx = marker_check_buffer.index("\n")
                        clean_start = marker_check_buffer[newline_idx + 1:].lstrip("\n")
                        if clean_start:
                            yield make_event("tutor_block_delta", {"blockId": BLOCK_ID, "delta": clean_start})
                    elif len(marker_check_buffer) > MAX_MARKER_DETECT_CHARS:
                        marker_resolved = True
                        yield make_event("tutor_block_delta", {"blockId": BLOCK_ID, "delta": marker_check_buffer})
                elif MARKER_PREFIX.startswith(marker_check_buffer):
                    # 仍是标记前缀（如 [ACT）→ 继续等更多字符
                    pass
                else:
                    # 不是标记 → 全量下发
                    marker_resolved = True
                    yield make_event("tutor_block_delta", {"blockId": BLOCK_ID, "delta": marker_check_buffer})
            else:
                yield make_event("tutor_block_delta", {"blockId": BLOCK_ID, "delta": delta})
    except Exception as exc:  # noqa: BLE001 流的任何异常都统一走错误事件路径
        if received_delta:
            code, message = "UPSTREAM_STREAM_BROKEN", "回答流中断，请重试"
        else:
            error = classify_tutor_error(exc)
            code, message = error.code, error.message
        print(f"[流内答疑] requestId={request_id} 生成失败 code={code}: {exc}")
        yield make_event("request_error", {"code": code, "message": message, "retryable": True})
        yield make_event("request_completed", {"requestId": request_id, "status": "failed", "errorCode": code})
        return

    action, markdown_content = parse_action_marker(accumulated)

    if not markdown_content.strip():
        yield make_event("request_error", {"code": "EMPTY_CONTENT", "message": "回答内容为空，请重试", "retryable": True})
        yield make_event("request_completed", {"requestId": request_id, "status": "failed", "errorCode": "EMPTY_CONTENT"})
        return

    now_ms = time.time_ns() // 1_000_000
    block = {"type": "markdown", "blockId": BLOCK_ID, "markdown": markdown_content}
    yield make_event("tutor_block_completed", {"block": block})

    response = InlineTutorResponse(
        questionId=request.question.questionId,
        blocks=[block],
        action=action,
        generationMeta={
            "promptVersion": PROMPT_VERSION,
            "modelVersion": getattr(client, "model", None) or "unknown",
            "generatedAt": now_ms,
            "durationMs": int((time.monotonic() - started) * 1000),
            "degraded": False,
        },
    )
    yield make_event("tutor_completed", response.model_dump())
    yield make_event("request_completed", {"requestId": request_id, "status": "completed"})
