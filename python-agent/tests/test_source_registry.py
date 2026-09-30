"""免预算搜索来源策略：权威域推断、来源排序和 URL 去重。"""

from lib.tools.search_tools import search_web_structured
from lib.tools.source_registry import infer_preferred_domains, infer_source_kind, source_authority


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


def test_source_kind_separates_knowledge_and_wisdom():
    assert infer_source_kind("https://react.dev/reference/react/useActionState") == "knowledge"
    assert infer_source_kind("https://news.ycombinator.com/item?id=1") == "wisdom"
    assert infer_source_kind("https://stackoverflow.com/questions/1") == "wisdom"


def test_more_framework_domains_are_recognized():
    assert infer_preferred_domains("Meta Muse App")[0] == "about.fb.com"
    assert infer_preferred_domains("Kubernetes 入门")[0] == "kubernetes.io"


def test_chinese_official_domains_are_preferred_by_topic():
    assert infer_preferred_domains("中国宏观经济统计数据")[:2] == ["pbc.gov.cn", "stats.gov.cn"]
    assert infer_preferred_domains("医疗卫生政策")[:2] == ["nhc.gov.cn", "cdc.gov.cn"]
    assert infer_preferred_domains("政府政策和国家标准")[:2] == ["gov.cn", "npc.gov.cn"]
    assert infer_preferred_domains("学术论文与科学研究")[:2] == ["cas.cn", "cnki.net"]
    assert infer_preferred_domains("阿里云云服务实践")[:2] == ["help.aliyun.com", "cloud.tencent.com"]
    assert infer_preferred_domains("新华社和人民日报报道")[:2] == ["news.cn", "people.com.cn"]


def test_chinese_official_domains_receive_high_authority():
    assert source_authority("https://www.gov.cn/zhengce/") == 98
    assert source_authority("https://stats.gov.cn/sj/") == 97
    assert source_authority("https://www.tsinghua.edu.cn/") == 90
    assert source_authority("https://www.pku.edu.cn/") == 90


def test_chinese_community_domains_are_wisdom_sources():
    assert infer_source_kind("https://zhuanlan.zhihu.com/p/1") == "wisdom"
    assert infer_source_kind("https://segmentfault.com/a/1") == "wisdom"
    assert infer_source_kind("https://www.v2ex.com/t/1") == "wisdom"
    assert infer_source_kind("https://juejin.cn/post/1") == "wisdom"
    assert infer_source_kind("https://blog.csdn.net/a") == "wisdom"


def test_chinese_government_and_academic_suffixes_receive_default_authority():
    assert source_authority("https://www.nhsa.gov.cn/") == 96
    assert source_authority("https://www.shanghai.gov.cn/") == 96
    assert source_authority("https://www.sjtu.edu.cn/") == 85
    assert source_authority("https://www.ihep.cas.cn/") == 90
