"""Memory 渐进式披露回归：空态省略（R3）+ 辅导对话按需检索（R5）。"""

from services.chat_agent import build_chat_system_prompt
from services.memory_context_v4 import to_chat_prompt_payload


def test_chat_payload_omits_empty_topic_summary():
    """没有过往学习概要时不注入「暂无」占位串——缺失即未知，避免诱发编造。"""
    payload = to_chat_prompt_payload({
        "core": {"activePreferences": []},
        "learningState": {"conceptStates": [], "topicStates": []},
        "index": [],
    })
    assert "暂无" not in str(payload)
    assert "topicSummary" not in payload


def test_chat_payload_keeps_present_summary():
    payload = to_chat_prompt_payload({
        "core": {"activePreferences": []},
        "learningState": {"conceptStates": [], "topicStates": []},
        "index": [{"kind": "episode", "summary": "上次学到召回与粗排的分工"}],
    })
    assert payload["topicSummary"] == "上次学到召回与粗排的分工"


def test_chat_prompt_without_memory_search_has_no_policy():
    text = build_chat_system_prompt(course_topic="推荐算法")
    assert "memory_search" not in text


def test_chat_prompt_with_memory_search_declares_triggers_and_anti_triggers():
    text = build_chat_system_prompt(course_topic="推荐算法", memory_search_enabled=True)
    assert "memory_search" in text
    assert "我之前学过吗" in text
    assert "不要检索" in text


def test_chat_stream_mounts_memory_search_only_with_account(monkeypatch):
    import services.chat_agent as chat_module

    seen = []

    class FakeClient:
        def stream_chat_with_tools(self, **kwargs):
            seen.append(kwargs)
            yield {"type": "content", "content": "ok"}

    monkeypatch.setattr(chat_module, "AgentClient", FakeClient)

    list(chat_module.stream_chat_with_tools(messages=[{"role": "user", "content": "hi"}]))
    names = [t["function"]["name"] for t in seen[0]["tools"]]
    assert "memory_search" not in names

    list(chat_module.stream_chat_with_tools(
        messages=[{"role": "user", "content": "hi"}], memory_account_id="account-a",
    ))
    names = [t["function"]["name"] for t in seen[1]["tools"]]
    assert "memory_search" in names
    assert "memory_search" in seen[1]["tool_functions"]