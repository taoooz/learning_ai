# tests/test_search_tools_site_filter.py — B3：site: 偏好从硬规则降级为可选模式
# site_filter=True 保留确定性预搜路径的 site: 前置查询；
# site_filter=False（模型工具路径）不改写查询，偏好域只参与权威打分与排序。

from unittest.mock import patch

import lib.tools.search_tools as search_tools


def _item(url: str, title: str = "T", body: str = "b") -> dict:
    return {"title": title, "url": url, "body": body, "backend": "google"}


def test_site_filter_false_does_not_rewrite_query(monkeypatch):
    monkeypatch.setattr(search_tools, "_SEARCH_CACHE", {})
    calls = []

    def fake_ddg(query, max_results, backend):
        calls.append(query)
        return [_item("https://example.com/a")]

    with patch.object(search_tools, "_ddg_search", side_effect=fake_ddg):
        search_tools.search_web_structured(
            "react hooks", preferred_domains=["react.dev"], site_filter=False
        )

    assert calls
    assert all("site:" not in query for query in calls)


def test_site_filter_true_keeps_legacy_site_prefix(monkeypatch):
    monkeypatch.setattr(search_tools, "_SEARCH_CACHE", {})
    calls = []

    def fake_ddg(query, max_results, backend):
        calls.append(query)
        return [_item("https://example.com/a")]

    with patch.object(search_tools, "_ddg_search", side_effect=fake_ddg):
        search_tools.search_web_structured("react hooks", preferred_domains=["react.dev"])

    assert calls[0] == "site:react.dev react hooks"


def test_site_filter_modes_use_separate_cache_entries(monkeypatch):
    monkeypatch.setattr(search_tools, "_SEARCH_CACHE", {})
    calls = []

    def fake_ddg(query, max_results, backend):
        calls.append(query)
        return [_item("https://example.com/a")]

    with patch.object(search_tools, "_ddg_search", side_effect=fake_ddg):
        search_tools.search_web_structured(
            "react hooks", preferred_domains=["react.dev"], site_filter=False
        )
        first_round = len(calls)
        search_tools.search_web_structured(
            "react hooks", preferred_domains=["react.dev"], site_filter=True
        )

    # 两种模式缓存键不同：第二次调用必须真实发起搜索，而不是命中旧缓存。
    assert len(calls) > first_round
    assert any(query.startswith("site:react.dev") for query in calls[first_round:])


def test_site_filter_false_keeps_preferred_ranking_and_authority(monkeypatch):
    monkeypatch.setattr(search_tools, "_SEARCH_CACHE", {})
    items = [
        _item("https://example.com/react-guide", title="Community"),
        _item("https://react.dev/reference/react", title="Official"),
    ]

    with patch.object(search_tools, "_ddg_search", return_value=items):
        results = search_tools.search_web_structured(
            "react reference",
            max_results=2,
            preferred_domains=["react.dev"],
            site_filter=False,
        )

    assert results[0]["url"] == "https://react.dev/reference/react"
    assert results[0]["preferred"] is True
    assert results[0]["authorityScore"] >= 95
    assert results[0]["isPrimary"] is True
