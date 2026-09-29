"""免预算搜索来源策略：权威域推断、来源排序和 URL 去重。"""

from lib.tools.search_tools import search_web_structured
from lib.tools.source_registry import infer_preferred_domains, source_authority


def test_infer_preferred_domains_react():
    domains = infer_preferred_domains("React 进阶实战", "useActionState 的执行时机", "理解副作用的触发和清理")
    assert domains == ["react.dev"]


def test_infer_preferred_domains_frontend_defaults_to_mdn():
    domains = infer_preferred_domains("Web 前端性能优化", "HTTP 缓存的工作原理", "理解浏览器缓存决策流程")
    assert "developer.mozilla.org" in domains


def test_source_authority_prefers_registered_official_docs():
    assert source_authority("https://react.dev/reference/react/useActionState", ["react.dev"]) == 100
    assert source_authority("https://developer.mozilla.org/docs/Web/HTTP/Caching") == 95
    assert source_authority("https://unknown-blog.example.com/post") == 60


def test_search_web_structured_sorts_and_dedupes():
    def fake_search(query, max_results, backend):
        if "site:react.dev" in query:
            return [
                {"title": "React useActionState", "url": "https://react.dev/reference/react/useActionState", "body": "官方 API"},
                {"title": "React useActionState duplicate", "url": "https://react.dev/reference/react/useActionState/", "body": "重复 URL"},
            ]
        return [
            {"title": "博客解读", "url": "https://dev.to/react", "body": "第三方解读"},
            {"title": "React useActionState", "url": "https://react.dev/reference/react/useActionState", "body": "官方 API"},
        ]

    def fake_ddg(query, max_results, backend):
        return fake_search(query, max_results, backend)

    from unittest.mock import patch

    with patch("lib.tools.search_tools._ddg_search", side_effect=fake_ddg):
        results = search_web_structured("React useActionState", max_results=3, preferred_domains=["react.dev"])

    assert results[0]["url"] == "https://react.dev/reference/react/useActionState"
    assert results[0]["preferred"] is True
    assert len(results) == 2
