"""R4：证据驱动掌握度——取代两处不一致的固定映射，单次观测不称掌握。"""

import json

from services.memory_v4_store import mastery_score


def test_single_observation_never_reaches_mastery():
    """只见过一次证据，即使表现好也不给「已掌握」级分数。"""
    state = {"status": "demonstrated", "evidenceCount": 1, "strongEvidenceCount": 1}
    assert mastery_score(state) == 0.7


def test_repeated_strong_evidence_raises_score():
    once = mastery_score({"status": "demonstrated", "evidenceCount": 1, "strongEvidenceCount": 1})
    twice = mastery_score({"status": "demonstrated", "evidenceCount": 3, "strongEvidenceCount": 2})
    many = mastery_score({"status": "demonstrated", "evidenceCount": 6, "strongEvidenceCount": 5})
    assert once < twice < many
    assert many == 0.95  # 加成上限 0.15


def test_status_ordering_preserved():
    def score(status):
        return mastery_score({"status": status, "evidenceCount": 4, "strongEvidenceCount": 3})

    assert score("demonstrated") > score("fragile") > score("needs_review") > score("developing")


def test_unknown_status_falls_back_to_lowest():
    assert mastery_score({"status": "weird", "evidenceCount": 5, "strongEvidenceCount": 4}) == 0.25
    assert mastery_score({}) == 0.25


def test_score_stays_in_unit_range():
    for status in ("demonstrated", "fragile", "needs_review", "developing", None):
        for total in (0, 1, 3, 20):
            for strong in (0, 1, 4, 50):
                value = mastery_score({"status": status, "evidenceCount": total, "strongEvidenceCount": strong})
                assert 0.0 <= value <= 1.0


def test_both_payload_paths_agree_on_same_concept(tmp_path):
    """同一概念在 chat 上下文与辅导 payload 里必须给出同一个掌握度。"""
    from services.memory_context_v4 import to_chat_prompt_payload
    from services.memory_v4_store import MemoryV4Store

    state = {
        "conceptKey": "router-worker", "conceptName": "Router 与 Worker",
        "status": "demonstrated", "evidenceCount": 4, "strongEvidenceCount": 3,
        "misconceptions": [],
    }
    chat_payload = to_chat_prompt_payload({
        "core": {"activePreferences": []},
        "learningState": {"conceptStates": [state], "topicStates": []},
        "index": [],
    })
    chat_score = chat_payload["focusConceptStates"][0]["masteryScore"]

    store = MemoryV4Store(tmp_path)
    # 直接播种投影：build_chat_context 从 store.projections 读概念状态。
    path = store._store_path("account-a")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "version": 4,
        "records": [],
        "projections": {"conceptStates": [dict(state, topic="SuperAgent", updatedAt=1000)]},
    }, ensure_ascii=False), encoding="utf-8")
    built = store.build_chat_context("account-a", topic="SuperAgent")
    assert built["focusConceptStates"][0]["masteryScore"] == chat_score == mastery_score(state)
