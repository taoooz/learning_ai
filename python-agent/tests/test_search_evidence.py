# tests/test_search_evidence.py — V2 任务内容搜索证据包：启发式判定 / 证据包构建 / prompt 注入

import json
from unittest.mock import patch

import pytest

from services.search_evidence import build_evidence_pack, needs_search


# ---- needs_search 启发式 ----


def test_needs_search_time_sensitive_topics():
    """时效性/工具类主题 → 搜索"""
    assert needs_search("Next.js 15 新特性", "了解最新版本变化") is True
    assert needs_search("React 状态管理库对比", "选型与生态") is True
    assert needs_search("Claude API 价格", "当前定价策略") is True


def test_needs_search_stable_basics_skipped():
    """稳定基础概念（纯概念认知）→ 不搜索"""
    assert needs_search("认识 HTTP 缓存", "理解缓存基本概念") is False
    assert needs_search("什么是变量作用域", "理解概念本质") is False


def test_needs_search_tool_practice_searched():
    """工具实践类 → 搜索（配置/实战/排查等关键词）"""
    assert needs_search("Git 分支操作实战", "分支创建与合并实践") is True
    assert needs_search("缓存排查", "更新不生效的排查方法") is True


def test_needs_search_env_kill_switch(monkeypatch):
    monkeypatch.setenv("DISABLE_WEB_SEARCH", "1")
    assert needs_search("Next.js 15 新特性", "最新版本") is False


# ---- build_evidence_pack ----


def test_build_evidence_pack_parses_sources():
    fake = (
        "- Next.js 15 发布说明\n"
        "  新版本带来了大量更新\n"
        "  来源: https://example.com/next15\n"
        "- React 19 对比\n"
        "  服务组件相关变化\n"
        "  来源: https://example.com/react19"
    )
    with patch("lib.tools.search_tools.web_search", return_value=fake):
        import asyncio
        pack = asyncio.run(build_evidence_pack("Next.js 15 新特性"))
    assert pack is not None
    assert "Next.js 15" in pack["evidence"]
    assert len(pack["sources"]) == 2
    assert pack["sources"][0]["url"] == "https://example.com/next15"


def test_build_evidence_pack_no_results_returns_none():
    with patch("lib.tools.search_tools.web_search", return_value="未找到相关结果"):
        import asyncio
        assert asyncio.run(build_evidence_pack("完全不存在的主题xyzq")) is None


def test_build_evidence_pack_search_error_returns_none():
    with patch("lib.tools.search_tools.web_search", side_effect=RuntimeError("网络错误")):
        import asyncio
        assert asyncio.run(build_evidence_pack("任意查询")) is None


# ---- prompt 注入 ----


def test_task_prompt_injects_evidence_section():
    """有证据包时 prompt 末尾追加证据节与来源（§搜索策略：证据包注入，不塞全量网页）"""
    import asyncio
    from services.task_content_service import build_task_content_prompt
    import sys
    sys.path.insert(0, ".")
    from tests.test_task_content import _request  # 复用既有请求工厂

    request = _request()
    prompt_with = build_task_content_prompt(
        request,
        evidence="- Next.js 15 发布说明\n  来源: https://example.com/next15",
        sources=[{"title": "Next.js 15", "url": "https://example.com/next15"}],
    )
    prompt_without = build_task_content_prompt(request)

    assert "搜索证据包" in prompt_with
    assert "https://example.com/next15" in prompt_with
    assert "搜索证据包" not in prompt_without
