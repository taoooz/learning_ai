"""Learning Summary：从 V4 Memory 派生可重建学习摘要。"""
from __future__ import annotations

import json
import re
from typing import Any

from lib.minimax import MiniMaxClient, parse_json_response
from prompts import get_prompt
from services.memory_v4_store import MemoryV4Store
from services.memory_context_v4 import wrap_untrusted_context

SUMMARY_VERSION = "learning-summary-v1"
MAX_RECORDS = 20
MAX_EPISODES = 8


def _text(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _source_context(store: dict[str, Any], evidence: list[dict[str, Any]]) -> tuple[str, list[str], list[str]]:
    records = [record for record in store.get("records", []) if record.get("status") == "active"]
    episodes = [record for record in records if record.get("kind") == "episode"]
    concept_states = (store.get("projections") or {}).get("conceptStates") or []
    record_ids = [record.get("memoryId") for record in records[:MAX_RECORDS] if record.get("memoryId")]
    evidence_ids = [
        item.get("evidenceId")
        for item in evidence[-20:]
        if item.get("evidenceId") and not item.get("invalidReason")
    ]
    lines = []
    if records:
        lines.append("## 长期 Memory")
        lines.extend(
            f"- {record.get('kind')} | {record.get('title')}：{record.get('summary')}"
            for record in records[:MAX_RECORDS]
        )
    if episodes:
        lines.append("## 章节与课程经验")
        lines.extend(
            f"- {record.get('title')}：{record.get('summary')}"
            for record in episodes[:MAX_EPISODES]
        )
    if concept_states:
        lines.append("## 概念状态（来自学习证据）")
        lines.extend(
            f"- {state.get('conceptName')}：{state.get('status')}，证据数 {state.get('evidenceCount', 0)}"
            for state in concept_states[:20]
        )
    return "\n".join(lines), record_ids, evidence_ids


def validate_summary(raw: dict[str, Any], *, record_ids: list[str], evidence_ids: list[str], ledger_revision: int) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    journey = _text(raw.get("journey"), 160)
    current_focus = _text(raw.get("currentFocus"), 120)
    if not journey or not current_focus:
        return None
    insights = [_text(item, 80) for item in (raw.get("learnerInsights") or []) if _text(item, 80)][:3]
    watch = [_text(item, 80) for item in (raw.get("areasToWatch") or []) if _text(item, 80)][:3]
    return {
        "journey": journey,
        "currentFocus": current_focus,
        "learnerInsights": insights,
        "areasToWatch": watch,
        "sourceRecordIds": record_ids,
        "sourceEvidenceIds": evidence_ids,
        "summaryVersion": SUMMARY_VERSION,
        "sourceLedgerRevision": ledger_revision,
        "generatedAt": int(__import__("time").time() * 1000),
    }


async def rebuild_learning_summary(
    store: MemoryV4Store,
    account_id: str,
    client: MiniMaxClient | None = None,
) -> dict[str, Any] | None:
    memory = store.load_store(account_id)
    evidence = store.load_evidence(account_id)
    context, record_ids, evidence_ids = _source_context(memory, evidence)
    if not context:
        return None
    existing = memory.get("learningSummary")
    existing_text = json.dumps(existing, ensure_ascii=False) if existing else "暂无"
    data_block = wrap_untrusted_context("learning_summary_sources", {
        "existingSummary": existing if existing else None,
        "memoryAndEvidence": context,
    })
    user_prompt = data_block + "\n\n请基于以上数据更新学习旅程摘要，只输出规定 JSON。"
    client = client or MiniMaxClient()
    response = await client.chat(
        messages=[
            {"role": "system", "content": get_prompt("memory_summary", "system")},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=900,
    )
    content = (response.get("choices") or [{}])[0].get("message", {}).get("content", "")
    try:
        raw = parse_json_response(content)
    except Exception:
        print("[MemorySummary] JSON 解析失败，保留旧摘要")
        return None
    ledger_revision = int((memory.get("projections") or {}).get("sourceLedgerRevision", len(evidence)))
    summary = validate_summary(
        raw,
        record_ids=record_ids,
        evidence_ids=evidence_ids,
        ledger_revision=ledger_revision,
    )
    if summary is None:
        return None
    updated = store.set_learning_summary(account_id, summary)
    summary["memoryRevision"] = updated.get("revision", 0)
    return summary
