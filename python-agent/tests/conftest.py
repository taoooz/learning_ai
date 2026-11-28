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


@pytest.fixture
def real_excerpt_fetch(monkeypatch):
    """恢复真实抓取函数（由用例自行 mock httpx.get）。"""
    monkeypatch.setattr(_es, "_fetch_full_text", _REAL_FETCH)
    return _REAL_FETCH