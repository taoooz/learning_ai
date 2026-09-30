import asyncio

import httpx
import pytest

from schemas.learning_v2 import TaskStreamRequest
from services.task_content_service import build_task_content_prompt, extract_takeaway, stream_task_events
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
    """无定界符纯 markdown → 单块流式（未满一行的正文立即发出）"""
    client = FakeStreamClient(deltas=["指令的核心是", "说清楚。\n\n", "> 好指令一次只说一件事。"])
    events = _events(_request(nextTaskTitle="对比好坏指令"), client)

    types = [e["type"] for e in events]
    assert types == [
        "task_started",
        "content_block_started",
        "content_block_delta",
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

    # 未满一行的正文立即流式；换行后的完整行仍合并输出
    full_text = "指令的核心是说清楚。\n\n> 好指令一次只说一件事。"
    assert events[6]["payload"]["block"]["markdown"] == full_text

    task = events[7]["payload"]["task"]
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
    """流中断（已输出过增量）→ UPSTREAM_STREAM_BROKEN"""
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
    assert events[-2]["payload"]["code"] == "UPSTREAM_STREAM_BROKEN"


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


def test_parser_streams_markdown_before_newline():
    """markdown 未满一行时也能立即输出，而不是等换行"""
    parser = ContentStreamParser()
    first = parser.feed("第一段")
    second = parser.feed("继续")
    finish = parser.finish()
    all_events = first + second + finish
    deltas = [e["delta"] for e in all_events if e["kind"] == "markdown_delta"]
    assert deltas == ["第一段", "继续"]
    blocks = parser.collect_blocks()
    assert blocks[0]["markdown"] == "第一段继续"


def test_parser_holds_marker_prefix_until_newline():
    """::: 前缀必须缓冲，不能把半截标记当正文输出"""
    parser = ContentStreamParser()
    assert parser.feed(":::") == []
    assert parser.feed("key_point\n标题：定义\n- 要点1\n:::\n")
    blocks = parser.collect_blocks()
    assert [b["type"] for b in blocks] == ["key_point"]


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


# ---- 切片 2：结构判分 ----

from scripts.evaluate_content_quality import score_structure  # noqa: E402


def test_score_structure_all_pass():
    topic = {
        "expectedBlocks": ["markdown", "key_point"],
        "minMarkdownChars": 100,
        "minKeyPointCount": 2,
    }
    blocks = [
        {"type": "markdown", "blockId": "b1", "markdown": "x" * 150},
        {"type": "key_point", "blockId": "b2", "points": ["a", "b"]},
    ]
    result = score_structure(topic, blocks)
    assert result["percent"] == 100
    assert all(c["pass"] for c in result["checks"])


def test_score_structure_missing_block():
    topic = {"expectedBlocks": ["markdown", "comparison"], "minMarkdownChars": 50}
    blocks = [{"type": "markdown", "blockId": "b1", "markdown": "x" * 100}]
    result = score_structure(topic, blocks)
    assert result["percent"] < 100
    failed = [c for c in result["checks"] if not c["pass"]]
    assert any("comparison" in c["name"] for c in failed)


def test_score_structure_empty_blocks():
    topic = {"expectedBlocks": ["markdown"], "minMarkdownChars": 100}
    result = score_structure(topic, [])
    assert result["percent"] == 0


# ---- 切片 3：diagram 块 ----

def test_parser_diagram_block():
    text = '正文。\n:::diagram\nflowchart TD\nA["开始"] --> B["结束"]\n:::\n'
    blocks = parse_content_blocks(text)
    assert len(blocks) == 2
    assert blocks[1]["type"] == "diagram"
    assert blocks[1]["language"] == "mermaid"
    assert "flowchart TD" in blocks[1]["source"]
    assert '-->' in blocks[1]["source"]


def test_parser_diagram_empty_source():
    blocks = parse_content_blocks(":::diagram\n:::\n")
    assert all(b["type"] != "diagram" for b in blocks)


def test_task_level_search_uses_chapter_title_when_chapter_evidence_is_insufficient():
    """章节证据不足且任务需要外部证据时：任务级补搜携带章节标题联合查询。"""
    from unittest.mock import patch
    import services.task_content_service as service

    captured = {}

    async def fake_build(course_topic, task_title, task_goal, chapter_title=""):
        captured.update({
            "courseTopic": course_topic,
            "taskTitle": task_title,
            "taskGoal": task_goal,
            "chapterTitle": chapter_title,
        })
        return {
            "evidence": "- React useActionState\n  官方 API\n  来源: https://react.dev/reference/react/useactionstate",
            "sources": [{"title": "React useActionState", "url": "https://react.dev/reference/react/useactionstate"}],
        }

    fake_pack = {
        "sources": [{
            "title": "React 19 release notes",
            "url": "https://react.dev/blog/react-19",
            "summary": "React 19 changes",
            "authorityScore": 90,
        }]
    }

    request = _request()
    request.chapter.title = "表单与状态"

    with patch.object(service, "get_chapter_evidence", return_value=fake_pack), \
         patch.object(service, "task_evidence_coverage", return_value={"covered": False, "matchedTerms": 0}), \
         patch.object(service, "needs_search", return_value=True), \
         patch.object(service, "build_evidence_pack_with_context", side_effect=fake_build):
        events = _events(request, FakeStreamClient(deltas=["正文。\n\n> 要点。"]))

    assert captured == {
        "courseTopic": "提示词工程实践",
        "taskTitle": "指令为什么需要说清楚",
        "taskGoal": "理解指令三要素",
        "chapterTitle": "表单与状态",
    }
    sources_event = next(event for event in events if event["type"] == "sources_ready")
    assert sources_event["payload"]["sources"][0]["url"] == "https://react.dev/reference/react/useactionstate"


def test_stable_task_reuses_chapter_evidence_without_extra_search():
    """章节证据弱覆盖但任务本身无需搜索：仍复用章节证据，不额外请求。"""
    from unittest.mock import patch
    import services.task_content_service as service

    fake_pack = {
        "sources": [{
            "title": "React 19 release notes",
            "url": "https://react.dev/blog/react-19",
            "summary": "React 19 changes",
            "authorityScore": 90,
        }]
    }

    async def fail_build(*args, **kwargs):
        raise AssertionError("稳定任务不应触发补搜")

    request = _request()
    with patch.object(service, "get_chapter_evidence", return_value=fake_pack), \
         patch.object(service, "task_evidence_coverage", return_value={"covered": False, "matchedTerms": 0}), \
         patch.object(service, "needs_search", return_value=False), \
         patch.object(service, "build_evidence_pack_with_context", side_effect=fail_build):
        events = _events(request, FakeStreamClient(deltas=["正文。\n\n> 要点。"]))

    assert any(event["type"] == "sources_ready" for event in events)


def test_parser_extracts_block_evidence_refs_without_polluting_content():
    text = '''正文。

:::key_point
标题：协商缓存
- 通过 ETag 验证资源是否变化
证据：ev-01, ev-02
:::
'''
    blocks = parse_content_blocks(text)
    assert blocks[1]["type"] == "key_point"
    assert blocks[1]["evidenceRefs"] == ["ev-01", "ev-02"]
    assert blocks[1]["points"] == ["通过 ETag 验证资源是否变化"]


def test_task_content_prompt_injects_course_mission():
    request = _request()
    request.courseMission = {
        "why": "我要用 HTTP 缓存优化页面",
        "targetScenario": "前端性能优化",
        "successCriteria": ["能配置缓存策略"],
        "outOfScope": ["后端存储"],
    }
    prompt = build_task_content_prompt(request)
    assert "课程使命" in prompt
    assert "我要用 HTTP 缓存优化页面" in prompt
    assert "前端性能优化" in prompt
    assert "能配置缓存策略" in prompt
    assert "后端存储" in prompt


def test_task_content_prompt_injects_teaching_state():
    request = _request()
    request.teachingState = {
        "insights": [{
            "content": "前序章节已理解缓存命中",
            "status": "candidate",
        }],
        "notes": [{"content": "用户偏好实操例子"}],
    }
    prompt = build_task_content_prompt(request)
    assert "teaching_state" in prompt
    assert "前序章节已理解缓存命中" in prompt
    assert "用户偏好实操例子" in prompt
