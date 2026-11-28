"""全局测试夹具。

证据摘录深化会真的去抓网页：测试里默认关掉，避免拖慢与依赖网络。
需要验证抓取逻辑的用例用 `real_excerpt_fetch` 夹具自行 mock httpx。
"""

import pytest

from services import evidence_store as _es

_REAL_FETCH = _es._fetch_full_text


@pytest.fixture(autouse=True)
def _no_excerpt_network(monkeypatch):
    monkeypatch.setattr(_es, "_fetch_full_text", lambda url: None)


@pytest.fixture(autouse=True)
def _no_topic_evidence_search(monkeypatch):
    """TOC 阶段会真的去搜主题证据：测试里默认关掉，避免联网与超时。"""
    from services import toc_agent as _toc

    monkeypatch.setattr(_toc, "ensure_topic_evidence_pack_sync", lambda topic, **kwargs: None)


@pytest.fixture
def real_topic_evidence_build(monkeypatch):
    """恢复真实主题证据构建入口（由用例自行 mock 搜索与抓取）。"""
    from services import evidence_store as _es
    from services import toc_agent as _toc

    monkeypatch.setattr(_toc, "ensure_topic_evidence_pack_sync", _es.ensure_topic_evidence_pack_sync)
    return _es.ensure_topic_evidence_pack_sync


@pytest.fixture
def real_excerpt_fetch(monkeypatch):
    """恢复真实抓取函数（由用例自行 mock httpx.get）。"""
    monkeypatch.setattr(_es, "_fetch_full_text", _REAL_FETCH)
    return _REAL_FETCH