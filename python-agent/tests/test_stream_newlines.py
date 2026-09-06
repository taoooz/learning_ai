"""回归：流式 thinking / content_delta 必须保留换行符

rstrip('\n') 曾把每个 chunk 尾部的换行吞掉，导致前端思考过程
段落全部连成一行。换行属于内容的一部分，不允许在流出口剥离。
"""
import json

from lib import minimax_agent


def _sse(delta: dict) -> str:
    return "data: " + json.dumps(
        {"choices": [{"delta": delta, "finish_reason": None}]}, ensure_ascii=False
    )


SSE_LINES = [
    _sse({"reasoning_content": "第一段思考\n"}),
    _sse({"reasoning_content": "\n第二段：\n- 要点一\n- 要点二\n"}),
    _sse({"content": "第一行\n第二行\n"}),
    _sse({"content": "第三行\n"}),
    "data: [DONE]",
]


class _FakeResponse:
    status_code = 200

    def __init__(self, lines):
        self._lines = lines

    def iter_lines(self):
        yield from self._lines

    def raise_for_status(self):
        pass


class _FakeStreamContext:
    def __init__(self, lines):
        self._lines = lines

    def __enter__(self):
        return _FakeResponse(self._lines)

    def __exit__(self, *args):
        return False


class _FakeHttpClient:
    def __init__(self, lines):
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def stream(self, *args, **kwargs):
        return _FakeStreamContext(self._lines)


def test_streaming_preserves_newlines(monkeypatch):
    monkeypatch.setattr(
        minimax_agent.httpx, "Client", lambda **kw: _FakeHttpClient(SSE_LINES)
    )
    client = minimax_agent.AgentClient(api_key="test")
    payload = {"model": "test", "messages": [{"role": "user", "content": "hi"}]}

    thinking = []
    content = []
    for ev in minimax_agent._do_streaming_call(client, payload, max_retries=1):
        if ev["type"] == "thinking":
            thinking.append(ev["message"])
        elif ev["type"] == "content_delta":
            content.append(ev["content"])

    # thinking：chunk 尾部换行必须保留（段落分隔依赖它）
    assert "".join(thinking) == "第一段思考\n\n第二段：\n- 要点一\n- 要点二\n"
    # content_delta：换行同样是正文结构的一部分
    assert "".join(content) == "第一行\n第二行\n第三行\n"
