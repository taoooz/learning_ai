"""Memory Candidate 提取：LLM 只产出候选，不直接写长期 Memory。"""
from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any

from lib.minimax import MiniMaxClient, parse_json_response
from prompts import get_prompt
from services.memory_context_v4 import wrap_untrusted_context

PROMPT_VERSION = "memory-candidate-v1"
MAX_CANDIDATES = 3

_EXTRACTION_HINTS = [
    "以后", "今后", "一直", "每次都", "记住", "请记得", "我喜欢", "我偏好",
    "我希望", "我想要", "我习惯", "我不喜欢", "不要", "别再", "以后都",
    "分步骤", "举个例子", "简单点", "通俗", "类比", "打比方", "对比",
]
_SAFE_KINDS = {"preference", "goal", "constraint", "fact"}
_SAFE_SOURCE_TYPES = {"explicit_user_statement"}
_SAFE_DURABILITY = {"course", "long_term"}


def should_extract_memory_candidates(messages: list[dict[str, Any]]) -> bool:
    """轻量预筛，避免每轮聊天都调用记忆提取模型。"""
    user_text = "\n".join(
        str(message.get("content") or "")
        for message in messages
        if message.get("role") == "user"
    )
    return any(hint in user_text for hint in _EXTRACTION_HINTS)


def _normalize_text(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _dedupe_key(account_id: str, candidate: dict[str, Any]) -> str:
    scope = candidate.get("scope") or {}
    payload = json.dumps(
        {
            "account": account_id,
            "kind": candidate.get("kind"),
            "scope": scope,
            "content": candidate.get("content"),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _existing_memory(memory_store: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "memoryId": record.get("memoryId"),
            "kind": record.get("kind"),
            "title": record.get("title"),
            "summary": record.get("summary"),
        }
        for record in memory_store.get("records", [])
        if record.get("status") == "active"
    ][:12]


def validate_candidates(
    raw_candidates: list[dict[str, Any]],
    *,
    account_id: str,
    course_id: str,
    topic: str,
    messages: list[dict[str, Any]] | None = None,
    now: int | None = None,
) -> list[dict[str, Any]]:
    at = int(now if now is not None else time.time() * 1000)
    user_messages = [
        item for item in (messages or [])
        if item.get("role") == "user" and item.get("messageId") and item.get("content")
    ]
    messages_by_id = {str(item["messageId"]): str(item["content"]) for item in user_messages}
    validated: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_candidates[:MAX_CANDIDATES]):
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("kind") or "")
        source_type = str(raw.get("sourceType") or "")
        durability = str(raw.get("durability") or "long_term")
        source_message_id = str(raw.get("sourceMessageId") or "").strip()
        source_quote = _normalize_text(raw.get("sourceQuote"), 1200)
        source_content = _normalize_text(messages_by_id.get(source_message_id), 4000)
        if not source_message_id or len(source_quote) < 4 or not source_content:
            continue
        # LLM 可能伪造 messageId 或改写用户原话；只接受服务端消息中的逐字连续片段。
        if source_quote not in source_content:
            continue
        content = source_quote
        if kind not in _SAFE_KINDS or source_type not in _SAFE_SOURCE_TYPES or durability not in _SAFE_DURABILITY:
            continue
        if not content:
            continue
        scope_type = str(raw.get("scopeType") or "course")
        if scope_type == "user":
            scope = {"type": "user"}
        else:
            scope = {"type": "course", "courseId": course_id}
        confidence = raw.get("confidence")
        if not isinstance(confidence, (int, float)):
            confidence = 0.5
        confidence = max(0.0, min(0.95, float(confidence)))
        importance = raw.get("importance")
        if not isinstance(importance, (int, float)):
            importance = 0.6
        importance = max(0.0, min(1.0, float(importance)))
        suggested_action = str(raw.get("suggestedAction") or "add")
        if suggested_action not in {"add", "update", "supersede", "ignore"}:
            suggested_action = "add"
        title = _normalize_text(raw.get("title") or kind, 120)
        summary = _normalize_text(raw.get("summary") or content, 240)
        tags = [
            _normalize_text(tag, 40)
            for tag in (raw.get("tags") or [])
            if _normalize_text(tag, 40)
        ][:8]
        candidate = {
            "candidateId": "",
            "accountId": account_id,
            "kind": kind,
            "scope": scope,
            "title": title,
            "summary": summary,
            "content": content,
            "tags": tags,
            "conceptKeys": [],
            "sourceType": source_type,
            "sourceRefs": [{
                "type": "user_message",
                "conversationId": f"course:{course_id}",
                "messageId": source_message_id,
            }],
            "evidenceIds": [],
            "confidence": round(confidence, 3),
            "importance": round(importance, 3),
            "durability": durability,
            "sensitivity": "normal",
            "suggestedAction": suggested_action,
            "extractionVersion": PROMPT_VERSION,
            "createdAt": at,
            "status": "pending",
        }
        if raw.get("targetMemoryId"):
            candidate["targetMemoryId"] = str(raw["targetMemoryId"])
        candidate["dedupeKey"] = _dedupe_key(account_id, candidate)
        candidate["candidateId"] = f"candidate-{candidate['dedupeKey'][:16]}"
        validated.append(candidate)
    return validated


def derive_repeated_behavior_candidates(
    *,
    account_id: str,
    course_id: str,
    messages: list[dict[str, Any]],
    now: int | None = None,
) -> list[dict[str, Any]]:
    """由服务端对真实用户消息计数，生成可审计的重复偏好候选。"""
    at = int(now if now is not None else time.time() * 1000)
    style_rules = {
        "分步骤解释": ("分步骤", "分步"),
        "例子驱动": ("举例", "例子"),
        "类比解释": ("类比", "比喻"),
    }
    user_messages = [
        item for item in messages
        if item.get("role") == "user" and item.get("messageId") and item.get("content")
    ]
    derived: list[dict[str, Any]] = []
    for label, cues in style_rules.items():
        matched = [
            item for item in user_messages
            if any(cue in str(item.get("content") or "") for cue in cues)
        ]
        if len({item.get("messageId") for item in matched}) < 2:
            continue
        content = f"用户多次表达偏好：{label}"
        candidate = {
            "candidateId": "",
            "accountId": account_id,
            "kind": "preference",
            "scope": {"type": "user"},
            "title": "重复表达的学习偏好",
            "summary": content,
            "content": content,
            "tags": ["repeated_behavior", "explanation_style"],
            "conceptKeys": [],
            "sourceType": "repeated_behavior",
            "sourceRefs": [{
                "type": "user_message",
                "conversationId": f"course:{course_id}",
                "messageId": item["messageId"],
            } for item in matched[-3:]],
            "evidenceIds": [],
            "confidence": 0.86,
            "importance": 0.72,
            "durability": "long_term",
            "sensitivity": "normal",
            "suggestedAction": "add",
            "extractionVersion": "memory-behavior-counter-v1",
            "createdAt": at,
            "status": "pending",
        }
        candidate["dedupeKey"] = _dedupe_key(account_id, candidate)
        candidate["candidateId"] = f"candidate-{candidate['dedupeKey'][:16]}"
        derived.append(candidate)
    return derived


async def extract_memory_candidates(
    *,
    account_id: str,
    course_id: str,
    topic: str,
    messages: list[dict[str, Any]],
    memory_store: dict[str, Any],
    client: MiniMaxClient | None = None,
    now: int | None = None,
) -> list[dict[str, Any]]:
    if not should_extract_memory_candidates(messages):
        return []
    client = client or MiniMaxClient()
    transcript = [
        {
            "messageId": message.get("messageId"),
            "role": message.get("role"),
            "content": _normalize_text(message.get("content"), 600),
        }
        for message in messages[-10:]
        if message.get("content") and message.get("messageId")
    ]
    data_block = wrap_untrusted_context("memory_candidate_inputs", {
        "topic": topic,
        "knownMemory": _existing_memory(memory_store),
        "recentTranscript": transcript,
    })
    user_prompt = data_block + "\n\n请判断是否存在值得长期保留的候选 Memory，只输出规定 JSON。"
    response = await client.chat(
        messages=[
            {"role": "system", "content": get_prompt("memory_candidate", "system")},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=1200,
    )
    content = (response.get("choices") or [{}])[0].get("message", {}).get("content", "")
    try:
        parsed = parse_json_response(content)
    except Exception:
        print("[MemoryCandidate] JSON 解析失败，跳过本轮候选")
        return []
    raw_candidates = parsed.get("candidates") if isinstance(parsed, dict) else []
    if not isinstance(raw_candidates, list):
        return []
    validated = validate_candidates(
        raw_candidates,
        account_id=account_id,
        course_id=course_id,
        topic=topic,
        messages=messages,
        now=now,
    )
    repeated = derive_repeated_behavior_candidates(
        account_id=account_id,
        course_id=course_id,
        messages=messages,
        now=now,
    )
    by_id = {item["candidateId"]: item for item in [*validated, *repeated]}
    return list(by_id.values())
