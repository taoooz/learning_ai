"""课程级主题证据包：持久化、TTL、查询计划和复用。"""

from unittest.mock import patch

from services.evidence_store import (
    build_course_query_plan,
    ensure_topic_evidence_pack_sync,
    get_topic_evidence,
    save_topic_evidence,
)


def _pack(now=1000.0, topic="React 进阶实战", ttl=7 * 24 * 60 * 60):
    return {
        "packId": "evp-topic-test",
        "schemaVersion": 1,
        "scope": "course",
        "topic": topic,
        "queryPlan": [{"kind": "official", "query": "site:react.dev React", "preferredDomains": ["react.dev"]}],
        "sources": [{
            "evidenceId": "ev-01-abcdef",
            "title": "React docs",
            "url": "https://react.dev/reference/react/useActionState",
            "domain": "react.dev",
            "summary": "Official API",
            "authorityScore": 100,
            "preferred": True,
            "retrievedAt": int(now * 1000),
        }],
        "createdAt": int(now * 1000),
        "refreshedAt": int(now * 1000),
        "expiresAt": now + ttl,
    }


def test_course_query_plan_prefers_official_source():
    plan = build_course_query_plan("React 进阶实战")
    assert plan[0]["kind"] == "official"
    assert plan[0]["preferredDomains"] == ["react.dev"]


def test_topic_evidence_roundtrip_and_ttl(tmp_path):
    root = tmp_path / "topics"
    save_topic_evidence(_pack(), root_dir=root)
    assert get_topic_evidence("React 进阶实战", root_dir=root, now=2000.0) is not None
    save_topic_evidence(_pack(now=1000.0, ttl=10), root_dir=root)
    assert get_topic_evidence("React 进阶实战", root_dir=root, now=2000.0) is None


def test_ensure_topic_evidence_reuses_cache_without_search(tmp_path):
    root = tmp_path / "topics"
    import time
    save_topic_evidence(_pack(now=time.time()), root_dir=root)

    def fail_search(*args, **kwargs):
        raise AssertionError("topic cache must not trigger search")

    with patch("services.evidence_store.search_web_structured", side_effect=fail_search):
        pack = ensure_topic_evidence_pack_sync("React 进阶实战", root_dir=root)
    assert pack is not None
    assert pack["sources"][0]["url"].startswith("https://react.dev/")


def test_ensure_topic_evidence_builds_and_saves(tmp_path):
    root = tmp_path / "topics"

    def fake_search(query, max_results, preferred_domains):
        return [{
            "title": "React docs",
            "url": "https://react.dev/reference/react/useActionState",
            "body": "Official API",
            "authorityScore": 100,
            "preferred": True,
        }]

    with patch("services.evidence_store.search_web_structured", side_effect=fake_search):
        pack = ensure_topic_evidence_pack_sync("React 进阶实战", root_dir=root)
    assert pack is not None
    assert get_topic_evidence("React 进阶实战", root_dir=root, now=2000.0) is not None
