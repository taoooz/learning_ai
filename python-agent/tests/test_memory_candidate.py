import asyncio
import json
from unittest.mock import AsyncMock

from services.memory_candidate_service import (
    derive_repeated_behavior_candidates,
    extract_memory_candidates,
    should_extract_memory_candidates,
    validate_candidates,
)
from services.memory_v4_store import MemoryV4Store


def _messages(text="以后复杂概念请分步骤讲"):
    return [
        {"messageId": "user-1", "role": "user", "content": text},
        {"messageId": "assistant-1", "role": "assistant", "content": "好的，我会分步骤解释。"},
    ]


def _raw_candidate(content="以后复杂概念请分步骤讲", *, confidence=0.9, kind="preference"):
    return {
        "kind": kind,
        "title": "解释偏好",
        "summary": "分步解释",
        "content": content,
        "scopeType": "user",
        "sourceType": "explicit_user_statement",
        "confidence": confidence,
        "importance": 0.8,
        "durability": "long_term",
        "suggestedAction": "add",
        "tags": ["explanation_style"],
        "sourceMessageId": "user-1",
        "sourceQuote": content,
    }


def test_should_extract_prefilters_normal_chat():
    assert should_extract_memory_candidates(_messages("什么是工具调用？")) is False
    assert should_extract_memory_candidates(_messages("以后复杂概念请分步骤讲")) is True


def test_validate_candidates_rejects_unsafe_and_normalizes():
    raw = [
        _raw_candidate(),
        {"kind": "mastery", "content": "已经掌握", "sourceType": "explicit_user_statement"},
    ]
    candidates = validate_candidates(
        raw,
        account_id="account-a",
        course_id="course-1",
        topic="Agent",
        messages=_messages(),
        now=1000,
    )
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["kind"] == "preference"
    assert candidate["accountId"] == "account-a"
    assert candidate["sourceRefs"][0]["type"] == "user_message"
    assert candidate["dedupeKey"]


def test_extract_memory_candidates_uses_llm_and_validates():
    async def run():
        client = AsyncMock()
        client.chat.return_value = {
            "choices": [{"message": {"content": json.dumps({
                "candidates": [{
                    **_raw_candidate(),
                }]
            }, ensure_ascii=False)}}]
        }
        return await extract_memory_candidates(
            account_id="account-a", course_id="course-1", topic="Agent",
            messages=_messages(), memory_store={"records": []}, client=client, now=1000,
        )
    result = asyncio.run(run())
    assert len(result) == 1
    assert result[0]["content"] == "以后复杂概念请分步骤讲"


def test_consolidation_applies_confident_candidate(tmp_path):
    store = MemoryV4Store(tmp_path)
    candidate = validate_candidates(
        [_raw_candidate()],
        account_id="account-a",
        course_id="course-1",
        topic="Agent",
        messages=_messages(),
        now=1000,
    )[0]
    store.append_candidate("account-a", candidate)
    result = store.consolidate_candidates("account-a")
    assert result["applied"] == 1
    active = [r for r in result["store"]["records"] if r["status"] == "active"]
    assert active[0]["kind"] == "preference"


def test_consolidation_keeps_low_confidence_pending(tmp_path):
    store = MemoryV4Store(tmp_path)
    candidate = validate_candidates(
        [_raw_candidate("可能喜欢例子驱动", confidence=0.5)],
        account_id="account-a",
        course_id="course-1",
        topic="Agent",
        messages=_messages("可能喜欢例子驱动"),
        now=1000,
    )[0]
    store.append_candidate("account-a", candidate)
    result = store.consolidate_candidates("account-a")
    assert result["applied"] == 0
    assert result["pending"] == 1
    assert result["store"]["records"] == []


def test_candidate_append_is_idempotent(tmp_path):
    store = MemoryV4Store(tmp_path)
    candidate = validate_candidates(
        [_raw_candidate("希望转型 AI 产品经理", kind="goal")],
        account_id="account-a",
        course_id="course-1",
        topic="Agent",
        messages=_messages("希望转型 AI 产品经理"),
        now=1000,
    )[0]
    assert store.append_candidate("account-a", candidate)["duplicate"] is False
    assert store.append_candidate("account-a", candidate)["duplicate"] is True


def test_user_api_candidates_and_consolidate(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    from fastapi.testclient import TestClient
    from main import app

    memory_module._DATA_ROOT = tmp_path
    client = TestClient(app)
    headers = {"X-Account-Id": "account-a"}
    store = MemoryV4Store(tmp_path)
    candidate = validate_candidates(
        [_raw_candidate("希望转型 AI 产品经理", kind="goal")],
        account_id="account-a",
        course_id="course-1",
        topic="Agent",
        messages=_messages("希望转型 AI 产品经理"),
        now=1000,
    )[0]
    store.append_candidate("account-a", candidate)
    response = client.get("/api/user/memory/candidates", headers=headers)
    assert response.status_code == 200
    assert len(response.json()["candidates"]) == 1
    response = client.post("/api/user/memory/consolidate", headers=headers)
    assert response.status_code == 200
    assert response.json()["applied"] == 1


def test_tombstoned_memory_is_not_recreated_by_candidate(tmp_path):
    store = MemoryV4Store(tmp_path)
    candidate = validate_candidates(
        [_raw_candidate()],
        account_id="account-a",
        course_id="course-1",
        topic="Agent",
        messages=_messages(),
        now=1000,
    )[0]
    store.append_candidate("account-a", candidate)
    first = store.consolidate_candidates("account-a")
    memory_id = first["store"]["records"][0]["memoryId"]
    store.tombstone_record("account-a", memory_id, "user_forget")
    same = dict(candidate)
    same["candidateId"] = "candidate-again"
    same["status"] = "pending"
    store.append_candidate("account-a", same)
    second = store.consolidate_candidates("account-a")
    assert second["applied"] == 0
    assert second["rejected"] == 1
    active = [r for r in second["store"]["records"] if r["status"] == "active"]
    assert active == []


def test_forged_candidate_quote_is_rejected():
    raw = [_raw_candidate("用户承诺每天学习两小时")]
    candidates = validate_candidates(
        raw,
        account_id="account-a",
        course_id="course-1",
        topic="Agent",
        messages=_messages("以后复杂概念请分步骤讲"),
        now=1000,
    )
    assert candidates == []


def test_repeated_behavior_is_derived_from_server_messages():
    messages = [
        {"messageId": "u1", "role": "user", "content": "以后请分步骤讲"},
        {"messageId": "a1", "role": "assistant", "content": "好"},
        {"messageId": "u2", "role": "user", "content": "还是分步说明比较好"},
    ]
    candidates = derive_repeated_behavior_candidates(
        account_id="account-a",
        course_id="course-1",
        messages=messages,
        now=1000,
    )
    assert len(candidates) == 1
    assert candidates[0]["sourceType"] == "repeated_behavior"
    assert {ref["messageId"] for ref in candidates[0]["sourceRefs"]} == {"u1", "u2"}
