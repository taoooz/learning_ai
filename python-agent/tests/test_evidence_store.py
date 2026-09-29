"""课程 / 章节级 EvidencePack：持久化、TTL、复用与最小查询计划。"""

import asyncio
from unittest.mock import patch

import pytest

from services.evidence_store import (
    build_query_plan,
    evidence_to_prompt,
    select_relevant_sources,
    task_evidence_coverage,
    ensure_chapter_evidence_pack,
    get_chapter_evidence,
    invalidate_chapter_evidence,
    save_chapter_evidence,
)


def _pack(now=1000.0, course_id="course-1", chapter_id="ch-1", ttl=7 * 24 * 60 * 60):
    return {
        "packId": "evp-test",
        "schemaVersion": 1,
        "courseId": course_id,
        "chapterId": chapter_id,
        "courseTopic": "React 进阶实战",
        "chapterTitle": "useActionState",
        "queryPlan": [{"kind": "official", "query": "site:react.dev React", "preferredDomains": ["react.dev"]}],
        "sources": [{
            "evidenceId": "ev-01-abcdef",
            "title": "useActionState",
            "url": "https://react.dev/reference/react/useActionState",
            "domain": "react.dev",
            "summary": "React 官方 API",
            "authorityScore": 100,
            "preferred": True,
            "retrievedAt": int(now * 1000),
        }],
        "createdAt": int(now * 1000),
        "refreshedAt": int(now * 1000),
        "expiresAt": now + ttl,
    }


def test_build_query_plan_prefers_official_domain():
    plan = build_query_plan("React 进阶实战", "useActionState 的执行时机")
    assert plan[0]["kind"] == "official"
    assert plan[0]["query"].startswith("site:react.dev ")
    assert plan[1]["kind"] == "general"


def test_save_and_get_chapter_evidence(tmp_path):
    root = tmp_path / "evidence"
    pack = _pack(now=1000.0)
    save_chapter_evidence(pack, root_dir=root)
    loaded = get_chapter_evidence("course-1", "ch-1", root_dir=root, now=2000.0)
    assert loaded is not None
    assert loaded["packId"] == "evp-test"
    assert loaded["sources"][0]["url"].startswith("https://react.dev/")


def test_expired_evidence_is_not_returned(tmp_path):
    root = tmp_path / "evidence"
    save_chapter_evidence(_pack(now=1000.0, ttl=10), root_dir=root)
    assert get_chapter_evidence("course-1", "ch-1", root_dir=root, now=2000.0) is None
    invalidate_chapter_evidence("course-1", "ch-1", root_dir=root)
    assert get_chapter_evidence("course-1", "ch-1", root_dir=root) is None


def test_corrupt_store_falls_back_to_empty(tmp_path):
    root = tmp_path / "evidence"
    root.mkdir()
    (root / "course-1.json").write_text("{broken", encoding="utf-8")
    assert get_chapter_evidence("course-1", "ch-1", root_dir=root) is None


def test_ensure_reuses_cached_pack_without_search(tmp_path):
    root = tmp_path / "evidence"
    save_chapter_evidence(_pack(now=1000.0), root_dir=root)

    def fail_search(*args, **kwargs):
        raise AssertionError("cached evidence must not trigger search")

    with patch("services.evidence_store.search_web_structured", side_effect=fail_search):
        asyncio.run(ensure_chapter_evidence_pack(
            "course-1", "ch-1", "React 进阶实战", "useActionState",
            root_dir=root,
        ))
    assert get_chapter_evidence("course-1", "ch-1", root_dir=root, now=2000.0) is not None


def test_ensure_builds_and_persists_new_pack(tmp_path):
    root = tmp_path / "evidence"

    def fake_search(query, max_results, preferred_domains):
        return [{
            "title": "useActionState – React",
            "url": "https://react.dev/reference/react/useActionState",
            "body": "React official API",
            "authorityScore": 100,
            "preferred": True,
        }]

    with patch("services.evidence_store.search_web_structured", side_effect=fake_search):
        pack = asyncio.run(ensure_chapter_evidence_pack(
            "course-1", "ch-1", "React 进阶实战", "useActionState",
            root_dir=root,
        ))

    assert pack is not None
    assert pack["sources"][0]["domain"] == "react.dev"
    assert get_chapter_evidence("course-1", "ch-1", root_dir=root, now=3000.0) is not None


def _multi_source_pack():
    return {
        "packId": "evp-multi",
        "schemaVersion": 1,
        "courseId": "course-1",
        "chapterId": "ch-1",
        "courseTopic": "React 进阶实战",
        "chapterTitle": "表单与状态",
        "queryPlan": [],
        "sources": [
            {
                "evidenceId": "ev-01",
                "title": "useActionState React 官方 API",
                "url": "https://react.dev/reference/react/useactionstate",
                "domain": "react.dev",
                "summary": "React official useActionState API",
                "authorityScore": 100,
                "preferred": True,
                "retrievedAt": 1,
            },
            {
                "evidenceId": "ev-02",
                "title": "React 19 release notes",
                "url": "https://react.dev/blog/react-19",
                "domain": "react.dev",
                "summary": "React 19 changes",
                "authorityScore": 90,
                "preferred": True,
                "retrievedAt": 1,
            },
            {
                "evidenceId": "ev-03",
                "title": "CSS Grid guide",
                "url": "https://developer.mozilla.org/docs/web/css/css_grid",
                "domain": "developer.mozilla.org",
                "summary": "CSS Grid",
                "authorityScore": 95,
                "preferred": False,
                "retrievedAt": 1,
            },
        ],
        "createdAt": 1,
        "refreshedAt": 1,
        "expiresAt": 9999999999.0,
    }


def test_select_relevant_sources_prefers_task_matching_source():
    pack = _multi_source_pack()
    selected = select_relevant_sources(
        pack,
        "useActionState 的执行时机",
        "理解 useActionState 的 pending 与状态更新",
        max_sources=2,
    )
    assert selected[0]["evidenceId"] == "ev-01"
    assert all(source["evidenceId"] != "ev-03" for source in selected)


def test_select_relevant_sources_preserves_pack_when_no_terms():
    selected = select_relevant_sources(_multi_source_pack(), "", "")
    assert len(selected) == 3


def test_evidence_to_prompt_filters_by_task_context():
    evidence, sources = evidence_to_prompt(
        _multi_source_pack(),
        "useActionState 的执行时机",
        "理解 useActionState",
        max_sources=2,
    )
    assert evidence is not None
    assert "useactionstate" in evidence.lower()
    assert len(sources) <= 2
    assert all("css_grid" not in source["url"] for source in sources)


def test_task_evidence_coverage_accepts_exact_technical_term():
    pack = _multi_source_pack()
    coverage = task_evidence_coverage(
        pack,
        "useActionState 的执行时机",
        "理解 useActionState",
    )
    assert coverage["covered"] is True


def test_task_evidence_coverage_requires_two_chinese_matches():
    pack = {
        "sources": [{
            "title": "缓存基础",
            "summary": "浏览器缓存",
            "url": "https://example.com/cache",
            "authorityScore": 60,
        }]
    }
    # “缓存”相关 2-gram 可命中，但只有单一弱匹配不足以免补搜。
    coverage = task_evidence_coverage(pack, "理解缓存", "掌握缓存")
    assert coverage["covered"] is False


def test_task_evidence_coverage_without_task_terms_is_covered():
    coverage = task_evidence_coverage(_multi_source_pack(), "", "")
    assert coverage["covered"] is True
