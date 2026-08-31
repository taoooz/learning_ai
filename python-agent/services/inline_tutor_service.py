"""
V2 流内答疑（Tutor）流式生成服务
产出与 types/learning-v2/events.ts LearningSseEvent 外壳对齐的结构化事件
（SSE 字节包装与 [DONE] 收尾在 main.py 端点层完成）

最小上下文红线（设计文档 §3.2）：请求只含当前任务的最小上下文，
事件中不生成 evidence 字段，错误只返回稳定 code/中文 message/retryable。
"""
import re
import time
from dataclasses import dataclass
from typing import AsyncGenerator
from uuid import uuid4

from lib.minimax import MiniMaxClient
from prompts.inline_tutor import build_inline_tutor_prompt
from schemas.tutor import InlineTutorRequest, InlineTutorResponse
from services.learning_v2_errors import classify_llm_error

PROMPT_VERSION = "inline-tutor-v1"
# 第一版固定单个 markdown 块（设计文档 §2.1）
BLOCK_ID = "tb1"

# Tutor 请求幂等键：tutor:{chapterId}:v{planVersion}:{taskId}:{questionId}
# 幂等键是请求中章节/计划版本的唯一来源（最小上下文不携带课程全量对象）
_TUTOR_KEY_RE = re.compile(
    r"^tutor:(?P<chapterId>.+):v(?P<planVersion>\d+):(?P<taskId>[^:]+):(?P<questionId>[^:]+)$"
)


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
            # 最小上下文不含 courseId（设计文档 §3.2），客户端守卫也不校验该字段
            "courseId": "",
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

    # 必须用 stream_chat（async）：stream_chat_sync 会阻塞事件循环
    accumulated = ""
    received_delta = False
    try:
        async for chunk in client.stream_chat(messages=messages, max_tokens=1000):
            delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content", "")
            if not delta:
                continue
            received_delta = True
            accumulated += delta
            # LLM 输出只进入 tutor_block_delta，服务端不生成其他内容
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

    if not accumulated.strip():
        yield make_event("request_error", {"code": "EMPTY_CONTENT", "message": "回答内容为空，请重试", "retryable": True})
        yield make_event("request_completed", {"requestId": request_id, "status": "failed", "errorCode": "EMPTY_CONTENT"})
        return

    now_ms = time.time_ns() // 1_000_000
    block = {"type": "markdown", "blockId": BLOCK_ID, "markdown": accumulated}
    yield make_event("tutor_block_completed", {"block": block})

    # 定稿回答经 InlineTutorResponse 校验（只允许 markdown 块、不得携带 evidence 等额外字段）
    response = InlineTutorResponse(
        questionId=request.question.questionId,
        blocks=[block],
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
