"""MiniMaxClient.chat 的 response_format 透传测试（B2 结构化输出基础设施）。

端点探测结论（2026-11-23，litellm 网关 + ark/deepseek-v4-1-flash）：
- response_format json_object / json_schema(strict) 真实支持且强制约束输出；
- reasoning_effort="none" 可关闭思考；reasoning_split 被端点忽略（客户端本地用于合成 reasoning_details）。
"""
import asyncio

from lib.minimax import MiniMaxClient


class _FakeResponse:
    status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return {"choices": [{"message": {"content": "{}"}}]}


def _capture_client(monkeypatch, captured: dict):
    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None, timeout=None):
            captured.update(json or {})
            return _FakeResponse()

    monkeypatch.setattr("lib.minimax.httpx.AsyncClient", FakeAsyncClient)
    return MiniMaxClient(api_key="test-key", base_url="http://test.local/v1")


def test_chat_passes_response_format(monkeypatch):
    captured: dict = {}
    client = _capture_client(monkeypatch, captured)
    asyncio.run(client.chat(
        messages=[{"role": "user", "content": "只输出 JSON"}],
        response_format={"type": "json_object"},
    ))
    assert captured["response_format"] == {"type": "json_object"}


def test_chat_omits_response_format_by_default(monkeypatch):
    captured: dict = {}
    client = _capture_client(monkeypatch, captured)
    asyncio.run(client.chat(messages=[{"role": "user", "content": "你好"}]))
    assert "response_format" not in captured
