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
    assert "站点偏好只是可选提示" in policy
    assert "不强制" in policy


def test_collector_does_not_force_site_filter_and_offers_optional_hint(tmp_path, monkeypatch):
    """B3：模型工具搜索不再强制 site: 改写；偏好域保留打分，站点只作可选提示。"""
    monkeypatch.setenv("EVIDENCE_STORE_DIR", str(tmp_path / "evidence"))
    collector = ChapterEvidenceCollector(
        "course-1",
        "ch-1",
        "React 进阶",
        "表单与状态",
        task_title="useActionState",
        task_goal="掌握 React 19 表单状态",
    )
    results = [{
        "title": "Community guide",
        "url": "https://example.com/react-guide",
        "body": "guide",
        "authorityScore": 60,
        "kind": "knowledge",
        "preferred": False,
    }]

    with patch.object(search_evidence, "search_web_structured", return_value=results) as search_mock:
        text = collector.web_search("React useActionState 教程")

    kwargs = search_mock.call_args.kwargs
    assert kwargs["site_filter"] is False
    assert "react.dev" in kwargs["preferred_domains"]
    assert "可选提示" in text
    assert "react.dev" in text
    assert "非强制" in text


def test_collector_skips_site_hint_when_preferred_source_present(tmp_path, monkeypatch):
    monkeypatch.setenv("EVIDENCE_STORE_DIR", str(tmp_path / "evidence"))
    collector = ChapterEvidenceCollector(
        "course-1",
        "ch-1",
        "React 进阶",
        "表单与状态",
        task_title="useActionState",
        task_goal="掌握 React 19 表单状态",
    )
    results = [{
        "title": "React official",
        "url": "https://react.dev/reference/react/useactionstate",
        "body": "official",
        "authorityScore": 95,
        "kind": "knowledge",
        "preferred": True,
        "isPrimary": True,
    }]

    with patch.object(search_evidence, "search_web_structured", return_value=results):
        text = collector.web_search("React useActionState 官方文档")

    assert "可选提示" not in text


def test_collector_keeps_preferred_domains_when_model_writes_site_query(tmp_path, monkeypatch):
    """模型自己写 site: 时不再清空偏好域：偏好域仍参与权威打分（查询本身不被改写）。"""
    monkeypatch.setenv("EVIDENCE_STORE_DIR", str(tmp_path / "evidence"))
    collector = ChapterEvidenceCollector(
        "course-1",
        "ch-1",
        "React 进阶",
        "表单与状态",
        task_title="useActionState",
        task_goal="掌握 React 19 表单状态",
    )
    results = [{
        "title": "React official",
        "url": "https://react.dev/reference/react/useactionstate",
        "body": "official",
        "authorityScore": 95,
        "kind": "knowledge",
        "preferred": True,
        "isPrimary": True,
    }]

    with patch.object(search_evidence, "search_web_structured", return_value=results) as search_mock:
        text = collector.web_search("site:react.dev useActionState")

    kwargs = search_mock.call_args.kwargs
    assert kwargs["site_filter"] is False
    assert "react.dev" in kwargs["preferred_domains"]
    assert "可选提示" not in text


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

    def fake_call(messages, tools, model, max_tokens, reasoning_split, max_retries=3, reasoning_effort=None):
        del reasoning_effort
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


def test_evidence_boundary_rules_forbid_invented_magnitudes():
    """I21：证据边界硬规则必须进 prompt——性能量级/机制限制不得自行估算。"""
    from tests.test_task_content import _request

    request = _request()
    prompt = build_task_content_prompt(
        request,
        evidence="- 某设计说明\n  来源: https://example.com/design",
        sources=[{"title": "设计说明", "url": "https://example.com/design"}],
    )
    assert "证据边界" in prompt
    assert "资料未给出" in prompt
    assert "不要用常识估算" in prompt
    # 分类口径与状态口径
    assert "不要自拟一套" in prompt
    assert "未默认开启" in prompt


def test_evidence_boundary_absent_without_evidence():
    """无证据时不注入证据边界段（避免无证据课程被无关规则干扰）。"""
    from tests.test_task_content import _request

    prompt = build_task_content_prompt(_request())
    assert "证据边界" not in prompt


def test_compare_recipe_allows_missing_dimension():
    """I21：对比表配额不得逼模型编数字——允许写「资料未给出」或少设维度。"""
    from prompts.task_content import get_recipe

    recipe = get_recipe("compare")
    assert "资料未给出" in recipe
    assert "不要为了填满表格估一个数字" in recipe


def test_evidence_to_prompt_prefers_excerpt_over_summary():
    """关键修复：有全文摘录时必须注入摘录，而不是 260 字摘要。

    此前 evidence_to_prompt 只读 summary，导致抓到全文也传不进 prompt——
    模型实际只看到网页样板文字，是 SuperAgent 课程事实错误的真正根因。
    """
    from services.evidence_store import evidence_to_prompt

    pack = {
        "sources": [
            {
                "title": "设计说明",
                "url": "https://example.com/design",
                "summary": "版权声明：本文内容由实名注册用户自发贡献……",
                "excerpt": "正文：把直通去掉，Router 决定多了约 30%，token 涨了约 37%。",
                "evidenceId": "ev-01-aaa",
                "kind": "official",
                "isPrimary": True,
            }
        ]
    }
    text, _ = evidence_to_prompt(pack)
    assert "30%" in text and "37%" in text
    assert "版权声明" not in text


def test_evidence_to_prompt_falls_back_to_summary():
    from services.evidence_store import evidence_to_prompt

    pack = {"sources": [{"title": "T", "url": "https://e.com", "summary": "摘要内容", "evidenceId": "ev-01-b"}]}
    text, _ = evidence_to_prompt(pack)
    assert "摘要内容" in text
