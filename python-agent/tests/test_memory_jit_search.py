"""R6：memory_search 渐进式披露——默认只给摘要，正文按需二次取用。"""

import json

import lib.tools.memory_tools as memory_tools
from lib.tools.memory_tools import MEMORY_SEARCH_POLICY, MEMORY_SEARCH_TOOL, create_memory_search


def _fake_store(monkeypatch, content="负责过推荐位与重排规则设计" * 40):
    class FakeStore:
        def load_store(self, _account_id):
            return {
                "records": [{
                    "memoryId": "mem-secret-1",
                    "status": "active",
                    "kind": "fact",
                    "title": "推荐系统工作经验",
                    "summary": "参与过召回和重排",
                    "content": content,
                    "conceptKeys": ["召回", "重排"],
                    "tags": ["work"],
                    "importance": 0.8,
                }],
            }

    monkeypatch.setattr(memory_tools, "MemoryV4Store", lambda: FakeStore())


def test_default_returns_summary_without_body(monkeypatch):
    _fake_store(monkeypatch)
    rows = json.loads(create_memory_search("account-1")("推荐 重排"))
    assert rows[0]["summary"] == "参与过召回和重排"
    assert "content" not in rows[0]
    assert "mem-secret-1" not in json.dumps(rows, ensure_ascii=False)


def test_full_detail_returns_body(monkeypatch):
    _fake_store(monkeypatch)
    rows = json.loads(create_memory_search("account-1")("推荐 重排", detail="full"))
    assert "负责过推荐位与重排规则设计" in rows[0]["content"]
    assert len(rows[0]["content"]) <= 800
    assert "mem-secret-1" not in json.dumps(rows, ensure_ascii=False)


def test_summary_mode_is_substantially_cheaper(monkeypatch):
    _fake_store(monkeypatch)
    search = create_memory_search("account-1")
    summary = search("推荐 重排")
    full = search("推荐 重排", detail="full")
    assert len(summary) * 3 < len(full)


def test_unknown_detail_falls_back_to_summary(monkeypatch):
    _fake_store(monkeypatch)
    rows = json.loads(create_memory_search("account-1")("推荐 重排", detail="weird"))
    assert "content" not in rows[0]


def test_tool_schema_declares_detail_levels():
    params = MEMORY_SEARCH_TOOL["function"]["parameters"]["properties"]
    assert params["detail"]["enum"] == ["summary", "full"]
    assert "渐进式披露" in MEMORY_SEARCH_POLICY
    assert 'detail="full"' in MEMORY_SEARCH_POLICY