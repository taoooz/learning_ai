# tests/test_search_evidence.py — 模型驱动搜索工具、EvidencePack 合并与提示词注入

from unittest.mock import patch

import services.search_evidence as search_evidence
from lib.minimax_agent import AgentClient
from lib.tools.search_tools import SEARCH_TOOLS
from services.evidence_store import get_chapter_evidence
from services.search_evidence import ChapterEvidenceCollector, format_search_decision_policy
from services.task_content_service import build_task_content_prompt


def test_collector_executes_model_search_and_persists_evidence(tmp_path, monkeypatch):
    monkeypatch.setenv("EVIDENCE_STORE_DIR", str(tmp_path / "evidence"))
    results = [
        {
            "title": "React official",
            "url": "https://react.dev/reference/react/useactionstate",
            "body": "official",
            "authorityScore": 100,
            "preferred": True,
            "isPrimary": True,
        },
        {
            "title": "Hacker news",
            "url": "https://news.ycombinator.com/item?id=1",
            "body": "community",
            "authorityScore": 55,
            "kind": "wisdom",
        },
    ]
    collector = ChapterEvidenceCollector(
        "course-1",
        "ch-1",
        "React 进阶",
        "表单与状态",
        task_title="useActionState",
        task_goal="掌握 React 19 表单状态",
    )

    with patch.object(search_evidence, "search_web_structured", return_value=results):
        text = collector.web_search("React useActionState 官方文档")

    assert "证据ID" in text
    pack = get_chapter_evidence("course-1", "ch-1")
    assert pack is not None
    assert pack["sources"][0]["isPrimary"] is True
    assert pack["sources"][0]["useFor"].startswith("官方或高权威")
    assert pack["sources"][1]["kind"] == "wisdom"
    assert pack["sources"][1]["useFor"].startswith("社区或经验型")
    assert pack["queryPlan"][0]["query"] == "React useActionState 官方文档"


def test_collector_returns_search_error_to_model(tmp_path, monkeypatch):
    monkeypatch.setenv("EVIDENCE_STORE_DIR", str(tmp_path / "evidence"))
    collector = ChapterEvidenceCollector("course-1", "ch-1", "任意主题", "任意章节")

    with patch.object(search_evidence, "search_web_structured", side_effect=RuntimeError("网络错误")):
        text = collector.web_search("任意查询")

    assert text.startswith("搜索出错")
    assert get_chapter_evidence("course-1", "ch-1") is None


def test_collector_respects_search_kill_switch(tmp_path, monkeypatch):
    monkeypatch.setenv("EVIDENCE_STORE_DIR", str(tmp_path / "evidence"))
    monkeypatch.setenv("DISABLE_WEB_SEARCH", "1")
    collector = ChapterEvidenceCollector("course-1", "ch-1", "任意主题", "任意章节")

    text = collector.web_search("任意查询")

    assert text.startswith("联网搜索已禁用")
    assert get_chapter_evidence("course-1", "ch-1") is None


def test_search_decision_policy_requires_model_judgment():
    policy = format_search_decision_policy(max_searches=2)
    assert "由你判断" in policy
    assert "最多执行 2 次 web_search" in policy
    assert "禁止编造 URL" in policy


def test_prepare_search_context_executes_tool_and_keeps_result_for_final_generation(monkeypatch):
    client = AgentClient(api_key="test-key", base_url="http://llm.local/v1")
    messages = [{"role": "system", "content": "test"}, {"role": "user", "content": "decide"}]
    responses = [
        {"choices": [{"message": {"content": "", "tool_calls": [{
            "id": "call-search",
            "type": "function",
            "function": {"name": "web_search", "arguments": '{"query":"React 19"}'},
        }]}}]},
        {"choices": [{"message": {"content": "SEARCH_COMPLETE"}}]},
    ]
    observed_tools = []
    tool_calls = []

    def fake_call(messages, tools, model, max_tokens, reasoning_split, max_retries=3):
        observed_tools.append(tools)
        if observed_tools[-1] and messages[-1]["role"] == "user":
            return responses[0]
        assert messages[-1]["role"] == "tool"
        return responses[1]

    def fake_web_search(query: str):
        tool_calls.append(query)
        return "证据ID: ev-01 | React 19 文档"

    monkeypatch.setattr(client, "_call_llm", fake_call)
    client.prepare_search_context(
        messages=messages,
        tools=SEARCH_TOOLS,
        tool_functions={"web_search": fake_web_search},
        max_iterations=2,
        max_searches=2,
    )

    assert tool_calls == ["React 19"]
    assert messages[-1] == {
        "role": "tool",
        "tool_call_id": "call-search",
        "content": "证据ID: ev-01 | React 19 文档",
    }
    assert observed_tools[0] == SEARCH_TOOLS


def test_task_prompt_injects_existing_evidence_and_search_policy():
    from tests.test_task_content import _request

    request = _request()
    prompt_with = build_task_content_prompt(
        request,
        evidence="- Next.js 15 发布说明\n  来源: https://example.com/next15",
        sources=[{"title": "Next.js 15", "url": "https://example.com/next15"}],
        allow_search=True,
    )
    prompt_without = build_task_content_prompt(request)

    assert "搜索证据包" in prompt_with
    assert "https://example.com/next15" in prompt_with
    assert "联网搜索决策" in prompt_with
    assert "搜索证据包" not in prompt_without
    assert "联网搜索决策" not in prompt_without
