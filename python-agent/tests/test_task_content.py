import asyncio

import httpx
import pytest

from schemas.learning_v2 import TaskStreamRequest
from services.task_content_service import extract_takeaway, stream_task_events


def _request(**overrides) -> TaskStreamRequest:
    base = dict(
        courseId="course-1",
        chapterId="ch-1",
        planId="plan-abc123",
        planVersion=1,
        taskId="t1",
        attempt=1,
        task={
            "taskId": "t1",
            "title": "指令为什么需要说清楚",
            "taskGoal": "理解指令三要素",
            "teachingPattern": "explain",
            "observableOutcome": "能说出好指令包含什么",
        },
        chapter={"title": "指令写作基础", "teachingGoal": "理解指令的基本结构"},
        courseTopic="提示词工程实践",
        learnerStartingPoint={
            "estimatedLevel": "beginner",
            "confirmedKnowledge": ["会用基础对话"],
            "likelyGaps": ["不清楚上下文机制"],
        },
    )
    base.update(overrides)
    return TaskStreamRequest(**base)


class FakeStreamClient:
    """假 LLM 客户端：stream_chat 产出预置增量；可选在开头或第 N 个增量后抛异常"""
    model = "fake-model"

    def __init__(self, deltas=(), error: Exception | None = None, error_after: int | None = None):
        self.deltas = list(deltas)
        self.error = error
        self.error_after = error_after  # 发出 N 个增量后抛错；None 表示开始前抛错

    async def stream_chat(self, messages, model=None, max_tokens=1500, include_usage=False):
        if self.error is not None and self.error_after is None:
            raise self.error
        for index, delta in enumerate(self.deltas):
            if self.error_after is not None and index == self.error_after:
                raise self.error
            yield {"choices": [{"delta": {"content": delta}}]}


async def _collect(gen):
    return [event async for event in gen]


def _events(request: TaskStreamRequest, client) -> list[dict]:
    return asyncio.run(_collect(stream_task_events(request, client=client)))


def test_full_event_sequence():
    """正常序列：类型顺序、sequence 递增、eventId 格式、字段齐全"""
    client = FakeStreamClient(deltas=["指令的核心是", "说清楚。\n\n", "> 好指令一次只说一件事。"])
    events = _events(_request(nextTaskTitle="对比好坏指令"), client)

    types = [e["type"] for e in events]
    assert types == [
        "task_started",
        "content_block_started",
        "content_block_delta",
        "content_block_delta",
        "content_block_delta",
        "content_block_completed",
        "task_completed",
        "request_completed",
    ]

    # sequence 从 1 严格递增，eventId = requestId:sequence
    assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))
    request_id = events[0]["requestId"]
    assert request_id.startswith("req-")
    for index, event in enumerate(events, 1):
        assert event["eventId"] == f"{request_id}:{index}"
        assert event["requestId"] == request_id
        assert event["courseId"] == "course-1"
        assert event["chapterId"] == "ch-1"
        assert event["taskId"] == "t1"
        assert event["planVersion"] == 1
        assert isinstance(event["timestamp"], int)
        assert "payload" in event

    assert events[0]["payload"] == {"taskId": "t1", "title": "指令为什么需要说清楚"}
    assert events[1]["payload"] == {"blockId": "b1", "blockType": "markdown"}

    # 完成块 = 全部增量累积
    full_text = "指令的核心是说清楚。\n\n> 好指令一次只说一件事。"
    assert events[5]["payload"]["block"] == {"type": "markdown", "blockId": "b1", "markdown": full_text}

    task = events[6]["payload"]["task"]
    assert task["taskId"] == "t1"
    assert task["planVersion"] == 1
    assert task["title"] == "指令为什么需要说清楚"
    assert task["blocks"][0]["markdown"] == full_text
    assert task["boundaryPrompt"]["takeaway"] == "好指令一次只说一件事。"
    assert task["boundaryPrompt"]["nextHint"] == "接下来：对比好坏指令"
    meta = task["generationMeta"]
    assert meta["promptVersion"] == "task-content-v2"
    assert meta["modelVersion"] == "fake-model"
    assert meta["degraded"] is False
    assert isinstance(meta["generatedAt"], int)
    assert isinstance(meta["durationMs"], int)

    assert events[7]["payload"] == {"requestId": request_id, "status": "completed"}


def test_last_task_omits_next_hint():
    """末任务（无 nextTaskTitle）时 boundaryPrompt 不含 nextHint"""
    client = FakeStreamClient(deltas=["正文。\n\n> 要点。"])
    events = _events(_request(), client)
    boundary = events[-2]["payload"]["task"]["boundaryPrompt"]
    assert boundary == {"takeaway": "要点。"}
    assert "nextHint" not in boundary


def test_empty_content_emits_error():
    """累积内容为空 → request_error(EMPTY_CONTENT) + request_completed(failed)"""
    events = _events(_request(), client=FakeStreamClient(deltas=[]))
    types = [e["type"] for e in events]
    assert types == ["task_started", "content_block_started", "request_error", "request_completed"]

    error_payload = events[2]["payload"]
    assert error_payload["code"] == "EMPTY_CONTENT"
    assert error_payload["message"] == "任务内容生成为空，请重试"
    assert error_payload["retryable"] is True
    assert error_payload["taskId"] == "t1"

    completed = events[3]["payload"]
    assert completed["status"] == "failed"
    assert completed["errorCode"] == "EMPTY_CONTENT"
    assert completed["requestId"] == events[0]["requestId"]


def test_whitespace_only_content_is_empty():
    """只有空白字符也按空内容处理"""
    events = _events(_request(), client=FakeStreamClient(deltas=["  \n", "\t "]))
    assert events[-2]["payload"]["code"] == "EMPTY_CONTENT"
    assert events[-1]["payload"]["status"] == "failed"


def test_timeout_before_stream_maps_to_llm_timeout():
    """流开始前超时 → LLM_TIMEOUT + request_completed(failed)"""
    events = _events(_request(), client=FakeStreamClient(error=httpx.ReadTimeout("timeout")))
    types = [e["type"] for e in events]
    assert types == ["task_started", "content_block_started", "request_error", "request_completed"]
    assert events[2]["payload"]["code"] == "LLM_TIMEOUT"
    assert events[2]["payload"]["retryable"] is True
    assert events[3]["payload"]["errorCode"] == "LLM_TIMEOUT"


def test_connect_error_maps_to_llm_unavailable():
    """连接失败 → LLM_UNAVAILABLE"""
    events = _events(_request(), client=FakeStreamClient(error=httpx.ConnectError("refused")))
    assert events[-2]["payload"]["code"] == "LLM_UNAVAILABLE"
    assert events[-1]["payload"]["status"] == "failed"


def test_rate_limited_maps_to_llm_rate_limited():
    """HTTP 429 → LLM_RATE_LIMITED"""
    response = httpx.Response(429, request=httpx.Request("POST", "http://llm.local/chat"))
    error = httpx.HTTPStatusError("429", request=response.request, response=response)
    events = _events(_request(), client=FakeStreamClient(error=error))
    assert events[-2]["payload"]["code"] == "LLM_RATE_LIMITED"


def test_stream_broken_midway():
    """流中断（已有增量）→ UPSTREAM_STREAM_BROKEN，已发增量保留在序列中"""
    client = FakeStreamClient(deltas=["第一段。", "第二段。"], error=httpx.ReadError("boom"), error_after=1)
    events = _events(_request(), client)
    types = [e["type"] for e in events]
    assert types == [
        "task_started",
        "content_block_started",
        "content_block_delta",
        "request_error",
        "request_completed",
    ]
    assert events[3]["payload"]["code"] == "UPSTREAM_STREAM_BROKEN"
    assert events[3]["payload"]["retryable"] is True
    assert events[4]["payload"]["errorCode"] == "UPSTREAM_STREAM_BROKEN"
    # sequence 全程严格递增
    assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))


def test_extract_takeaway_last_quote_block():
    """优先取最后一个引用块"""
    markdown = "正文。\n\n> 前面的要点\n\n继续。\n\n> 最后的可带走要点"
    assert extract_takeaway(markdown) == "最后的可带走要点"


def test_extract_takeaway_multiline_quote():
    """多行引用块合并为一句"""
    markdown = "正文。\n\n> 第一行\n> 第二行"
    assert extract_takeaway(markdown) == "第一行 第二行"


def test_extract_takeaway_fallback_first_sentence():
    """无引用块时取末段第一句"""
    markdown = "第一段。\n\n末段第一句。后面的补充说明。"
    assert extract_takeaway(markdown) == "末段第一句。"


def test_extract_takeaway_empty():
    assert extract_takeaway("") == ""
    assert extract_takeaway("   \n\t  ") == ""


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
