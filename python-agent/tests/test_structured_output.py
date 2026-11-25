"""response_format json_schema(strict) 迁移回归测试。

覆盖：schema 合法性、response_format 透传、网关拒绝时的逐级降级、
约束解析 parse_enforced_json 的行为（引号修复启发式退役后的边界）。
实测背景见 scripts/probe_strict_schema.py（2026-11-23 七用例全部通过）。
"""
import asyncio
import copy
import json
import logging

import httpx
import pytest

from lib.minimax import MiniMaxClient, parse_enforced_json
from lib.minimax_agent import AgentClient, _do_streaming_call
from lib.structured_output import (
    apply_response_format_downgrade,
    downgrade_response_format,
    is_response_format_rejection,
    json_schema_format,
    plan_response_format,
    strict_schema_enabled,
    validate_strict_schema,
)
from schemas.course_architecture import (
    COURSE_CHAPTERS_JSON_SCHEMA,
    COURSE_META_JSON_SCHEMA,
    ArchitectureChapter,
    CourseArchitectureMeta,
    CourseChapterPlan,
)
from services.chapter_plan_service import CHAPTER_PLAN_JSON_SCHEMA, TEACHING_PATTERNS


# ---- schema 合法性 ----

def test_all_migration_schemas_are_strict_compliant():
    for schema in (CHAPTER_PLAN_JSON_SCHEMA, COURSE_CHAPTERS_JSON_SCHEMA, COURSE_META_JSON_SCHEMA):
        assert validate_strict_schema(schema) == []


def test_validate_strict_schema_catches_violations():
    missing_required = {
        "type": "object",
        "properties": {"x": {"type": "string"}},
        "required": [],
        "additionalProperties": False,
    }
    assert any("required 未覆盖" in p for p in validate_strict_schema(missing_required))
    open_object = {
        "type": "object",
        "properties": {"x": {"type": "string"}},
        "required": ["x"],
    }
    assert any("additionalProperties" in p for p in validate_strict_schema(open_object))
    with_default = {
        "type": "object",
        "properties": {"x": {"type": "string", "default": "y"}},
        "required": ["x"],
        "additionalProperties": False,
    }
    assert any("default" in p for p in validate_strict_schema(with_default))


def test_chapter_plan_schema_matches_consumed_fields():
    item = CHAPTER_PLAN_JSON_SCHEMA["properties"]["tasks"]["items"]
    assert set(item["properties"]) == {
        "taskId", "order", "title", "objectiveId", "taskGoal", "observableOutcome",
        "conceptKeys", "prerequisiteTaskIds", "teachingPattern", "expectedMinutes",
    }
    assert item["properties"]["teachingPattern"]["enum"] == list(TEACHING_PATTERNS)
    # evidencePolicy/origin/status 由服务端写入，不得进 schema
    assert not {"evidencePolicy", "origin", "status"} & set(item["properties"])


def test_architect_schemas_match_pydantic_models():
    chapters_item = COURSE_CHAPTERS_JSON_SCHEMA["properties"]["chapters"]["items"]
    assert set(chapters_item["properties"]) == set(ArchitectureChapter.model_fields)
    assert set(COURSE_CHAPTERS_JSON_SCHEMA["properties"]) == set(CourseChapterPlan.model_fields)
    assert set(COURSE_META_JSON_SCHEMA["properties"]) == set(CourseArchitectureMeta.model_fields)
    concept_item = COURSE_META_JSON_SCHEMA["properties"]["conceptGraph"]["items"]
    from schemas.course_architecture import ArchitectureConcept
    assert set(concept_item["properties"]) == set(ArchitectureConcept.model_fields)
    # 可空字段用 type 联合而非 anyOf/oneOf
    assert concept_item["properties"]["evidenceIds"]["type"] == ["array", "null"]


# ---- response_format 构造与开关 ----

def test_json_schema_format_shape():
    fmt = json_schema_format("demo", {"type": "object"})
    assert fmt == {
        "type": "json_schema",
        "json_schema": {"name": "demo", "strict": True, "schema": {"type": "object"}},
    }


def test_plan_response_format_env_switch(monkeypatch):
    monkeypatch.setenv("LLM_STRICT_JSON_SCHEMA", "1")
    assert strict_schema_enabled() is True
    fmt = plan_response_format("chapter_plan", CHAPTER_PLAN_JSON_SCHEMA)
    assert fmt["type"] == "json_schema"
    assert fmt["json_schema"]["strict"] is True

    monkeypatch.setenv("LLM_STRICT_JSON_SCHEMA", "0")
    assert strict_schema_enabled() is False
    assert plan_response_format("chapter_plan", CHAPTER_PLAN_JSON_SCHEMA) == {"type": "json_object"}


def test_downgrade_chain():
    schema_fmt = json_schema_format("demo", {})
    assert downgrade_response_format(schema_fmt) == {"type": "json_object"}
    assert downgrade_response_format({"type": "json_object"}) is None
    assert downgrade_response_format(None) is None


def test_rejection_status_codes():
    for status in (400, 404, 415, 422):
        assert is_response_format_rejection(status)
    for status in (200, 429, 500, 502, 503, 529):
        assert not is_response_format_rejection(status)


def test_apply_downgrade_mutates_payload_and_logs(caplog):
    payload = {"response_format": json_schema_format("demo", {})}
    with caplog.at_level(logging.WARNING, logger="lib.structured_output"):
        assert apply_response_format_downgrade(payload, "test", 400) is True
    assert payload["response_format"] == {"type": "json_object"}
    assert "降级" in caplog.text
    assert apply_response_format_downgrade(payload, "test", 400) is True
    assert "response_format" not in payload
    # 无约束可降 / 非拒绝状态码 → 不动作
    assert apply_response_format_downgrade(payload, "test", 400) is False
    payload2 = {"response_format": {"type": "json_object"}}
    assert apply_response_format_downgrade(payload2, "test", 500) is False
    assert payload2["response_format"] == {"type": "json_object"}


# ---- parse_enforced_json：最小安全网与退役边界 ----

def test_parse_enforced_json_clean():
    assert parse_enforced_json('{"tasks": []}') == {"tasks": []}


def test_parse_enforced_json_strips_markdown_fence():
    assert parse_enforced_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_enforced_json('```\n{"a": 1}\n```') == {"a": 1}


def test_parse_enforced_json_extracts_object_from_prose():
    # 降级模式（json_object/无约束）下前后可能混入说明文字
    assert parse_enforced_json('好的，这是结果：{"a": 1} 希望有帮助') == {"a": 1}


def test_parse_enforced_json_no_longer_repairs_unescaped_quotes():
    # 引号修复启发式已退役：字符串内未转义英文双引号现在直接报错，
    # 由上层 INVALID_JSON 重试兜底，而不是静默改写模型输出
    bad = '{"title": "说"你好"的任务"}'
    with pytest.raises(ValueError):
        parse_enforced_json(bad)


def test_parse_enforced_json_detects_truncation():
    with pytest.raises(ValueError, match="truncated"):
        parse_enforced_json('{"tasks": [{"taskId": "t1"')


def test_parse_enforced_json_no_json():
    with pytest.raises(ValueError, match="No JSON found"):
        parse_enforced_json("抱歉，我无法生成。")


def test_parse_enforced_json_does_not_clean_xml_or_thinking():
    # XML 工具调用清理 / Thinking 标记清理不再作用于本路径：
    # 混入这些内容时按非法 JSON 报错（约束输出不应包含它们）
    with pytest.raises(ValueError):
        parse_enforced_json('Thinking\n秘密思考\nThinking\n不是 JSON')


# ---- MiniMaxClient.chat 降级 ----

class _FakeAsyncResponse:
    def __init__(self, status_code=200):
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "rejected",
                request=httpx.Request("POST", "http://test.local/v1/chat/completions"),
                response=self,
            )

    def json(self):
        return {"choices": [{"message": {"content": "{}"}}]}


def _fake_async_client(monkeypatch, statuses: list[int], bodies: list[dict]):
    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None, timeout=None):
            bodies.append(copy.deepcopy(json))
            return _FakeAsyncResponse(statuses.pop(0))

    monkeypatch.setattr("lib.minimax.httpx.AsyncClient", FakeAsyncClient)
    return MiniMaxClient(api_key="test-key", base_url="http://test.local/v1")


def test_chat_downgrades_json_schema_to_json_object(monkeypatch, caplog):
    bodies: list[dict] = []
    statuses = [400, 200]
    client = _fake_async_client(monkeypatch, statuses, bodies)
    fmt = json_schema_format("chapter_plan", CHAPTER_PLAN_JSON_SCHEMA)
    with caplog.at_level(logging.WARNING, logger="lib.structured_output"):
        asyncio.run(client.chat(messages=[{"role": "user", "content": "hi"}], response_format=fmt))
    assert len(bodies) == 2
    assert bodies[0]["response_format"] == fmt
    assert bodies[1]["response_format"] == {"type": "json_object"}
    assert "降级" in caplog.text


def test_chat_downgrades_twice_to_unconstrained(monkeypatch):
    bodies: list[dict] = []
    client = _fake_async_client(monkeypatch, [400, 422, 200], bodies)
    asyncio.run(client.chat(
        messages=[{"role": "user", "content": "hi"}],
        response_format=json_schema_format("demo", {}),
    ))
    assert len(bodies) == 3
    assert bodies[1]["response_format"] == {"type": "json_object"}
    assert "response_format" not in bodies[2]


def test_chat_without_response_format_raises_on_400(monkeypatch):
    bodies: list[dict] = []
    client = _fake_async_client(monkeypatch, [400], bodies)
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(client.chat(messages=[{"role": "user", "content": "hi"}]))
    assert len(bodies) == 1


# ---- AgentClient._call_llm 透传与降级 ----

class _FakeSyncResponse:
    def __init__(self, status_code=200):
        self.status_code = status_code
        self.text = "{}"

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "rejected",
                request=httpx.Request("POST", "http://test.local/v1/chat/completions"),
                response=self,
            )

    def json(self):
        return {"choices": [{"message": {"content": "{}"}}]}


def _fake_sync_client(monkeypatch, statuses: list[int], bodies: list[dict]):
    class FakeSyncClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None, timeout=None):
            bodies.append(copy.deepcopy(json))
            return _FakeSyncResponse(statuses.pop(0))

    monkeypatch.setattr("lib.minimax_agent.httpx.Client", FakeSyncClient)
    return AgentClient(api_key="test-key", base_url="http://test.local/v1")


def test_call_llm_passes_response_format(monkeypatch):
    bodies: list[dict] = []
    client = _fake_sync_client(monkeypatch, [200], bodies)
    fmt = json_schema_format("chapter_plan", CHAPTER_PLAN_JSON_SCHEMA)
    client._call_llm([{"role": "user", "content": "hi"}], None, "m", 100, True, response_format=fmt)
    assert bodies[0]["response_format"] == fmt


def test_call_llm_downgrades_without_consuming_retries(monkeypatch):
    bodies: list[dict] = []
    client = _fake_sync_client(monkeypatch, [400, 400, 200], bodies)
    # max_retries=1：降级不消耗配额，两次降级后仍能成功
    client._call_llm(
        [{"role": "user", "content": "hi"}], None, "m", 100, True,
        max_retries=1, response_format=json_schema_format("demo", {}),
    )
    assert len(bodies) == 3
    assert bodies[0]["response_format"]["type"] == "json_schema"
    assert bodies[1]["response_format"] == {"type": "json_object"}
    assert "response_format" not in bodies[2]


def test_chat_with_tools_forwards_response_format_every_round():
    client = AgentClient(api_key="test-key", base_url="http://test.local/v1")
    seen: list[dict | None] = []
    fmt = json_schema_format("chapter_plan", CHAPTER_PLAN_JSON_SCHEMA)

    def fake_call_llm(messages, tools, model, max_tokens, reasoning_split,
                      max_retries=3, reasoning_effort=None, response_format=None):
        seen.append(response_format)
        if len(seen) == 1:
            return {"choices": [{"message": {"content": "", "tool_calls": [{
                "id": "call_1", "type": "function",
                "function": {"name": "web_search", "arguments": '{"query": "x"}'},
            }]}}]}
        return {"choices": [{"message": {"content": "{}"}}]}

    client._call_llm = fake_call_llm
    messages = [{"role": "user", "content": "hi"}]
    client.chat_with_tools(
        messages, [{"type": "function", "function": {"name": "web_search"}}],
        {"web_search": lambda query: "结果"},
        max_iterations=2, max_searches=1, response_format=fmt,
    )
    assert seen == [fmt, fmt]  # 工具轮与最终轮都携带约束


def test_stream_chat_with_tools_forwards_response_format(monkeypatch):
    client = AgentClient(api_key="test-key", base_url="http://test.local/v1")
    captured: list[dict] = []
    fmt = json_schema_format("course_chapters", COURSE_CHAPTERS_JSON_SCHEMA)

    def fake_stream(agent, payload, max_retries=3):
        captured.append(payload)
        yield {"type": "response", "response": {
            "choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]
        }}

    monkeypatch.setattr("lib.minimax_agent._do_streaming_call", fake_stream)
    events = list(client.stream_chat_with_tools(
        [{"role": "user", "content": "hi"}], [], {},
        max_iterations=1, response_format=fmt,
    ))
    assert captured[0]["response_format"] == fmt
    assert events[-1]["type"] == "done"


# ---- _do_streaming_call 流式降级 ----

class _FakeStreamResponse:
    def __init__(self, status_code: int, lines: list[str]):
        self.status_code = status_code
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def iter_lines(self):
        return iter(self._lines)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "rejected",
                request=httpx.Request("POST", "http://test.local/v1/chat/completions"),
                response=self,
            )


def _sse_ok_lines() -> list[str]:
    chunk = {"choices": [{"delta": {"content": '{"a": 1}'}, "finish_reason": "stop"}]}
    return [f"data: {json.dumps(chunk)}", "data: [DONE]"]


def test_do_streaming_call_downgrades_on_rejection(monkeypatch, caplog):
    bodies: list[dict] = []
    scripted = [
        _FakeStreamResponse(400, ['{"error": "unsupported response_format"}']),
        _FakeStreamResponse(200, _sse_ok_lines()),
    ]

    class FakeStreamClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def stream(self, method, url, headers=None, json=None, timeout=None):
            bodies.append(copy.deepcopy(json))
            return scripted.pop(0)

    monkeypatch.setattr("lib.minimax_agent.httpx.Client", FakeStreamClient)
    client = AgentClient(api_key="test-key", base_url="http://test.local/v1")
    payload = {
        "model": "m", "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 100, "stream": True, "reasoning_split": True,
        "response_format": json_schema_format("course_chapters", COURSE_CHAPTERS_JSON_SCHEMA),
    }
    with caplog.at_level(logging.WARNING, logger="lib.structured_output"):
        events = list(_do_streaming_call(client, payload))
    assert len(bodies) == 2
    assert bodies[0]["response_format"]["type"] == "json_schema"
    assert bodies[1]["response_format"] == {"type": "json_object"}
    assert events[-1]["type"] == "response"
    assert "降级" in caplog.text


# ---- I1：数字后杂散引号确定性修复（预注册 rsi/prereg-I1.md） ----

# 真实捕获：pilot-1 gs-http-caching-a ch-2 chapter_plan 首次尝试（"order":2" 等）
_I1_CAPTURED_RAW = "{\"tasks\":[{\"taskId\":\"t1\",\"order\":1,\"title\":\"算准一次响应的新鲜期\",\"objectiveId\":\"obj-2\",\"taskGoal\":\"用 Date、Age、max-age（及无显式头时的启发式估值）推导某时刻响应的剩余新鲜度\",\"observableOutcome\":\"给定一组带 Date/Age/Cache-Control 的响应头和时间戳，能算出剩余新鲜期并判定此刻处于 fresh 还是 stale\",\"conceptKeys\":[\"freshness_lifetime\",\"current_age\",\"max-age\",\"剩余新鲜期\",\"启发式新鲜度\"],\"prerequisiteTaskIds\":[],\"teachingPattern\":\"derive\",\"expectedMinutes\":5},{\"taskId\":\"t2\",\"order\":2\",\"title\":\"写出条件请求握手流程\",\"objectiveId\":\"obj-2\",\"taskGoal\":\"把 stale 命中到 304/200 的完整条件请求往返写成可执行的步骤序列\",\"observableOutcome\":\"能写出带 If-None-Match（及 If-Modified-Since）的请求流程，并说明 304 响应中哪些头部会被更新、缓存条目如何被重新标记为 fresh\",\"conceptKeys\":[\"conditional_request\",\"If-None-Match\",\"If-Modified-Since\",\"304_Not_Modified\",\"头部合并更新\"],\"prerequisiteTaskIds\":[\"t1\"],\"teachingPattern\":\"process\",\"expectedMinutes\":5},{\"taskId\":\"t3\",\"order\":3,\"title\":\"强/弱 ETag 与 Last-Modified 取舍\",\"objectiveId\":\"obj-2\",\"taskGoal\":\"依据资源变更粒度与语义等价要求，判断该用强 ETag、弱 ETag 还是 Last-Modified\",\"observableOutcome\":\"针对字节级重要、语义等价、仅按秒级修改时间三类资源分别给出验证器选择，并说明选错的后果（误判 304 或校验失效）\",\"conceptKeys\":[\"strong_etag\",\"weak_etag\",\"Last-Modified\",\"验证器等价语义\"],\"prerequisiteTaskIds\":[\"t2\"],\"teachingPattern\":\"compare\",\"expectedMinutes\":4},{\"taskId\":\"t4\",\"order\":4,\"title\":\"拆解三种结局的成本结构\",\"objectiveId\":\"obj-2\",\"taskGoal\":\"把命中、304 校验、完全回源三种结局拆成带宽与延迟两项成本\",\"observableOutcome\":\"能用响应体大小、RTT、校验开销为一次请求算出三种结局各自的字节成本与延迟成本，并指出哪类收益来自省带宽、哪类来自省延迟\",\"conceptKeys\":[\"带宽成本\",\"延迟成本\",\"304_开销\",\"回源成本\",\"收益归因\"],\"prerequisiteTaskIds\":[\"t3\"],\"teachingPattern\":\"worked_example\",\"expectedMinutes\":5},{\"taskId\":\"t5\",\"order\":5,\"title\":\"为一组资源配置新鲜度与校验\",\"objectiveId\":\"obj-2\",\"taskGoal\":\"对一份混合资源清单给定 max-age 与验证器，并用成本估算论证选择\",\"observableOutcome\":\"产出清单中每类资源的 max-age 取值、验证器类型与条件请求路径，并给出命中/304/回源比例下的带宽与延迟对比结论\",\"conceptKeys\":[\"max-age_设定\",\"验证器选型\",\"成本对比结论\",\"新鲜度策略\"],\"prerequisiteTaskIds\":[\"t4\"],\"teachingPattern\":\"practice\",\"expectedMinutes\":6}]}"


def test_i1_repairs_stray_quote_after_number():
    from lib.minimax import parse_enforced_json
    bad = '{"tasks":[{"taskId":"t2","order":2","title":"x"}]}'
    out = parse_enforced_json(bad)
    assert out["tasks"][0]["order"] == 2


def test_i1_captured_raw_regression():
    from lib.minimax import parse_enforced_json
    out = parse_enforced_json(_I1_CAPTURED_RAW)
    assert [t["order"] for t in out["tasks"]] == [1, 2, 3, 4, 5]
    assert all(t["title"] for t in out["tasks"])


def test_i1_identity_on_valid_json():
    import json as _json
    from lib.minimax import _strip_stray_quote_after_number, parse_enforced_json
    valid = '{"title":"版本:2","order":2,"nested":{"x":-3,"y":1.5},"s":"a:1\\""}'
    assert _strip_stray_quote_after_number(valid) == valid
    assert parse_enforced_json(valid) == _json.loads(valid)


def test_i1_string_content_untouched():
    from lib.minimax import parse_enforced_json
    bad = '{"title":"版本:2","order":2"}'
    out = parse_enforced_json(bad)
    assert out["title"] == "版本:2" and out["order"] == 2


def test_i1_truncated_still_raises():
    import pytest as _pt
    from lib.minimax import parse_enforced_json
    with _pt.raises(ValueError, match="truncated"):
        parse_enforced_json('{"tasks":[{"order":2"')


def test_i1_other_invalid_still_raises():
    import pytest as _pt
    from lib.minimax import parse_enforced_json
    with _pt.raises(ValueError, match="Invalid JSON"):
        parse_enforced_json('{"a":1,,}')
