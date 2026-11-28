"""正文摘录深化：一手来源抓全文写入 excerpt，失败回退摘要。

背景：摘要只有 260 字且常是网页样板（版权声明/协议），生成用不上真实数据。
此前只有读取 excerpt 的代码，没有写入侧，等于空转。
"""

import pytest

from services import evidence_store as es


class _FakeResponse:
    def __init__(self, text: str, content_type: str = "text/html; charset=utf-8", status: int = 200):
        self.content = text.encode("utf-8")
        self.headers = {"content-type": content_type}
        self.encoding = "utf-8"
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def _source(url="https://example.com/a", primary=True, authority=80, summary="样板摘要"):
    return {
        "evidenceId": "ev-01",
        "title": "标题",
        "url": url,
        "summary": summary,
        "authorityScore": authority,
        "isPrimary": primary,
    }


class TestFetchFullText:
    def test_extracts_body_and_drops_boilerplate(self, real_excerpt_fetch, monkeypatch):
        html = (
            "<html><head><meta charset=\"utf-8\"></head><body><nav>导航导航导航</nav>"
            "<article><p>正文段落，讲的是快路径如何用程序规则先筛掉大部分事件，"
            "从而把模型算力留给真正需要推理的那部分。"
            "文章还给了一组对照：去掉直通之后任务完成时间几乎没变，"
            "但 Router 的决定数多了约 30%，总读缓存 token 从 2323 万涨到 3177 万，涨了约 37%，"
            "这一段要足够长才能通过长度检查，避免被当成反爬空壳页丢弃。</p></article>"
            "<script>var x = 1;</script><footer>版权声明</footer></body></html>"
        )
        monkeypatch.setattr("httpx.get", lambda *a, **k: _FakeResponse(html))
        text = real_excerpt_fetch("https://example.com/a")
        assert text and "快路径" in text
        assert "导航" not in text and "版权声明" not in text and "var x" not in text

    def test_rejects_non_html(self, real_excerpt_fetch, monkeypatch):
        monkeypatch.setattr("httpx.get", lambda *a, **k: _FakeResponse("{}", content_type="application/json"))
        assert real_excerpt_fetch("https://example.com/a") is None

    def test_rejects_http_error(self, real_excerpt_fetch, monkeypatch):
        monkeypatch.setattr("httpx.get", lambda *a, **k: _FakeResponse("<html/>", status=403))
        assert real_excerpt_fetch("https://example.com/a") is None

    def test_rejects_network_exception(self, real_excerpt_fetch, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("connection refused")
        monkeypatch.setattr("httpx.get", boom)
        assert real_excerpt_fetch("https://example.com/a") is None

    def test_rejects_empty_shell_page(self, real_excerpt_fetch, monkeypatch):
        monkeypatch.setattr("httpx.get", lambda *a, **k: _FakeResponse("<html><body>短</body></html>"))
        assert real_excerpt_fetch("https://example.com/a") is None


class TestEnrichPrimaryExcerpts:
    def test_primary_source_gets_excerpt(self, monkeypatch):
        monkeypatch.setattr(es, "_fetch_full_text", lambda url: "正文" * 100)
        sources = [_source()]
        es._enrich_primary_excerpts(sources)
        assert sources[0]["excerpt"].startswith("正文")

    def test_non_primary_untouched(self, monkeypatch):
        called = []
        monkeypatch.setattr(es, "_fetch_full_text", lambda url: called.append(url) or "x" * 500)
        sources = [_source(primary=False)]
        es._enrich_primary_excerpts(sources)
        assert "excerpt" not in sources[0]
        assert called == []

    def test_existing_excerpt_not_refetched(self, monkeypatch):
        called = []
        monkeypatch.setattr(es, "_fetch_full_text", lambda url: called.append(url) or "x" * 500)
        sources = [_source()]
        sources[0]["excerpt"] = "已有摘录"
        es._enrich_primary_excerpts(sources)
        assert called == []

    def test_fetch_failure_keeps_summary(self, monkeypatch):
        monkeypatch.setattr(es, "_fetch_full_text", lambda url: None)
        sources = [_source()]
        es._enrich_primary_excerpts(sources)
        assert "excerpt" not in sources[0]
        assert sources[0]["summary"] == "样板摘要"

    def test_limit_and_authority_order(self, monkeypatch):
        fetched = []

        def fake(url):
            fetched.append(url)
            return "正文" * 50

        monkeypatch.setattr(es, "_fetch_full_text", fake)
        sources = [
            _source(url="https://low.example", authority=30),
            _source(url="https://high.example", authority=90),
            _source(url="https://mid.example", authority=60),
        ]
        es._enrich_primary_excerpts(sources)
        assert fetched == ["https://high.example", "https://mid.example"]
        assert "excerpt" in sources[1] and "excerpt" in sources[2]
        assert "excerpt" not in sources[0]

    def test_disable_switch(self, monkeypatch):
        monkeypatch.setenv("DISABLE_EVIDENCE_EXCERPT", "1")
        called = []
        monkeypatch.setattr(es, "_fetch_full_text", lambda url: called.append(url) or "x" * 500)
        sources = [_source()]
        es._enrich_primary_excerpts(sources)
        assert called == []


class TestPromptUsesExcerpt:
    def test_evidence_to_prompt_prefers_excerpt(self):
        pack = {
            "topic": "t",
            "sources": [{
                "evidenceId": "ev-01", "title": "标题", "url": "https://example.com/a",
                "summary": "网页样板摘要", "excerpt": "真正有用的正文数据：快路径分流 30%",
                "kind": "knowledge", "isPrimary": True, "authorityScore": 90,
            }],
        }
        text, _ = es.evidence_to_prompt(pack)
        assert "快路径分流 30%" in text
        assert "网页样板摘要" not in text

    def test_evidence_to_prompt_falls_back_to_summary(self):
        pack = {
            "topic": "t",
            "sources": [{
                "evidenceId": "ev-01", "title": "标题", "url": "https://example.com/a",
                "summary": "只有摘要", "kind": "knowledge", "isPrimary": True,
            }],
        }
        text, _ = es.evidence_to_prompt(pack)
        assert "只有摘要" in text


class TestPromptBudget:
    def test_excerpt_not_clipped_at_3000(self):
        """此前硬编码 3000 字上限，两个来源就把正文挤掉，等于摘录白抓。"""
        body = "开头标记 " + ("正文内容 " * 900) + " 尾部标记"
        pack = {
            "topic": "t",
            "sources": [{
                "evidenceId": "ev-01", "title": "标题", "url": "https://example.com/a",
                "summary": "摘要", "excerpt": body, "kind": "knowledge", "isPrimary": True,
            }],
        }
        text, _ = es.evidence_to_prompt(pack)
        assert "尾部标记" in text
        assert len(text) > 3000

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("EVIDENCE_PROMPT_MAX_CHARS", "1000")
        body = "正文内容 " * 900
        pack = {
            "topic": "t",
            "sources": [{
                "evidenceId": "ev-01", "title": "标题", "url": "https://example.com/a",
                "summary": "摘要", "excerpt": body, "kind": "knowledge", "isPrimary": True,
            }],
        }
        text, _ = es.evidence_to_prompt(pack)
        assert len(text) <= 1000

    def test_invalid_env_falls_back(self, monkeypatch):
        monkeypatch.setenv("EVIDENCE_PROMPT_MAX_CHARS", "not-a-number")
        assert es._prompt_max_chars() == es.DEFAULT_PROMPT_MAX_CHARS