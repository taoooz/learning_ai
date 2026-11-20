"""Chat 对话的服务端标准化与摘要构建。

前端只负责发送本轮消息；长期对话摘要只读取服务端 transcript、课程章节容器
和 Evidence ledger，不接受客户端提交的最终摘要正文。
"""
from __future__ import annotations

import hashlib
import re
import time
from typing import Any

from services.memory_v4_store import MemoryV4Store
from services.user_data_store import UserDataStore

_STYLE_CUES = {
    "分步骤": "分步骤解释",
    "分步": "分步骤解释",
    "举例": "例子驱动",
    "例子": "例子驱动",
    "类比": "类比解释",
    "比喻": "类比解释",
    "对比": "对比解释",
    "简单": "简洁解释",
    "通俗": "通俗解释",
}
_UNRESOLVED_CUES = ("不懂", "没理解", "不理解", "困惑", "什么意思", "为什么", "怎么")


def _safe_text(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _message_id(course_id: str, role: str, content: str, index: int, fallback: str) -> str:
    seed = f"{course_id}:{fallback}:{role}:{index}:{content}"
    return f"msg-{hashlib.sha256(seed.encode('utf-8')).hexdigest()[:20]}"


def _unresolved_fragment(content: str) -> str:
    text = _safe_text(content, 160).strip("。！？?! ")
    positions = [text.find(cue) for cue in _UNRESOLVED_CUES if cue in text]
    if not positions:
        return ""
    start = min(positions)
    fragment = text[start:]
    fragment = re.split(r"[。！？?!]", fragment, maxsplit=1)[0].strip()
    return fragment[:60]


def normalize_chat_messages(
    course_id: str,
    raw_messages: list[dict[str, Any]],
    *,
    turn_id: str = "",
    now: int | None = None,
) -> list[dict[str, Any]]:
    """给每条消息分配服务端可引用的 messageId，并丢弃非法角色/空内容。"""
    at = int(now if now is not None else time.time() * 1000)
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(raw_messages[-20:]):
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "")
        content = _safe_text(item.get("content"), 4000)
        if role not in {"user", "assistant"} or not content:
            continue
        provided_id = _safe_text(item.get("messageId") or item.get("id"), 128)
        fallback = turn_id if role == "user" and index == len(raw_messages[-20:]) - 1 else f"history-{index}"
        message_id = provided_id or _message_id(course_id, role, content, index, fallback)
        created_at = item.get("createdAt") or item.get("timestamp")
        normalized.append({
            "messageId": message_id,
            "role": role,
            "content": content,
            "createdAt": int(created_at) if isinstance(created_at, (int, float)) else at + index,
        })
    return normalized


def assistant_message_id(course_id: str, turn_id: str, content: str) -> str:
    seed = f"{course_id}:{turn_id}:assistant:{content[:200]}"
    return f"msg-{hashlib.sha256(seed.encode('utf-8')).hexdigest()[:20]}"


def _latest_lesson(account_id: str, course_id: str, course: dict[str, Any] | None) -> dict[str, Any] | None:
    chapters = ((course or {}).get("blueprint") or {}).get("chapters") or []
    lessons = [
        lesson
        for chapter in chapters
        if (lesson := UserDataStore().load_lesson(account_id, course_id, str(chapter.get("chapterId") or "")))
    ]
    return max(lessons, key=lambda item: int(item.get("updatedAt") or 0), default=None)


def build_server_chat_summary(store: MemoryV4Store, account_id: str, course_id: str) -> dict[str, Any] | None:
    transcript = store.load_chat_transcript(account_id, course_id)
    user_messages = [item for item in transcript if item.get("role") == "user"]
    if not user_messages:
        return None

    course = next(
        (item for item in UserDataStore().load_courses(account_id) if item.get("courseId") == course_id),
        None,
    )
    lesson = _latest_lesson(account_id, course_id, course)
    evidence = [
        item for item in store.load_evidence(account_id)
        if item.get("courseId") == course_id and not item.get("invalidReason")
    ][-8:]

    questions = [_safe_text(item.get("content"), 42).rstrip("。！？?!") for item in user_messages[-3:]]
    unresolved = []
    for item in user_messages:
        fragment = _unresolved_fragment(str(item.get("content") or ""))
        if fragment:
            unresolved.append(fragment)
    projections = store.load_store(account_id).get("projections") or {}
    unresolved.extend(
        str(state.get("conceptName") or state.get("conceptKey") or "")
        for state in projections.get("conceptStates") or []
        if state.get("status") in ("needs_review", "fragile")
    )
    unresolved = list(dict.fromkeys(unresolved))[:3]

    styles = list(dict.fromkeys(
        label
        for item in user_messages
        for cue, label in _STYLE_CUES.items()
        if cue in str(item.get("content") or "")
    ))[:3]

    explanation_path = None
    assistant_messages = [item for item in transcript if item.get("role") == "assistant"]
    if assistant_messages:
        latest = str(assistant_messages[-1].get("content") or "")
        if "例如" in latest or "比如" in latest or "例子" in latest:
            explanation_path = "例子驱动"
        elif "类比" in latest or "就像" in latest:
            explanation_path = "类比解释"
        else:
            explanation_path = "直接讲解"

    summary_parts = []
    if questions:
        summary_parts.append("讨论了：" + "、".join(questions))
    if lesson:
        plan = lesson.get("chapterPlan") or {}
        completed = [
            str(task.get("title") or "")
            for task in plan.get("tasks") or []
            if task.get("status") in ("completed", "skipped") and task.get("title")
        ]
        if completed:
            summary_parts.append("已完成：" + "、".join(completed[-2:]))
    if unresolved:
        summary_parts.append("待深入：" + "、".join(unresolved))
    summary_text = "。".join(summary_parts) or "进行了课程相关讨论"

    return {
        "courseId": course_id,
        "summary": summary_text[:240],
        "timestamp": int(time.time() * 1000),
        "mainQuestions": questions,
        "unresolvedConcepts": unresolved,
        "preferredExplanationStyles": styles,
        "explanationPath": explanation_path,
        "resolutionStatus": "open" if unresolved else "partial",
        "followUp": f"可继续探讨 {unresolved[0]}" if unresolved else None,
        "sourceRefs": [
            {
                "type": "user_message",
                "conversationId": f"course:{course_id}",
                "messageId": item.get("messageId"),
            }
            for item in user_messages[-5:]
            if item.get("messageId")
        ] + [
            {"type": "learning_evidence", "evidenceId": item.get("evidenceId")}
            for item in evidence[-5:]
            if item.get("evidenceId")
        ],
    }
