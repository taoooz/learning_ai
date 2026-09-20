import asyncio

import httpx
import pytest

from schemas.learning_v2 import TaskStreamRequest
from services.task_content_service import extract_takeaway, stream_task_events
from services.content_stream_parser import ContentStreamParser, parse_content_blocks


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
    model = "fake-model"

    def __init__(self, deltas=(), error: Exception | None = None, error_after: int | None = None):
        self.deltas = list(deltas)
        self.error = error
        self.error_after = error_after

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


# ---- 流式事件序列 ----


def test_full_event_sequence_single_markdown():
    """无定界符纯 markdown → 单块流式（行缓冲粒度）"""
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

    assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))
    request_id = events[0]["requestId"]
    assert request_id.startswith("req-")

    # 行缓冲：chunk 1-2 合并为一个完整行
    full_text = "指令的核心是说清楚。\n\n> 好指令一次只说一件事。\n"
    assert events[5]["payload"]["block"]["markdown"] == full_text

    task = events[6]["payload"]["task"]
    assert task["blocks"][0]["markdown"] == full_text
    assert task["boundaryPrompt"]["takeaway"] == "好指令一次只说一件事。"
    assert task["boundaryPrompt"]["nextHint"] == "接下来：对比好坏指令"
    meta = task["generationMeta"]
    assert meta["promptVersion"] == "task-content-v3"
    assert meta["modelVersion"] == "fake-model"
    assert meta["degraded"] is False


def test_multi_block_event_sequence():
    """:::key_point 定界符 → markdown 结束 + 结构化块一次性产出 + 新 markdown 开始"""
    deltas = [
        "讲解文字。\n\n",
        ":::key_point\n标题：核心概念\n- 要点一\n- 要点二\n:::\n\n",
        "更多讲解。\n\n> 总结要点。",
    ]
    client = FakeStreamClient(deltas=deltas)
    events = _events(_request(), client)
    types = [e["type"] for e in events]

    # task_started → md b1 started/delta×2/completed → kp b2 completed → md b3 started/delta×3/completed → task_completed → request_completed
    assert types == [
        "task_started",
        "content_block_started",    # b1
        "content_block_delta",
        "content_block_delta",
        "content_block_completed",  # b1 markdown_end
        "content_block_completed",  # b2 key_point
        "content_block_started",    # b3
        "content_block_delta",
        "content_block_delta",
        "content_block_delta",
        "content_block_delta",      # 尾行（finish 补发）
        "content_block_completed",  # b3 markdown_end
        "task_completed",
        "request_completed",
    ]

    # 结构化块在完成事件中一次性产出
    kp_event = events[5]
    kp_block = kp_event["payload"]["block"]
    assert kp_block["type"] == "key_point"
    assert kp_block["title"] == "核心概念"
    assert kp_block["points"] == ["要点一", "要点二"]

    # task_completed blocks 按序号排列
    task = events[-2]["payload"]["task"]
    blocks = task["blocks"]
    assert len(blocks) == 3
    assert blocks[0]["type"] == "markdown"
    assert blocks[0]["markdown"].strip() == "讲解文字。"
    assert blocks[1]["type"] == "key_point"
    assert blocks[2]["type"] == "markdown"
    assert "更多讲解" in blocks[2]["markdown"]
    assert task["boundaryPrompt"]["takeaway"] == "总结要点。"


def test_multi_block_comparison_and_example():
    """:::comparison 和 :::example 块解析"""
    deltas = [
        "引入。\n\n",
        ":::comparison\n列：维度A | 维度B\n数据1 | 数据2\n数据3 | 数据4\n:::\n\n",
        ":::example\n标题：示例\n场景：场景描述\n内容：这是内容部分，超过八十字的完整例子。\n要点：一句话总结\n:::\n\n",
        "> 结尾要点。",
    ]
    client = FakeStreamClient(deltas=deltas)
    events = _events(_request(), client)
    task = events[-2]["payload"]["task"]
    blocks = task["blocks"]

    types = [b["type"] for b in blocks]
    assert types == ["markdown", "comparison", "example", "markdown"]

    comp = blocks[1]
    assert comp["columns"] == ["维度A", "维度B"]
    assert comp["rows"] == [["数据1", "数据2"], ["数据3", "数据4"]]

    example = blocks[2]
    assert example["title"] == "示例"
    assert example["context"] == "场景描述"
    assert "完整例子" in example["content"]
    assert example["takeaway"] == "一句话总结"


def test_no_delimiters_falls_back_to_single_markdown():
    """LLM 未输出 ::: 定界符 → 整体退化为单 markdown 块"""
    deltas = ["纯文本第一段。\n\n纯文本第二段。\n\n> 要点。"]
    client = FakeStreamClient(deltas=deltas)
    events = _events(_request(), client)
    task = events[-2]["payload"]["task"]
    assert len(task["blocks"]) == 1
    assert task["blocks"][0]["type"] == "markdown"


def test_last_task_omits_next_hint():
    client = FakeStreamClient(deltas=["正文。\n\n> 要点。"])
    events = _events(_request(), client)
    boundary = events[-2]["payload"]["task"]["boundaryPrompt"]
    assert boundary == {"takeaway": "要点。"}
    assert "nextHint" not in boundary


# ---- 错误处理 ----


def test_empty_content_emits_error():
    events = _events(_request(), client=FakeStreamClient(deltas=[]))
    types = [e["type"] for e in events]
    assert types == ["task_started", "request_error", "request_completed"]
    assert events[1]["payload"]["code"] == "EMPTY_CONTENT"
    assert events[2]["payload"]["status"] == "failed"


def test_whitespace_only_content_is_empty():
    events = _events(_request(), client=FakeStreamClient(deltas=["  \n", "\t "]))
    assert events[-2]["payload"]["code"] == "EMPTY_CONTENT"
    assert events[-1]["payload"]["status"] == "failed"


def test_timeout_before_stream_maps_to_llm_timeout():
    events = _events(_request(), client=FakeStreamClient(error=httpx.ReadTimeout("timeout")))
    types = [e["type"] for e in events]
    assert types == ["task_started", "request_error", "request_completed"]
    assert events[1]["payload"]["code"] == "LLM_TIMEOUT"


def test_connect_error_maps_to_llm_unavailable():
    events = _events(_request(), client=FakeStreamClient(error=httpx.ConnectError("refused")))
    assert events[-2]["payload"]["code"] == "LLM_UNAVAILABLE"


def test_rate_limited_maps_to_llm_rate_limited():
    response = httpx.Response(429, request=httpx.Request("POST", "http://llm.local/chat"))
    error = httpx.HTTPStatusError("429", request=response.request, response=response)
    events = _events(_request(), client=FakeStreamClient(error=error))
    assert events[-2]["payload"]["code"] == "LLM_RATE_LIMITED"


def test_stream_broken_midway():
    """流中断（已有增量但未满一行）→ UPSTREAM_STREAM_BROKEN"""
    client = FakeStreamClient(deltas=["第一段。", "第二段。"], error=httpx.ReadError("boom"), error_after=1)
    events = _events(_request(), client)
    types = [e["type"] for e in events]
    assert types == ["task_started", "request_error", "request_completed"]
    assert events[1]["payload"]["code"] == "UPSTREAM_STREAM_BROKEN"


# ---- takeaway 提取 ----


def test_extract_takeaway_last_quote_block():
    markdown = "正文。\n\n> 前面的要点\n\n继续。\n\n> 最后的可带走要点"
    assert extract_takeaway(markdown) == "最后的可带走要点"


def test_extract_takeaway_multiline_quote():
    markdown = "正文。\n\n> 第一行\n> 第二行"
    assert extract_takeaway(markdown) == "第一行 第二行"


def test_extract_takeaway_fallback_first_sentence():
    markdown = "第一段。\n\n末段第一句。后面的补充说明。"
    assert extract_takeaway(markdown) == "末段第一句。"


def test_extract_takeaway_empty():
    assert extract_takeaway("") == ""
    assert extract_takeaway("   \n\t  ") == ""


# ---- 解析器单元测试 ----


def test_parser_key_point_block():
    parser = ContentStreamParser()
    text = "正文。\n:::key_point\n标题：定义\n- 要点1\n- 要点2\n:::\n"
    parser.feed(text)
    parser.finish()
    blocks = parser.collect_blocks()
    assert len(blocks) == 2
    assert blocks[0]["type"] == "markdown"
    assert blocks[1]["type"] == "key_point"
    assert blocks[1]["title"] == "定义"
    assert blocks[1]["points"] == ["要点1", "要点2"]


def test_parser_incremental_feed():
    """分多次 feed 同一段文本 → 结果与一次性 feed 一致"""
    full_text = "引入。\n\n:::example\n标题：示例\n场景：背景\n内容：这是内容。\n要点：总结\n:::\n\n> 要点。"

    # 一次性
    p1 = ContentStreamParser()
    p1.feed(full_text)
    p1.finish()
    blocks_1 = p1.collect_blocks()

    # 逐字符
    p2 = ContentStreamParser()
    for ch in full_text:
        p2.feed(ch)
    p2.finish()
    blocks_2 = p2.collect_blocks()

    assert blocks_1 == blocks_2


def test_parse_content_blocks_no_delimiter():
    blocks = parse_content_blocks("纯文本。\n\n> 要点。")
    assert len(blocks) == 1
    assert blocks[0]["type"] == "markdown"


def test_parse_content_blocks_unterminated_block():
    """未闭合的结构化块降级为 markdown"""
    text = "正文。\n:::key_point\n- 要点1\n- 要点2"
    blocks = parse_content_blocks(text)
    assert all(b["type"] == "markdown" for b in blocks)
    assert "要点1" in blocks[-1]["markdown"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
