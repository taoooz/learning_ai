"""evals/trace.py 契约测试：mock LLM 下验证 trace 完整性与零副作用。

覆盖：
- EVAL_TRACE_DIR 未设置：零行为变化、零写盘；
- 契约四件套（request/raw/parsed/meta）+ spec/evidence/course/run_meta；
- raw 捕获先于修复链（fence_strip / quote_repair 场景）；
- fallback_level 与降级记录；多次调用历史 calls.json；
- 请求快照白名单（不记录 API key）与深快照隔离；
- 写盘失败不影响主流程；流式捕获（含中断）。
"""
import asyncio
import json

import pytest

from evals import trace as eval_trace
from lib.minimax import MiniMaxClient, parse_enforced_json, parse_json_response


@pytest.fixture(autouse=True)
def _reset_trace_state():
    yield
    eval_trace.end_spec()


# ---------------------------------------------------------------------------
# mock httpx（与 tests/test_minimax_client.py 同范式）
# ---------------------------------------------------------------------------

class _FakeResponse:
    status_code = 200

    def __init__(self, content: str):
        self._content = content

    def raise_for_status(self):
        pass

    def json(self):
        return {
            "choices": [{"message": {"content": self._content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        }


def _fake_async_client(content: str):
    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, headers=None, json=None, timeout=None):
            return _FakeResponse(content)

    return FakeAsyncClient


def _fake_stream_client(lines: list[str]):
    class FakeStreamResponse:
        status_code = 200

        def raise_for_status(self):
            pass

        async def aiter_lines(self):
            for line in lines:
                yield line

    class FakeStreamContext:
        async def __aenter__(self):
            return FakeStreamResponse()

        async def __aexit__(self, *exc):
            return False

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, method, url, headers=None, json=None, timeout=None):
            return FakeStreamContext()

    return FakeAsyncClient


def _client() -> MiniMaxClient:
    return MiniMaxClient(api_key="test-key", base_url="http://test.local/v1")


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 开关关闭：零副作用
# ---------------------------------------------------------------------------

def test_disabled_zero_side_effects(tmp_path, monkeypatch):
    monkeypatch.delenv("EVAL_TRACE_DIR", raising=False)
    monkeypatch.setattr("lib.minimax.httpx.AsyncClient", _fake_async_client('{"ok": true}'))

    assert eval_trace.is_enabled() is False
    assert eval_trace.begin_spec("run-x", "spec-x", {"topic": "t"}) is None
    assert eval_trace.current_spec_dir() is None
    with eval_trace.stage("architect_chapters"):
        response = asyncio.run(_client().chat([{"role": "user", "content": "hi"}]))
        assert parse_json_response(response["choices"][0]["message"]["content"]) == {"ok": True}
        eval_trace.record_evidence({"sources": []}, stage="chapter_plan")
    eval_trace.write_course({"x": 1})
    eval_trace.write_run_meta("run-x", {"x": 1})
    assert eval_trace.stage_call_counts() == {}
    assert list(tmp_path.iterdir()) == []


# ---------------------------------------------------------------------------
# 契约完整性（mock LLM 全路径）
# ---------------------------------------------------------------------------

def test_chat_trace_contract(tmp_path, monkeypatch):
    monkeypatch.setenv("EVAL_TRACE_DIR", str(tmp_path))
    monkeypatch.setattr("lib.minimax.httpx.AsyncClient", _fake_async_client('{"ok": true}'))
    spec_dir = eval_trace.begin_spec("run-1", "spec-1", {"id": "spec-1", "topic": "装饰器"})
    assert spec_dir == tmp_path / "run-1" / "spec-1"

    rf = {"type": "json_schema", "json_schema": {"name": "course_chapters", "strict": True, "schema": {}}}
    with eval_trace.stage("architect_chapters"):
        response = asyncio.run(_client().chat([{"role": "user", "content": "hi"}], response_format=rf))
        parse_json_response(response["choices"][0]["message"]["content"])
    eval_trace.end_spec()

    assert _read(spec_dir / "spec.json")["topic"] == "装饰器"
    request = _read(spec_dir / "stage_architect_chapters_request.json")
    assert request["model"] == _client().model
    assert request["messages"] == [{"role": "user", "content": "hi"}]
    assert request["response_format"]["type"] == "json_schema"
    assert (spec_dir / "stage_architect_chapters_raw.txt").read_text(encoding="utf-8") == '{"ok": true}'
    assert _read(spec_dir / "stage_architect_chapters_parsed.json") == {"ok": True}
    meta = _read(spec_dir / "stage_architect_chapters_meta.json")
    assert meta["model"] == _client().model
    assert isinstance(meta["latency_ms"], int) and meta["latency_ms"] >= 0
    assert meta["usage"]["total_tokens"] == 30
    assert meta["repair_applied"] is False
    assert meta["fallback_level"] == "strict"
    assert meta["call_count"] == 1
    assert meta["source"] == "minimax.chat"
    assert not (spec_dir / "stage_architect_chapters_calls.json").exists()


def test_raw_captured_before_fence_repair(tmp_path, monkeypatch):
    original = '```json\n{"ok": true}\n```'
    monkeypatch.setenv("EVAL_TRACE_DIR", str(tmp_path))
    monkeypatch.setattr("lib.minimax.httpx.AsyncClient", _fake_async_client(original))
    spec_dir = eval_trace.begin_spec("run-1", "spec-1", {"topic": "t"})
    with eval_trace.stage("architect_meta"):
        response = asyncio.run(_client().chat([{"role": "user", "content": "hi"}]))
        parsed = parse_json_response(response["choices"][0]["message"]["content"])
    eval_trace.end_spec()

    assert parsed == {"ok": True}
    # raw 必须是修复前原文（含围栏），parsed 是修复后产物
    assert (spec_dir / "stage_architect_meta_raw.txt").read_text(encoding="utf-8") == original
    meta = _read(spec_dir / "stage_architect_meta_meta.json")
    assert meta["repair_applied"] is True
    assert "fence_strip" in meta["repair_steps"]


def test_raw_captured_before_quote_repair(tmp_path, monkeypatch):
    original = '{"text": "a "b" c"}'
    monkeypatch.setenv("EVAL_TRACE_DIR", str(tmp_path))
    monkeypatch.setattr("lib.minimax.httpx.AsyncClient", _fake_async_client(original))
    spec_dir = eval_trace.begin_spec("run-1", "spec-1", {"topic": "t"})
    with eval_trace.stage("chapter_plan"):
        response = asyncio.run(_client().chat([{"role": "user", "content": "hi"}]))
        parsed = parse_json_response(response["choices"][0]["message"]["content"])
    eval_trace.end_spec()

    assert parsed == {"text": 'a "b" c'}
    assert (spec_dir / "stage_chapter_plan_raw.txt").read_text(encoding="utf-8") == original
    meta = _read(spec_dir / "stage_chapter_plan_meta.json")
    assert meta["repair_applied"] is True
    assert "quote_repair" in meta["repair_steps"]
    assert _read(spec_dir / "stage_chapter_plan_parsed.json") == {"text": 'a "b" c'}


def test_parse_enforced_json_trace_markers(tmp_path, monkeypatch):
    monkeypatch.setenv("EVAL_TRACE_DIR", str(tmp_path))
    spec_dir = eval_trace.begin_spec("run-1", "spec-1", {"topic": "t"})
    with eval_trace.stage("chapter_plan"):
        parse_enforced_json('{"a": 1}')
    meta = _read(spec_dir / "stage_chapter_plan_meta.json") if (spec_dir / "stage_chapter_plan_meta.json").exists() else None
    # 无 LLM 调用时只有 parsed（无 request/raw/meta 四件套）
    assert meta is None
    assert _read(spec_dir / "stage_chapter_plan_parsed.json") == {"a": 1}

    with eval_trace.stage("architect_chapters"):
        eval_trace.capture_llm_response(
            {"choices": [{"message": {"content": '说明文字 {"a": 1} 尾注'}}]},
            request={"model": "m", "messages": []},
        )
        parse_enforced_json('说明文字 {"a": 1} 尾注')
    meta = _read(spec_dir / "stage_architect_chapters_meta.json")
    assert meta["repair_applied"] is True
    assert "json_slice" in meta["repair_steps"]
    eval_trace.end_spec()


# ---------------------------------------------------------------------------
# fallback_level / 降级 / 多次调用 / 快照安全
# ---------------------------------------------------------------------------

def test_fallback_level_and_downgrade(tmp_path, monkeypatch):
    monkeypatch.setenv("EVAL_TRACE_DIR", str(tmp_path))
    spec_dir = eval_trace.begin_spec("run-1", "spec-1", {"topic": "t"})
    with eval_trace.stage("architect_chapters"):
        eval_trace.capture_llm_response(
            {"choices": [{"message": {"content": "{}"}}]},
            request={"model": "m", "messages": [], "response_format": {"type": "json_object"}},
            initial_response_format="json_schema",
        )
    meta = _read(spec_dir / "stage_architect_chapters_meta.json")
    assert meta["fallback_level"] == "json_object"
    assert meta["response_format_initial"] == "json_schema"
    assert meta["response_format_downgraded"] is True

    with eval_trace.stage("search_decision"):
        eval_trace.capture_llm_response(
            {"choices": [{"message": {"content": "NO_SEARCH"}}]},
            request={"model": "m", "messages": []},
        )
    meta = _read(spec_dir / "stage_search_decision_meta.json")
    assert meta["fallback_level"] == "none"
    eval_trace.end_spec()


def test_multi_call_history_keeps_first_raw(tmp_path, monkeypatch):
    monkeypatch.setenv("EVAL_TRACE_DIR", str(tmp_path))
    spec_dir = eval_trace.begin_spec("run-1", "spec-1", {"topic": "t"})
    with eval_trace.stage("architect_chapters"):
        for content in ('{"bad": ', '{"ok": true}'):
            eval_trace.capture_llm_response(
                {"choices": [{"message": {"content": content}}]},
                request={"model": "m", "messages": []},
            )
        parse_enforced_json('{"ok": true}')
    meta = _read(spec_dir / "stage_architect_chapters_meta.json")
    assert meta["call_count"] == 2
    calls = _read(spec_dir / "stage_architect_chapters_calls.json")
    assert [c["raw"] for c in calls] == ['{"bad": ', '{"ok": true}']
    # 契约文件取最后一次调用；最初原始输出保留在 calls.json
    assert (spec_dir / "stage_architect_chapters_raw.txt").read_text(encoding="utf-8") == '{"ok": true}'
    assert eval_trace.stage_call_counts() == {"architect_chapters": 2}
    eval_trace.end_spec()


def test_request_snapshot_no_secrets_and_isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("EVAL_TRACE_DIR", str(tmp_path))
    spec_dir = eval_trace.begin_spec("run-1", "spec-1", {"topic": "t"})
    request = {
        "model": "m",
        "messages": [{"role": "user", "content": "hi"}],
        "api_key": "SECRET-KEY",
        "authorization": "Bearer SECRET-KEY",
    }
    with eval_trace.stage("chapter_plan"):
        eval_trace.capture_llm_response({"choices": [{"message": {"content": "{}"}}]}, request=request)
    request["messages"].append({"role": "user", "content": "后续追加"})
    request["response_format"] = {"type": "json_object"}
    eval_trace.end_spec()

    text = (spec_dir / "stage_chapter_plan_request.json").read_text(encoding="utf-8")
    assert "SECRET-KEY" not in text
    recorded = json.loads(text)
    assert recorded["messages"] == [{"role": "user", "content": "hi"}]
    assert "response_format" not in recorded


def test_write_failure_does_not_break_generation(tmp_path, monkeypatch):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x", encoding="utf-8")
    monkeypatch.setenv("EVAL_TRACE_DIR", str(blocker))
    # 目录被文件占位：所有写盘失败只记日志，不抛异常
    eval_trace.begin_spec("run-1", "spec-1", {"topic": "t"})
    with eval_trace.stage("architect_chapters"):
        eval_trace.capture_llm_response(
            {"choices": [{"message": {"content": "{}"}}]},
            request={"model": "m", "messages": []},
        )
        parse_enforced_json("{}")
    eval_trace.record_evidence({"sources": []}, stage="chapter_plan")
    eval_trace.write_course({"x": 1})
    eval_trace.write_run_meta("run-1", {"x": 1})
    eval_trace.end_spec()


# ---------------------------------------------------------------------------
# 流式捕获 / 证据 / course / run_meta
# ---------------------------------------------------------------------------

def test_stream_chat_capture_and_interrupt(tmp_path, monkeypatch):
    monkeypatch.setenv("EVAL_TRACE_DIR", str(tmp_path))
    lines = [
        'data: {"choices":[{"delta":{"content":"第一段"}}]}',
        'data: {"choices":[{"delta":{"content":"第二段"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}',
        "data: [DONE]",
    ]
    monkeypatch.setattr("lib.minimax.httpx.AsyncClient", _fake_stream_client(lines))
    spec_dir = eval_trace.begin_spec("run-1", "spec-1", {"topic": "t"})

    async def consume():
        with eval_trace.stage("task_content_t-1"):
            async for _chunk in _client().stream_chat([{"role": "user", "content": "hi"}], include_usage=True):
                pass

    asyncio.run(consume())
    assert (spec_dir / "stage_task_content_t-1_raw.txt").read_text(encoding="utf-8") == "第一段第二段"
    meta = _read(spec_dir / "stage_task_content_t-1_meta.json")
    assert meta["usage"]["total_tokens"] == 12
    assert meta["stream_completed"] is True
    assert meta["source"] == "minimax.stream_chat"

    async def consume_partial():
        with eval_trace.stage("task_content_t-2"):
            gen = _client().stream_chat([{"role": "user", "content": "hi"}])
            async for _chunk in gen:
                break  # 只取第一个 chunk 后中断
            await gen.aclose()

    asyncio.run(consume_partial())
    assert (spec_dir / "stage_task_content_t-2_raw.txt").read_text(encoding="utf-8") == "第一段"
    meta = _read(spec_dir / "stage_task_content_t-2_meta.json")
    assert meta["stream_completed"] is False
    eval_trace.end_spec()


def test_evidence_course_run_meta(tmp_path, monkeypatch):
    monkeypatch.setenv("EVAL_TRACE_DIR", str(tmp_path))
    spec_dir = eval_trace.begin_spec("run-1", "spec-1", {"topic": "t"})
    eval_trace.record_evidence({"sources": [{"evidenceId": "e1"}]}, stage="chapter_plan", chapter_id="ch-1")
    eval_trace.record_evidence({"sources": []}, stage="search_decision", chapter_id="ch-1", task_id="t-1")
    eval_trace.write_course({"architecture": {"courseTopic": "t"}, "chapters": []})
    eval_trace.write_run_meta("run-1", {"runId": "run-1", "specCount": 1})
    eval_trace.end_spec()

    snapshots = _read(spec_dir / "evidence_snapshot.json")
    assert len(snapshots) == 2
    assert snapshots[0]["stage"] == "chapter_plan"
    assert snapshots[0]["pack"]["sources"][0]["evidenceId"] == "e1"
    assert snapshots[1]["taskId"] == "t-1"
    assert _read(spec_dir / "course.json")["architecture"]["courseTopic"] == "t"
    assert _read(tmp_path / "run-1" / "run_meta.json")["specCount"] == 1


def test_record_stage_parsed_outside_stage(tmp_path, monkeypatch):
    monkeypatch.setenv("EVAL_TRACE_DIR", str(tmp_path))
    spec_dir = eval_trace.begin_spec("run-1", "spec-1", {"topic": "t"})
    with eval_trace.stage("task_content_t-1"):
        eval_trace.capture_llm_response(
            {"choices": [{"message": {"content": "正文"}}]},
            request={"model": "m", "messages": []},
        )
    # 服务层在阶段上下文之外组装最终 blocks
    eval_trace.record_stage_parsed(
        "task_content_t-1",
        {"blocks": [{"blockId": "b1", "type": "markdown"}], "boundaryPrompt": {"takeaway": "要点"}},
        parser="content_stream_parser",
    )
    parsed = _read(spec_dir / "stage_task_content_t-1_parsed.json")
    assert parsed["blocks"][0]["type"] == "markdown"
    meta = _read(spec_dir / "stage_task_content_t-1_meta.json")
    assert meta["parser"] == "content_stream_parser"
    eval_trace.end_spec()
