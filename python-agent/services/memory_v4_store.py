"""
Memory V4 服务端存储与聚合。

职责：
- account-scoped MemoryStore / Evidence / sealed Checkpoint 持久化
- UserProfile -> MemoryRecord 自动导入
- Checkpoint Evidence -> Concept/Topic/Review 投影
- 为现有课程生成与聊天 prompt 构建 V4 派生上下文

该模块不兼容旧 userMemoryV3，不做历史数据迁移。
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
from typing import Any

import fcntl

from services.user_data_store import OptimisticLockConflict

_DATA_ROOT = Path(__file__).parent.parent / "data" / "user_data"
_POLICY_VERSION = "memory-v4-p0"
_PROJECTION_VERSION = "projection-v4-p1"


class EvidenceIdempotencyConflict(Exception):
    """同一 idempotencyKey 对应了不同答案/证据内容。"""


class EvidenceAttemptOrderConflict(Exception):
    """Checkpoint Evidence attempt 不符合服务端顺序账本。"""

    def __init__(self, expected: int, received: int):
        self.expected = expected
        self.received = received
        super().__init__(f"attempt 必须按顺序写入：expected={expected}, received={received}")


class CourseMemoryDeleted(Exception):
    """课程已被删除，禁止继续写入该课程 Evidence 或 Episode。"""


def _now_ms(now: int | None = None) -> int:
    return int(now if now is not None else time.time() * 1000)


def _stable_id(prefix: str, key: str, length: int = 12) -> str:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:length]
    return f"{prefix}-{digest}"


def _safe_name(value: str) -> str:
    return "".join(c for c in value if c.isalnum() or c in "-_")[:160]


def _profile_hash(profile: dict[str, Any]) -> str:
    canonical = json.dumps(profile, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _as_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        parts = [
            str(value.get(key) or "").strip()
            for key in ("company", "position", "description", "school", "major", "summary")
        ]
        return "，".join(part for part in parts if part)
    if isinstance(value, (list, tuple)):
        return "，".join(_as_text(item) for item in value if _as_text(item))
    return str(value).strip() if value is not None else ""


def _account_locked(method):
    """为以 account_id 为首参的写方法加账户级跨进程锁。"""
    @wraps(method)
    def wrapper(self, account_id: str, *args, **kwargs):
        with self._account_lock(account_id):
            return method(self, account_id, *args, **kwargs)
    return wrapper


class MemoryV4Store:
    """服务端 Memory V4 权威存储。"""

    def __init__(self, data_root: Path | None = None):
        self._root = data_root if data_root is not None else _DATA_ROOT

    # ---- paths / IO ----

    def _account_dir(self, account_id: str) -> Path:
        return self._root / _safe_name(account_id)

    def _memory_dir(self, account_id: str) -> Path:
        return self._account_dir(account_id) / "memory"

    def _store_path(self, account_id: str) -> Path:
        return self._memory_dir(account_id) / "store.json"

    def _evidence_path(self, account_id: str) -> Path:
        return self._memory_dir(account_id) / "evidence.jsonl"

    def _remediation_path(self, account_id: str) -> Path:
        return self._memory_dir(account_id) / "remediation.jsonl"

    def _candidates_path(self, account_id: str) -> Path:
        return self._memory_dir(account_id) / "candidates.jsonl"

    def _chat_transcript_path(self, account_id: str, course_id: str) -> Path:
        return self._memory_dir(account_id) / "chat" / f"{_safe_name(course_id)}.jsonl"

    def _audit_path(self, account_id: str) -> Path:
        return self._memory_dir(account_id) / "audit.jsonl"

    def _chapter_recap_path(self, account_id: str, course_id: str, chapter_id: str) -> Path:
        safe_course = _safe_name(course_id)
        safe_chapter = _safe_name(chapter_id)
        return self._memory_dir(account_id) / "recaps" / f"{safe_course}__{safe_chapter}.json"

    def _profile_path(self, account_id: str) -> Path:
        return self._memory_dir(account_id) / "profile.json"

    def _checkpoint_path(self, account_id: str, checkpoint_id: str) -> Path:
        return self._memory_dir(account_id) / "checkpoints" / f"{_safe_name(checkpoint_id)}.json"

    @staticmethod
    def _atomic_write(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f"{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            tmp = Path(handle.name)
        os.replace(tmp, path)

    @contextmanager
    def _account_lock(self, account_id: str):
        lock_path = self._memory_dir(account_id) / ".lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
        except (json.JSONDecodeError, OSError):
            return None

    def _read_jsonl(self, path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        rows: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                item = json.loads(line)
                if isinstance(item, dict):
                    rows.append(item)
            except json.JSONDecodeError:
                continue
        return rows

    def _append_jsonl(self, path: Path, item: dict[str, Any]) -> None:
        rows = self._read_jsonl(path)
        rows.append(item)
        self._atomic_write(
            path,
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        )

    # ---- initial store ----

    def _empty_store(self, account_id: str, now: int) -> dict[str, Any]:
        return {
            "version": 4,
            "accountId": account_id,
            "revision": 0,
            "policyVersion": _POLICY_VERSION,
            "projectionVersion": _PROJECTION_VERSION,
            "records": [],
            "profileIngestions": [],
            "tombstones": [],
            "deletedCourses": [],
            "projections": {
                "version": 4,
                "accountId": account_id,
                "conceptStates": [],
                "topicStates": [],
                "reviewQueue": [],
                "projectionVersion": _PROJECTION_VERSION,
                "sourceLedgerRevision": 0,
                "dirty": False,
                "rebuiltAt": now,
            },
            "core": {
                "accountId": account_id,
                "goals": [],
                "constraints": [],
                "activePreferences": [],
                "riskConcepts": [],
                "reviewQueue": [],
                "sourceRecordIds": [],
                "sourceLedgerRevision": 0,
                "generatedAt": now,
            },
            "updatedAt": now,
        }

    def load_store(self, account_id: str) -> dict[str, Any]:
        now = _now_ms()
        path = self._store_path(account_id)
        stored = self._read_json(path)
        if stored and stored.get("version") == 4:
            stored.setdefault("records", [])
            stored.setdefault("profileIngestions", [])
            stored.setdefault("tombstones", [])
            stored.setdefault("deletedCourses", [])
            if (stored.get("projections") or {}).get("dirty"):
                # 写入 Evidence 后、保存投影前进程失败时，下一次读取自动自愈。
                try:
                    stored = self._rebuild_projections(
                        stored,
                        self.load_evidence(account_id),
                        self._read_jsonl(self._remediation_path(account_id)),
                    )
                    stored = self._rebuild_core(account_id, stored, now)
                    stored = self._save_without_reread(account_id, stored, now)
                except Exception as exc:  # noqa: BLE001 保留 dirty 状态，后续写入可继续重试
                    print(f"[MemoryV4Store] projection recovery failed: {exc}")
            return stored
        store = self._empty_store(account_id, now)
        self._atomic_write(path, json.dumps(store, ensure_ascii=False, indent=2))
        return store

    @_account_locked
    def save_store(
        self,
        account_id: str,
        store: dict[str, Any],
        expected_revision: int | None = None,
        *,
        increment: bool = True,
        now: int | None = None,
    ) -> dict[str, Any]:
        current = self.load_store(account_id)
        current_revision = int(current.get("revision", 0))
        if expected_revision is not None and expected_revision != current_revision:
            raise OptimisticLockConflict(current_revision)
        at = _now_ms(now)
        next_store = dict(store)
        next_store["accountId"] = account_id
        next_store["version"] = 4
        next_store["revision"] = current_revision + 1 if increment else current_revision
        next_store["updatedAt"] = at
        next_store.setdefault("policyVersion", _POLICY_VERSION)
        next_store.setdefault("projectionVersion", _PROJECTION_VERSION)
        self._atomic_write(self._store_path(account_id), json.dumps(next_store, ensure_ascii=False, indent=2))
        return next_store

    # ---- Profile ingestion ----

    def _profile_records(self, account_id: str, profile: dict[str, Any], profile_hash: str, profile_revision: int, now: int) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []

        def add_record(
            *,
            kind: str,
            scope: dict[str, Any],
            field_path: str,
            title: str,
            text: str,
            source_type: str,
            derivation: str,
            tags: list[str],
            importance: float,
            confidence: float,
        ) -> None:
            clean = text.strip()
            if not clean:
                return
            # 模型推断只允许低风险、可纠正的偏好/背景事实自动启用。
            # 目标与约束会改变教学方向，不能因一次模型推断直接影响课程规划。
            if source_type == "user_profile_inference":
                if kind not in {"fact", "preference"} or confidence < 0.7:
                    return
            dedupe_key = f"profile:{field_path}"
            records.append({
                "memoryId": _stable_id("mem-profile", dedupe_key),
                "accountId": account_id,
                "kind": kind,
                "scope": scope,
                "status": "active",
                "title": title,
                "summary": clean[:180],
                "content": clean[:1600],
                "tags": sorted(set(tags)),
                "conceptKeys": [],
                "sourceType": source_type,
                "sourceRefs": [{
                    "type": "user_profile",
                    "profileHash": profile_hash,
                    "profileRevision": profile_revision,
                    "fieldPath": field_path,
                    "derivation": derivation,
                    "promotionStatus": "auto_active" if source_type == "user_profile_inference" else "user_input",
                    "promotionReason": "低风险背景或偏好，且置信度达到自动启用阈值" if source_type == "user_profile_inference" else "用户直接填写",
                }],
                "evidenceIds": [],
                "dedupeKey": dedupe_key,
                "confidence": confidence,
                "importance": importance,
                "durability": "long_term",
                "sensitivity": "normal",
                "observedAt": now,
                "createdAt": now,
                "updatedAt": now,
                "version": 1,
                "createdBy": "rule",
                "supersedes": [],
                "conflictsWith": [],
            })

        target_job = _as_text(profile.get("targetJob"))
        if target_job:
            add_record(
                kind="goal", scope={"type": "user"}, field_path="targetJob",
                title="目标岗位", text=target_job,
                source_type="user_profile_input", derivation="user_input",
                tags=["profile", "goal", "targetJob"], importance=0.92, confidence=0.95,
            )

        for index, item in enumerate(profile.get("workExperience") or []):
            text = _as_text(item)
            add_record(
                kind="fact", scope={"type": "user"}, field_path=f"workExperience[{index}]",
                title="工作经历", text=text,
                source_type="user_profile_input", derivation="user_input",
                tags=["profile", "background", "work"], importance=0.7, confidence=0.9,
            )

        for index, item in enumerate(profile.get("education") or []):
            text = _as_text(item)
            add_record(
                kind="fact", scope={"type": "user"}, field_path=f"education[{index}]",
                title="教育经历", text=text,
                source_type="user_profile_input", derivation="user_input",
                tags=["profile", "background", "education"], importance=0.62, confidence=0.88,
            )

        insights = profile.get("insights") or {}
        inference_specs = [
            ("workSummary", "工作背景摘要", ["profile", "background", "work"], 0.78, 0.82),
            ("educationSummary", "教育背景摘要", ["profile", "background", "education"], 0.68, 0.8),
            ("analogyExperiences", "类比经历", ["profile", "analogy"], 0.74, 0.8),
        ]
        for field_name, title, tags, confidence, importance in inference_specs:
            values = insights.get(field_name) or []
            for index, item in enumerate(values):
                add_record(
                    kind="fact", scope={"type": "user"}, field_path=f"insights.{field_name}[{index}]",
                    title=title, text=_as_text(item),
                    source_type="user_profile_inference", derivation="model_inference",
                    tags=tags, importance=importance, confidence=confidence,
                )

        learning_style = _as_text(insights.get("learningStyle"))
        if learning_style:
            add_record(
                kind="preference", scope={"type": "user"}, field_path="insights.learningStyle",
                title="学习风格", text=learning_style,
                source_type="user_profile_inference", derivation="model_inference",
                tags=["profile", "preference", "explanation_style"],
                importance=0.76, confidence=0.74,
            )

        technical_level = _as_text(insights.get("technicalLevel"))
        if technical_level:
            add_record(
                kind="fact", scope={"type": "user"}, field_path="insights.technicalLevel",
                title="技术接受度", text=technical_level,
                source_type="user_profile_inference", derivation="model_inference",
                tags=["profile", "level", "technicalLevel"], importance=0.72, confidence=0.72,
            )

        for index, item in enumerate(insights.get("valuePriorities") or []):
            add_record(
                kind="constraint", scope={"type": "user"}, field_path=f"insights.valuePriorities[{index}]",
                title="价值关注点", text=_as_text(item),
                source_type="user_profile_inference", derivation="model_inference",
                tags=["profile", "constraint", "value"], importance=0.62, confidence=0.72,
            )

        summary = _as_text(insights.get("summary"))
        if summary:
            add_record(
                kind="fact", scope={"type": "user"}, field_path="insights.summary",
                title="背景总结", text=summary,
                source_type="user_profile_inference", derivation="model_inference",
                tags=["profile", "summary"], importance=0.55, confidence=0.78,
            )

        return records

    @_account_locked
    def ingest_profile(self, account_id: str, profile: dict[str, Any], now: int | None = None) -> dict[str, Any]:
        at = _now_ms(now)
        store = self.load_store(account_id)
        profile_hash = _profile_hash(profile)
        ingestions = store.get("profileIngestions", [])
        latest_ingestion = ingestions[-1] if ingestions else None
        if (
            latest_ingestion
            and latest_ingestion.get("status") == "active"
            and latest_ingestion.get("profileHash") == profile_hash
        ):
            return {"store": store, "changed": False, "ingestion": latest_ingestion}

        profile_revision = 1 + max([
            int(item.get("profileRevision", 0))
            for item in store.get("profileIngestions", [])
        ] or [0])
        imported = self._profile_records(account_id, profile, profile_hash, profile_revision, at)
        imported_by_key = {record["dedupeKey"]: record for record in imported}
        tombstoned_keys = {
            item.get("dedupeKey") for item in (store.get("tombstones") or [])
            if item.get("dedupeKey")
        }
        next_records = []
        superseded_ids = []
        seen_keys: set[str] = set()
        for record in store.get("records", []):
            refs = record.get("sourceRefs") or []
            is_profile = any(ref.get("type") == "user_profile" for ref in refs if isinstance(ref, dict))
            if not is_profile:
                next_records.append(record)
                continue
            key = record.get("dedupeKey")
            replacement = imported_by_key.get(key)
            if replacement is None or key in tombstoned_keys:
                if record.get("status") == "active":
                    record = dict(record)
                    record["status"] = "superseded"
                    record["updatedAt"] = at
                    superseded_ids.append(record.get("memoryId"))
                next_records.append(record)
                continue
            updated = dict(record)
            updated.update({
                "kind": replacement["kind"],
                "scope": replacement["scope"],
                "status": "active",
                "title": replacement["title"],
                "summary": replacement["summary"],
                "content": replacement["content"],
                "tags": replacement["tags"],
                "sourceType": replacement["sourceType"],
                "sourceRefs": replacement["sourceRefs"],
                "confidence": replacement["confidence"],
                "importance": replacement["importance"],
                "durability": replacement["durability"],
                "updatedAt": at,
                "version": int(record.get("version", 1)) + 1,
            })
            next_records.append(updated)
            seen_keys.add(key)

        for key, record in imported_by_key.items():
            if key in seen_keys or key in tombstoned_keys:
                continue
            next_records.append(record)
            seen_keys.add(key)

        ingestion = {
            "ingestionId": _stable_id("ingest", f"{account_id}:{profile_hash}:{profile_revision}"),
            "accountId": account_id,
            "profileHash": profile_hash,
            "profileRevision": profile_revision,
            "importedMemoryIds": [
                record["memoryId"] for key, record in imported_by_key.items()
                if key in seen_keys and key not in tombstoned_keys
            ],
            "supersededMemoryIds": [item for item in superseded_ids if item],
            "skippedFields": ["name"],
            "status": "active",
            "ingestedAt": at,
        }
        store["records"] = next_records
        store["profileIngestions"] = [*store.get("profileIngestions", []), ingestion]
        store = self._rebuild_core(account_id, store, at)
        self._atomic_write(self._profile_path(account_id), json.dumps(profile, ensure_ascii=False, indent=2))
        store = self._save_without_reread(account_id, store, at)
        return {"store": store, "changed": True, "ingestion": ingestion}

    def _save_without_reread(self, account_id: str, store: dict[str, Any], now: int) -> dict[str, Any]:
        next_store = dict(store)
        next_store["accountId"] = account_id
        next_store["revision"] = int(store.get("revision", 0)) + 1
        next_store["updatedAt"] = now
        self._atomic_write(self._store_path(account_id), json.dumps(next_store, ensure_ascii=False, indent=2))
        return next_store

    # ---- evidence / projections ----

    def load_evidence(self, account_id: str) -> list[dict[str, Any]]:
        return self._read_jsonl(self._evidence_path(account_id))

    @_account_locked
    def append_evidence(self, account_id: str, evidence: dict[str, Any]) -> dict[str, Any]:
        store = self.load_store(account_id)
        if evidence.get("courseId") in (store.get("deletedCourses") or []):
            raise CourseMemoryDeleted(str(evidence.get("courseId")))
        rows = self.load_evidence(account_id)
        for existing in rows:
            if existing.get("idempotencyKey") == evidence.get("idempotencyKey"):
                if existing.get("evidenceKey") != evidence.get("evidenceKey"):
                    raise EvidenceIdempotencyConflict(
                        f"幂等键已绑定其他答案（evidenceId={existing.get('evidenceId')}）"
                    )
                store = self.load_store(account_id)
                current_revision = int((store.get("projections") or {}).get("sourceLedgerRevision", -1))
                if current_revision < len(rows) or (store.get("projections") or {}).get("dirty"):
                    store = self._rebuild_projections(
                        store,
                        rows,
                        self._read_jsonl(self._remediation_path(account_id)),
                    )
                    store = self._rebuild_core(account_id, store, _now_ms())
                    store = self._save_without_reread(account_id, store, _now_ms())
                return {"evidence": existing, "store": store, "duplicate": True}
            if existing.get("evidenceKey") == evidence.get("evidenceKey"):
                raise EvidenceIdempotencyConflict(
                    f"evidenceKey 已绑定其他幂等请求（evidenceId={existing.get('evidenceId')}）"
                )
        checkpoint_id = evidence.get("checkpointId")
        if checkpoint_id and evidence.get("kind") not in ("self_report",):
            prior_attempts = [
                int(row.get("attempt") or 0)
                for row in rows
                if row.get("checkpointId") == checkpoint_id and not row.get("invalidReason")
            ]
            expected_attempt = max(prior_attempts, default=0) + 1
            received_attempt = int(evidence.get("attempt") or 0)
            if received_attempt != expected_attempt:
                raise EvidenceAttemptOrderConflict(expected_attempt, received_attempt)
        # 先落下 dirty 标记，再做 Evidence 与投影两次写入。任一步失败都可恢复。
        dirty_store = dict(store)
        projections = dict(store.get("projections") or {})
        projections["dirty"] = True
        dirty_store["projections"] = projections
        self._save_without_reread(account_id, dirty_store, _now_ms())
        self._append_jsonl(self._evidence_path(account_id), evidence)
        rows.append(evidence)
        store = self._rebuild_projections(
            store,
            rows,
            self._read_jsonl(self._remediation_path(account_id)),
        )
        store = self._rebuild_core(account_id, store, _now_ms())
        store = self._save_without_reread(account_id, store, _now_ms())
        return {"evidence": evidence, "store": store, "duplicate": False}

    # ---- Memory candidates / consolidation ----

    def load_candidates(self, account_id: str) -> list[dict[str, Any]]:
        return self._read_jsonl(self._candidates_path(account_id))

    @_account_locked
    def append_candidate(self, account_id: str, candidate: dict[str, Any]) -> dict[str, Any]:
        rows = self.load_candidates(account_id)
        existing = next(
            (row for row in rows if row.get("candidateId") == candidate.get("candidateId")),
            None,
        )
        if existing:
            return {"candidate": existing, "duplicate": True}
        self._append_jsonl(self._candidates_path(account_id), candidate)
        rows.append(candidate)
        return {"candidate": candidate, "duplicate": False, "pendingCount": len(rows)}

    def _audit(
        self,
        account_id: str,
        *,
        action: str,
        actor: str,
        reason: str,
        memory_id: str | None = None,
        candidate_id: str | None = None,
        at: int | None = None,
    ) -> None:
        self._append_jsonl(self._audit_path(account_id), {
            "auditId": _stable_id("audit", f"{account_id}:{action}:{memory_id or candidate_id}:{at or _now_ms()}"),
            "accountId": account_id,
            "action": action,
            "memoryId": memory_id,
            "candidateId": candidate_id,
            "actor": actor,
            "reason": reason,
            "sourceRefs": [],
            "at": at or _now_ms(),
        })

    @staticmethod
    def _is_tombstoned(store: dict[str, Any], dedupe_key: str) -> bool:
        return any(
            item.get("dedupeKey") == dedupe_key
            for item in (store.get("tombstones") or [])
        )

    def _record_from_candidate(self, candidate: dict[str, Any], at: int) -> dict[str, Any]:
        memory_id = _stable_id("mem", str(candidate.get("candidateId") or candidate.get("dedupeKey")))
        return {
            "memoryId": memory_id,
            "accountId": candidate.get("accountId"),
            "kind": candidate.get("kind"),
            "scope": candidate.get("scope"),
            "status": "active",
            "title": candidate.get("title"),
            "summary": candidate.get("summary"),
            "content": candidate.get("content"),
            "tags": candidate.get("tags") or [],
            "conceptKeys": candidate.get("conceptKeys") or [],
            "sourceType": candidate.get("sourceType"),
            "sourceRefs": candidate.get("sourceRefs") or [],
            "evidenceIds": candidate.get("evidenceIds") or [],
            "dedupeKey": candidate.get("dedupeKey"),
            "confidence": candidate.get("confidence", 0.7),
            "importance": candidate.get("importance", 0.5),
            "durability": candidate.get("durability", "long_term"),
            "sensitivity": candidate.get("sensitivity", "normal"),
            "observedAt": candidate.get("createdAt", at),
            "createdAt": at,
            "updatedAt": at,
            "version": 1,
            "createdBy": "rule",
            "supersedes": [],
            "conflictsWith": [],
        }

    def _merge_candidate_into_record(
        self,
        record: dict[str, Any],
        candidate: dict[str, Any],
        at: int,
    ) -> None:
        def merge_list(existing_values: Any, next_values: Any) -> list:
            merged = list(existing_values or [])
            for value in (next_values or []):
                if value not in merged:
                    merged.append(value)
            return merged

        def source_key(ref: Any) -> str:
            return json.dumps(ref, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

        existing_refs = list(record.get("sourceRefs") or [])
        seen_refs = {source_key(ref) for ref in existing_refs}
        for ref in (candidate.get("sourceRefs") or []):
            if source_key(ref) not in seen_refs:
                existing_refs.append(ref)
                seen_refs.add(source_key(ref))
        record["sourceRefs"] = existing_refs
        record["evidenceIds"] = merge_list(record.get("evidenceIds"), candidate.get("evidenceIds"))
        record["tags"] = merge_list(record.get("tags"), candidate.get("tags"))
        record["conceptKeys"] = merge_list(record.get("conceptKeys"), candidate.get("conceptKeys"))
        record["confidence"] = max(float(record.get("confidence", 0)), float(candidate.get("confidence", 0)))
        record["importance"] = max(float(record.get("importance", 0)), float(candidate.get("importance", 0)))
        record["updatedAt"] = at
        record["version"] = int(record.get("version", 1)) + 1
        if (
            candidate.get("sourceType") == "explicit_user_statement"
            or candidate.get("kind") == "teaching_strategy"
        ):
            for field in ("title", "summary", "content"):
                if candidate.get(field):
                    record[field] = candidate[field]

    @_account_locked
    def consolidate_candidates(self, account_id: str) -> dict[str, Any]:
        at = _now_ms()
        store = self.load_store(account_id)
        candidates = self.load_candidates(account_id)
        remediation = self._read_jsonl(self._remediation_path(account_id))
        evidence_by_id = {row.get("evidenceId"): row for row in self.load_evidence(account_id)}
        existing_candidate_ids = {row.get("candidateId") for row in candidates}
        # teaching_strategy 只能由服务端在 Remediation 前后 Evidence 都存在时派生。
        validated_remediations = []
        for remediation_row in remediation:
            before_id = remediation_row.get("beforeEvidenceId")
            after_id = remediation_row.get("afterEvidenceId")
            if not before_id or not after_id or remediation_row.get("outcome") not in ("helped", "partially_helped"):
                continue
            validated_remediations.append(remediation_row)

        strategy_groups: dict[str, list[dict[str, Any]]] = {}
        for remediation_row in validated_remediations:
            strategy_key = str(remediation_row.get("strategyKey") or remediation_row.get("remediationId") or "").strip()
            if not strategy_key:
                continue
            strategy_groups.setdefault(strategy_key, []).append(remediation_row)

        for strategy_key, group in strategy_groups.items():
            concept_keys: list[str] = []
            evidence_ids: list[str] = []
            source_refs: list[dict[str, Any]] = []
            outcomes: list[str] = []
            for remediation_row in group:
                before_id = str(remediation_row["beforeEvidenceId"])
                after_id = str(remediation_row["afterEvidenceId"])
                before = evidence_by_id.get(before_id) or {}
                after = evidence_by_id.get(after_id) or {}
                for concept_key in [*(before.get("conceptKeys") or []), *(after.get("conceptKeys") or [])]:
                    if concept_key not in concept_keys:
                        concept_keys.append(concept_key)
                for evidence_id in (before_id, after_id):
                    if evidence_id not in evidence_ids:
                        evidence_ids.append(evidence_id)
                        source_refs.append({"type": "learning_evidence", "evidenceId": evidence_id})
                outcomes.append(str(remediation_row.get("outcome")))
            candidate_id = _stable_id(
                "candidate",
                f"strategy:{strategy_key}:{json.dumps(source_refs, ensure_ascii=False, sort_keys=True)}",
            )
            if candidate_id in existing_candidate_ids:
                continue
            scope = {"type": "user"}
            content = (
                f"补救策略「{strategy_key}」在概念"
                f"「{'、'.join(concept_keys) or '当前目标'}」上已验证有效。"
            )
            candidate = {
                "candidateId": candidate_id,
                "accountId": account_id,
                "kind": "teaching_strategy",
                "scope": scope,
                "title": "已验证的补救策略",
                "summary": content,
                "content": content,
                "tags": ["remediation", "teaching_strategy"],
                "conceptKeys": concept_keys,
                "sourceType": "learning_evidence",
                "sourceRefs": source_refs,
                "evidenceIds": evidence_ids,
                "confidence": 0.88 if "helped" in outcomes else 0.75,
                "importance": 0.7,
                "durability": "long_term",
                "sensitivity": "normal",
                "suggestedAction": "add",
                "dedupeKey": _stable_id("strategy-key", strategy_key),
                "extractionVersion": "remediation-evidence-v1",
                "createdAt": at,
                "status": "pending",
            }
            candidates.append(candidate)
            existing_candidate_ids.add(candidate_id)
        records = list(store.get("records") or [])
        applied = 0
        rejected = 0
        kept_pending = 0
        for candidate in candidates:
            if candidate.get("status") != "pending":
                continue
            if candidate.get("kind") == "teaching_strategy":
                evidence_ids = set(candidate.get("evidenceIds") or [])
                verified = any(
                    item.get("beforeEvidenceId") in evidence_ids
                    and item.get("afterEvidenceId") in evidence_ids
                    and item.get("outcome") in ("helped", "partially_helped")
                    for item in remediation
                )
                if candidate.get("sourceType") != "learning_evidence" or not verified:
                    candidate["status"] = "rejected"
                    candidate["rejectionReason"] = "missing_remediation_evidence"
                    rejected += 1
                    self._audit(
                        account_id,
                        action="candidate_rejected",
                        actor="rule",
                        reason="missing_remediation_evidence",
                        candidate_id=candidate.get("candidateId"),
                        at=at,
                    )
                    continue
            tombstoned = any(
                item.get("dedupeKey") == candidate.get("dedupeKey")
                for item in (store.get("tombstones") or [])
            )
            if tombstoned:
                candidate["status"] = "rejected"
                candidate["rejectionReason"] = "tombstoned_by_user"
                rejected += 1
                self._audit(
                    account_id,
                    action="candidate_rejected",
                    actor="rule",
                    reason="tombstoned_by_user",
                    candidate_id=candidate.get("candidateId"),
                    at=at,
                )
                continue
            threshold = 0.8 if candidate.get("sourceType") == "repeated_behavior" else 0.7
            if candidate.get("suggestedAction") == "ignore" or float(candidate.get("confidence", 0)) < threshold:
                if candidate.get("suggestedAction") == "ignore":
                    candidate["status"] = "rejected"
                    candidate["rejectionReason"] = "policy_ignore"
                    rejected += 1
                    self._audit(account_id, action="candidate_rejected", actor="rule",
                                reason="policy_ignore", candidate_id=candidate.get("candidateId"), at=at)
                else:
                    kept_pending += 1
                continue

            existing = None
            target_id = candidate.get("targetMemoryId")
            if target_id:
                existing = next((record for record in records if record.get("memoryId") == target_id), None)
            if existing is None:
                existing = next(
                    (record for record in records
                     if record.get("status") == "active" and record.get("dedupeKey") == candidate.get("dedupeKey")),
                    None,
                )
            if existing and existing.get("status") == "active" and candidate.get("suggestedAction") == "add":
                self._merge_candidate_into_record(existing, candidate, at)
                candidate["status"] = "applied"
                candidate["targetMemoryId"] = existing.get("memoryId")
                applied += 1
                self._audit(
                    account_id,
                    action="record_merged",
                    actor="rule",
                    reason="candidate_merged_by_semantic_key",
                    memory_id=existing.get("memoryId"),
                    candidate_id=candidate.get("candidateId"),
                    at=at,
                )
                continue
            if existing and candidate.get("suggestedAction") in ("update", "supersede"):
                existing["status"] = "superseded"
                existing["updatedAt"] = at
            new_record = self._record_from_candidate(candidate, at)
            if existing:
                new_record["supersedes"] = [existing.get("memoryId")]
            records.append(new_record)
            candidate["status"] = "applied"
            candidate["targetMemoryId"] = new_record["memoryId"]
            applied += 1
            self._audit(
                account_id,
                action="record_created",
                actor="rule",
                reason="candidate_consolidated",
                memory_id=new_record["memoryId"],
                candidate_id=candidate.get("candidateId"),
                at=at,
            )

        store["records"] = records
        store = self._rebuild_core(account_id, store, at)
        store = self._save_without_reread(account_id, store, at)
        self._atomic_write(
            self._candidates_path(account_id),
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in candidates),
        )
        return {
            "store": store,
            "applied": applied,
            "rejected": rejected,
            "pending": kept_pending,
        }

    def _rebuild_projections(
        self,
        store: dict[str, Any],
        evidence: list[dict[str, Any]],
        remediation: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        by_concept: dict[str, list[dict[str, Any]]] = {}
        for item in evidence:
            if item.get("invalidReason"):
                continue
            if item.get("outcome") == "skipped":
                continue
            for concept_key in item.get("conceptKeys") or [item.get("objectiveId")]:
                if concept_key:
                    by_concept.setdefault(str(concept_key), []).append(item)

        states: list[dict[str, Any]] = []
        remediation_rows = remediation or []
        for concept_key, rows in by_concept.items():
            ordered = sorted(
                rows,
                key=lambda row: (int(row.get("createdAt", 0)), int(row.get("attempt", 0))),
            )
            latest = ordered[-1]
            outcome = latest.get("outcome")
            if outcome == "demonstrated":
                status = "demonstrated"
            elif outcome == "partial":
                status = "fragile"
            elif outcome == "not_demonstrated":
                status = "needs_review"
            else:
                status = "developing"
            strong_count = sum(1 for row in ordered if row.get("strength") == "strong")
            topic = str(latest.get("topic") or "未分类")
            misconceptions = []
            for code in latest.get("misconceptionCodes") or []:
                misconceptions.append({
                    "code": str(code),
                    "statement": str(code),
                    "evidenceIds": [latest.get("evidenceId")],
                    "occurrenceCount": 1,
                    "lastObservedAt": latest.get("createdAt", 0),
                })
            next_review = int(latest.get("createdAt", 0)) + ({
                "demonstrated": 7,
                "partial": 3,
                "not_demonstrated": 1,
            }.get(outcome, 1) * 24 * 60 * 60 * 1000)
            strategy_groups: dict[tuple[str, str], dict[str, Any]] = {}
            for record in remediation_rows:
                if concept_key not in (record.get("conceptKeys") or []):
                    continue
                if record.get("outcome") not in ("helped", "partially_helped"):
                    continue
                key = (str(record.get("strategyKey") or ""), str(record.get("strategyVersion") or ""))
                group = strategy_groups.setdefault(key, {
                    "strategyKey": key[0],
                    "strategyVersion": key[1],
                    "successCount": 0,
                    "partialCount": 0,
                    "failureCount": 0,
                    "lastVerifiedAt": None,
                    "evidenceIds": [],
                })
                if record.get("outcome") == "helped":
                    group["successCount"] += 1
                else:
                    group["partialCount"] += 1
                group["lastVerifiedAt"] = max(group["lastVerifiedAt"] or 0, int(record.get("createdAt", 0)))
                if record.get("afterEvidenceId"):
                    group["evidenceIds"].append(record.get("afterEvidenceId"))
            state = {
                "conceptKey": concept_key,
                "conceptName": concept_key,
                "topic": topic,
                "aliases": [],
                "status": status,
                "evidenceCount": len(ordered),
                "strongEvidenceCount": strong_count,
                "recentEvidenceIds": [row.get("evidenceId") for row in ordered[-3:] if row.get("evidenceId")],
                "misconceptions": misconceptions[-3:],
                "effectiveRemediationStrategies": list(strategy_groups.values()),
                "lastAssessedAt": latest.get("createdAt", 0),
                "lastDemonstratedAt": latest.get("createdAt") if outcome == "demonstrated" else None,
                "nextReviewAt": next_review,
                "confidence": float(latest.get("confidence", 0.7)),
                "updatedAt": latest.get("createdAt", 0),
            }
            states.append(state)

        topics: dict[str, list[dict[str, Any]]] = {}
        for state in states:
            topics.setdefault(state["topic"], []).append(state)
        topic_states = []
        review_queue = []
        for topic, topic_concepts in topics.items():
            demonstrated = [state["conceptKey"] for state in topic_concepts if state["status"] == "demonstrated"]
            review = [state["conceptKey"] for state in topic_concepts if state["status"] in ("needs_review", "fragile")]
            risk = list(review)
            topic_states.append({
                "topic": topic,
                "conceptKeys": [state["conceptKey"] for state in topic_concepts],
                "demonstratedConceptKeys": demonstrated,
                "reviewConceptKeys": review,
                "riskConceptKeys": risk,
                "confidence": round(sum(state["confidence"] for state in topic_concepts) / max(1, len(topic_concepts)), 2),
                "updatedAt": max(state["updatedAt"] for state in topic_concepts),
            })
            for state in topic_concepts:
                if state["status"] in ("needs_review", "fragile"):
                    review_queue.append({
                        "conceptKey": state["conceptKey"],
                        "conceptName": state["conceptName"],
                        "topic": state["topic"],
                        "reason": "needs_review" if state["status"] == "needs_review" else "fragile",
                        "priority": "high" if state["status"] == "needs_review" else "medium",
                        "dueAt": state.get("nextReviewAt", 0),
                        "sourceEvidenceIds": state.get("recentEvidenceIds", []),
                    })

        projections = {
            "version": 4,
            "accountId": store.get("accountId"),
            "conceptStates": states,
            "topicStates": topic_states,
            "reviewQueue": review_queue,
            "projectionVersion": _PROJECTION_VERSION,
            "sourceLedgerRevision": len(evidence),
            "dirty": False,
            "rebuiltAt": _now_ms(),
        }
        next_store = dict(store)
        next_store["projections"] = projections
        return next_store

    def _rebuild_core(self, account_id: str, store: dict[str, Any], now: int) -> dict[str, Any]:
        records = [record for record in store.get("records", []) if record.get("status") == "active"]

        def items(kind: str) -> list[dict[str, Any]]:
            return [{
                "text": record.get("content", ""),
                "sourceRecordIds": [record.get("memoryId")],
                "confidence": record.get("confidence", 0.7),
            } for record in records if record.get("kind") == kind]

        projections = store.get("projections") or {}
        concept_states = projections.get("conceptStates") or []
        risk = [{
            "conceptKey": state.get("conceptKey"),
            "conceptName": state.get("conceptName"),
            "reason": "近期未证明或表现脆弱",
            "sourceRecordIds": [],
            "sourceEvidenceIds": state.get("recentEvidenceIds") or [],
        } for state in concept_states if state.get("status") in ("needs_review", "fragile")]
        goal_items = items("goal")
        preference_items = items("preference")
        core = {
            "accountId": account_id,
            "goals": goal_items,
            "constraints": items("constraint"),
            "activePreferences": preference_items,
            "currentFocus": goal_items[0] if goal_items else None,
            "riskConcepts": risk[:5],
            "reviewQueue": (projections.get("reviewQueue") or [])[:10],
            "sourceRecordIds": [record.get("memoryId") for record in records],
            "sourceLedgerRevision": int(projections.get("sourceLedgerRevision", 0)),
            "generatedAt": now,
        }
        next_store = dict(store)
        next_store["core"] = core
        return next_store

    # ---- checkpoint sealing ----

    @_account_locked
    def save_checkpoint_definition(self, account_id: str, definition: dict[str, Any], meta: dict[str, Any]) -> None:
        checkpoint_id = str(definition.get("checkpointId") or "")
        if not checkpoint_id:
            raise ValueError("checkpointId 不能为空")
        store = self.load_store(account_id)
        if meta.get("courseId") in (store.get("deletedCourses") or []):
            raise CourseMemoryDeleted(str(meta.get("courseId")))
        payload = {"definition": definition, "meta": meta, "sealedAt": _now_ms()}
        self._atomic_write(self._checkpoint_path(account_id, checkpoint_id), json.dumps(payload, ensure_ascii=False, indent=2))

    @_account_locked
    def save_chapter_recap_snapshot(
        self,
        account_id: str,
        *,
        course_id: str,
        chapter_id: str,
        topic: str,
        chapter_title: str,
        teaching_goal: str,
        recap: dict[str, Any],
    ) -> None:
        store = self.load_store(account_id)
        if course_id in (store.get("deletedCourses") or []):
            raise CourseMemoryDeleted(course_id)
        payload = {
            "courseId": course_id,
            "chapterId": chapter_id,
            "topic": topic,
            "chapterTitle": chapter_title,
            "teachingGoal": teaching_goal,
            "recap": recap,
            "savedAt": _now_ms(),
        }
        self._atomic_write(
            self._chapter_recap_path(account_id, course_id, chapter_id),
            json.dumps(payload, ensure_ascii=False, indent=2),
        )

    def load_chapter_recap_snapshot(self, account_id: str, course_id: str, chapter_id: str) -> dict[str, Any] | None:
        return self._read_json(self._chapter_recap_path(account_id, course_id, chapter_id))

    def load_checkpoint(self, account_id: str, checkpoint_id: str) -> dict[str, Any] | None:
        return self._read_json(self._checkpoint_path(account_id, checkpoint_id))

    def latest_evidence_for_checkpoint(self, account_id: str, checkpoint_id: str) -> dict[str, Any] | None:
        rows = [
            row for row in self.load_evidence(account_id)
            if row.get("checkpointId") == checkpoint_id and not row.get("invalidReason")
        ]
        return sorted(rows, key=lambda row: (row.get("createdAt", 0), row.get("attempt", 0)))[-1] if rows else None

    def next_remediation_round(self, account_id: str, checkpoint_id: str) -> int:
        rounds = [
            int(row.get("round") or 0)
            for row in self._read_jsonl(self._remediation_path(account_id))
            if row.get("originCheckpointId") == checkpoint_id
            or str(row.get("remediationId") or "").startswith(f"rem-{checkpoint_id}-r")
        ]
        return max(rounds, default=0) + 1

    def remediation_chain_depth(self, account_id: str, checkpoint_id: str) -> int:
        """沿 previousCheckpointId 链统计已发生的补救轮数（含当前题）。

        补救会生成新题（cp-1 → cp-1-r1 → cp-1-r1-r1），每轮请求的 checkpointId 不同；
        只按单个 checkpointId 计数无法封顶整条链，必须回溯到根题统计。
        """
        chain = {checkpoint_id}
        sealed = self.load_checkpoint(account_id, checkpoint_id)
        prev = ((sealed or {}).get("meta") or {}).get("previousCheckpointId")
        while prev and prev not in chain and len(chain) < 32:
            chain.add(prev)
            prev_sealed = self.load_checkpoint(account_id, prev)
            prev = ((prev_sealed or {}).get("meta") or {}).get("previousCheckpointId")
        return sum(
            1
            for row in self._read_jsonl(self._remediation_path(account_id))
            if row.get("originCheckpointId") in chain
        )

    def append_remediation(self, account_id: str, record: dict[str, Any]) -> None:
        self._append_jsonl(self._remediation_path(account_id), record)

    def update_remediation_after_evidence(
        self,
        account_id: str,
        remediation_id: str,
        after_evidence_id: str,
        outcome: str,
    ) -> None:
        rows = self._read_jsonl(self._remediation_path(account_id))
        matched = False
        for row in rows:
            if row.get("remediationId") == remediation_id:
                row["afterEvidenceId"] = after_evidence_id
                row["outcome"] = outcome
                matched = True
        if matched:
            self._atomic_write(
                self._remediation_path(account_id),
                "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            )
            store = self.load_store(account_id)
            store = self._rebuild_projections(store, self.load_evidence(account_id), rows)
            store = self._rebuild_core(account_id, store, _now_ms())
            self._save_without_reread(account_id, store, _now_ms())

    @staticmethod
    def sanitize_checkpoint_definition(definition: dict[str, Any]) -> dict[str, Any]:
        sanitized = dict(definition)
        sanitized.pop("correctAnswer", None)
        return sanitized

    # ---- profile / prompt views ----

    def load_profile(self, account_id: str) -> dict[str, Any] | None:
        return self._read_json(self._profile_path(account_id))

    def build_prompt_profile(
        self,
        account_id: str,
        records: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """构建 Prompt profile；调用方可传入 Resolver 已选记录。

        未传 records 时只允许 user-scoped active 记录，避免 legacy 调用把
        course/topic 正文重新带进课程规划。
        """
        store = self.load_store(account_id)
        source = records if records is not None else store.get("records", [])
        active = [
            record for record in source
            if record.get("status") == "active"
            and (record.get("scope") or {}).get("type") == "user"
        ]
        def with_tag(tag: str) -> list[str]:
            return [record.get("content", "") for record in active if tag in (record.get("tags") or [])]

        target_jobs = with_tag("targetJob")
        learning_styles = [record.get("content") for record in active if "explanation_style" in (record.get("tags") or [])]
        technical_levels = with_tag("technicalLevel")
        values = with_tag("value")
        summaries = with_tag("summary")
        return {
            "targetJob": target_jobs[0] if target_jobs else "",
            "insights": {
                "workSummary": with_tag("work"),
                "educationSummary": with_tag("education"),
                "analogyExperiences": with_tag("analogy"),
                "learningStyle": learning_styles[0] if learning_styles else "",
                "technicalLevel": technical_levels[0] if technical_levels else "",
                "valuePriorities": values,
                "summary": summaries[0] if summaries else "",
            },
        }

    def build_planning_context(self, account_id: str, topic: str) -> dict[str, Any]:
        store = self.load_store(account_id)
        projections = store.get("projections") or {}
        topic_state = next(
            (state for state in projections.get("topicStates", []) if state.get("topic") == topic),
            None,
        )
        concept_states = projections.get("conceptStates") or []
        must_cover = []
        skippable = []
        risk = []
        if topic_state:
            concept_by_key = {state.get("conceptKey"): state for state in concept_states}
            must_cover = [
                concept_by_key[key].get("conceptName")
                for key in topic_state.get("reviewConceptKeys", [])
                if key in concept_by_key
            ]
            skippable = [
                concept_by_key[key].get("conceptName")
                for key in topic_state.get("demonstratedConceptKeys", [])
                if key in concept_by_key
            ]
            risk = [
                concept_by_key[key].get("conceptName")
                for key in topic_state.get("riskConceptKeys", [])
                if key in concept_by_key
            ]
        profile = self.build_prompt_profile(account_id)
        active = [record for record in store.get("records", []) if record.get("status") == "active"]
        background = [
            record.get("content", "") for record in active
            if any(tag in (record.get("tags") or []) for tag in ("background", "analogy"))
        ][:4]
        episodes = [
            record for record in active
            if record.get("kind") == "episode" and record.get("scope", {}).get("type") == "course"
        ]
        recent = [
            {"topic": record.get("title", ""), "summary": record.get("summary", "")}
            for record in sorted(episodes, key=lambda r: r.get("updatedAt", 0), reverse=True)[:3]
        ]
        level = "novice"
        if topic_state:
            demonstrated = len(topic_state.get("demonstratedConceptKeys", []))
            total = max(1, len(topic_state.get("conceptKeys", [])))
            ratio = demonstrated / total
            if ratio >= 0.7:
                level = "advanced"
            elif ratio >= 0.35:
                level = "intermediate"
            elif topic_state.get("conceptKeys"):
                level = "beginner"
        return {
            "userProfile": profile,
            "planningMemory": {
                "learnerSnapshot": {
                    "targetGoal": profile.get("targetJob") or "",
                    "estimatedLevel": level,
                    "confidence": topic_state.get("confidence", 0.35) if topic_state else 0.35,
                },
                "transferableBackground": background,
                "mustCoverConcepts": [item for item in must_cover if item][:3],
                "skippableBasics": [item for item in skippable if item][:2],
                "riskConcepts": [item for item in risk if item][:3],
                "recentRelevantCourses": recent,
            },
        }

    def build_chat_context(self, account_id: str, topic: str, focus: str = "", course_id: str | None = None) -> dict[str, Any]:
        store = self.load_store(account_id)
        projections = store.get("projections") or {}
        states = projections.get("conceptStates") or []
        query = (focus or topic).lower()
        relevant = []
        for state in states:
            name = str(state.get("conceptName") or "")
            if state.get("topic") == topic or name and (name.lower() in query or query in name.lower()):
                relevant.append(state)
        relevant = sorted(relevant, key=lambda item: item.get("updatedAt", 0), reverse=True)[:3]
        risk = []
        for state in states:
            if state.get("topic") == topic and state.get("status") in ("needs_review", "fragile"):
                risk.append(state.get("conceptName"))
        active = [record for record in store.get("records", []) if record.get("status") == "active"]
        analogies = [record.get("content", "") for record in active if "analogy" in (record.get("tags") or [])][:3]
        styles = [record.get("content", "") for record in active if "explanation_style" in (record.get("tags") or [])][:3]
        episodes = [
            record for record in active
            if record.get("kind") == "episode"
            and (
                not course_id
                or (record.get("scope") or {}).get("courseId") == course_id
            )
        ]
        topic_summary = episodes[0].get("summary") if episodes else "暂无"
        return {
            "topic": topic,
            "focusConceptStates": [{
                "concept": state.get("conceptName"),
                "status": state.get("status"),
                "masteryScore": 0.8 if state.get("status") == "demonstrated" else 0.5 if state.get("status") == "fragile" else 0.3,
                "misconceptionHints": [item.get("statement") for item in state.get("misconceptions", [])][:2],
            } for state in relevant],
            "riskConcepts": [item for item in risk if item][:3],
            "analogyHints": analogies,
            "preferredExplanationStyles": styles,
            "topicSummary": topic_summary,
        }

    # ---- chat summary ----

    @_account_locked
    def upsert_chat_summary(self, account_id: str, course_id: str, summary: dict[str, Any], now: int | None = None) -> dict[str, Any]:
        at = _now_ms(now)
        store = self.load_store(account_id)
        dedupe_key = f"chat-summary:{course_id}"
        if self._is_tombstoned(store, dedupe_key):
            return {"store": store, "summary": None}
        existing = next((r for r in store.get("records", []) if r.get("dedupeKey") == dedupe_key and r.get("status") == "active"), None)
        record = {
            "memoryId": _stable_id("mem-chat", dedupe_key),
            "accountId": account_id,
            "kind": "episode",
            "scope": {"type": "course", "courseId": course_id},
            "status": "active",
            "title": "课程对话摘要",
            "summary": str(summary.get("summary") or "")[:240],
            "content": str(summary.get("summary") or "")[:2000],
            "tags": ["chat_summary", *(summary.get("preferredExplanationStyles") or [])],
            "conceptKeys": summary.get("unresolvedConcepts") or [],
            "sourceType": "system_rule",
            "sourceRefs": summary.get("sourceRefs") or [{"type": "system_rule", "ruleId": "chat-summary-v4"}],
            "evidenceIds": [],
            "dedupeKey": dedupe_key,
            "confidence": 0.72,
            "importance": 0.55,
            "durability": "course",
            "sensitivity": "normal",
            "observedAt": at,
            "createdAt": existing.get("createdAt", at) if existing else at,
            "updatedAt": at,
            "version": int(existing.get("version", 0)) + 1 if existing else 1,
            "createdBy": "rule",
            "supersedes": [],
            "conflictsWith": [],
        }
        records = [r for r in store.get("records", []) if r.get("dedupeKey") != dedupe_key]
        records.append(record)
        store["records"] = records
        store = self._rebuild_core(account_id, store, at)
        store = self._save_without_reread(account_id, store, at)
        return {"store": store, "summary": record}

    @_account_locked
    def upsert_chapter_episode(
        self,
        account_id: str,
        *,
        course_id: str,
        chapter_id: str,
        topic: str,
        chapter_title: str,
        teaching_goal: str,
        recap: dict[str, Any],
        now: int | None = None,
    ) -> dict[str, Any]:
        at = _now_ms(now)
        store = self.load_store(account_id)
        dedupe_key = f"episode:course:{course_id}:chapter:{chapter_id}"
        if self._is_tombstoned(store, dedupe_key):
            return {"store": store, "episode": None}
        evidence = [
            row for row in self.load_evidence(account_id)
            if row.get("courseId") == course_id and row.get("chapterId") == chapter_id
        ]
        concept_keys = list(dict.fromkeys(
            key for row in evidence for key in (row.get("conceptKeys") or [])
        ))
        takeaways = [str(item).strip() for item in (recap.get("keyTakeaways") or []) if str(item).strip()]
        demonstrated = [str(item) for item in (recap.get("demonstratedObjectives") or []) if str(item)]
        fragile = [str(item) for item in (recap.get("fragileObjectives") or []) if str(item)]
        review = str(recap.get("recommendedReview") or "").strip()
        content_parts = [
            f"章节：{chapter_title}",
            f"目标：{teaching_goal}",
            *([f"要点：{item}" for item in takeaways[:5]]),
            *([f"已证明目标：{', '.join(demonstrated[:3])}"] if demonstrated else []),
            *([f"脆弱目标：{', '.join(fragile[:3])}"] if fragile else []),
            *([f"复习建议：{review}"] if review else []),
        ]
        content = "\n".join(content_parts)[:2400]
        summary = "；".join(takeaways[:3]) or review or f"完成了「{chapter_title}」"
        existing = next(
            (row for row in store.get("records", []) if row.get("dedupeKey") == dedupe_key and row.get("status") == "active"),
            None,
        )
        record = {
            "memoryId": existing.get("memoryId") if existing else _stable_id("mem-episode", dedupe_key),
            "accountId": account_id,
            "kind": "episode",
            "scope": {"type": "course", "courseId": course_id},
            "status": "active",
            "title": f"章节经验：{chapter_title}",
            "summary": summary[:240],
            "content": content,
            "tags": ["episode", "chapter_recap", topic],
            "conceptKeys": concept_keys,
            "sourceType": "system_rule",
            "sourceRefs": [{
                "type": "chapter_recap",
                "courseId": course_id,
                "chapterId": chapter_id,
            }],
            "evidenceIds": [row.get("evidenceId") for row in evidence if row.get("evidenceId")],
            "dedupeKey": dedupe_key,
            "confidence": 0.85,
            "importance": 0.7,
            "durability": "course",
            "sensitivity": "normal",
            "observedAt": at,
            "createdAt": existing.get("createdAt", at) if existing else at,
            "updatedAt": at,
            "version": int(existing.get("version", 0)) + 1 if existing else 1,
            "createdBy": "rule",
            "supersedes": [],
            "conflictsWith": [],
        }
        records = [row for row in store.get("records", []) if row.get("dedupeKey") != dedupe_key]
        records.append(record)
        store["records"] = records
        store = self._rebuild_core(account_id, store, at)
        store = self._save_without_reread(account_id, store, at)
        self._audit(
            account_id,
            action="record_created" if not existing else "record_updated",
            actor="rule",
            reason="chapter_recap_projection",
            memory_id=record["memoryId"],
            at=at,
        )
        return {"store": store, "episode": record}

    @_account_locked
    def set_learning_summary(self, account_id: str, summary: dict[str, Any], now: int | None = None) -> dict[str, Any]:
        at = _now_ms(now)
        store = self.load_store(account_id)
        store["learningSummary"] = summary
        store = self._save_without_reread(account_id, store, at)
        self._audit(
            account_id,
            action="summary_rebuilt",
            actor="rule",
            reason="learning_summary_rebuilt",
            at=at,
        )
        return store

    def get_chat_summary(self, account_id: str, course_id: str) -> dict[str, Any] | None:
        store = self.load_store(account_id)
        for record in store.get("records", []):
            if record.get("dedupeKey") == f"chat-summary:{course_id}" and record.get("status") == "active":
                return {
                    "courseId": course_id,
                    "summary": record.get("content", ""),
                    "timestamp": record.get("updatedAt", 0),
                    "unresolvedConcepts": record.get("conceptKeys", []),
                    "sourceRefs": record.get("sourceRefs", []),
                    "preferredExplanationStyles": [
                        tag for tag in record.get("tags", [])
                        if tag not in ("chat_summary",)
                    ],
                }
        return None

    @_account_locked
    def append_chat_transcript(
        self,
        account_id: str,
        course_id: str,
        messages: list[dict[str, Any]],
        *,
        now: int | None = None,
    ) -> list[dict[str, Any]]:
        """保存服务端标准化的对话消息，按 messageId 去重并限制保留窗口。"""
        at = _now_ms(now)
        path = self._chat_transcript_path(account_id, course_id)
        rows = self._read_jsonl(path)
        by_id = {str(row.get("messageId")): row for row in rows if row.get("messageId")}
        for item in messages:
            message_id = str(item.get("messageId") or "").strip()
            role = str(item.get("role") or "")
            content = str(item.get("content") or "").strip()
            if not message_id or role not in {"user", "assistant"} or not content:
                continue
            by_id[message_id] = {
                "messageId": message_id,
                "courseId": course_id,
                "role": role,
                "content": content[:4000],
                "createdAt": int(item.get("createdAt") or at),
            }
        merged = sorted(by_id.values(), key=lambda row: (int(row.get("createdAt") or 0), row["messageId"]))[-100:]
        self._atomic_write(path, "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in merged))
        return merged

    def load_chat_transcript(self, account_id: str, course_id: str) -> list[dict[str, Any]]:
        return self._read_jsonl(self._chat_transcript_path(account_id, course_id))

    @_account_locked
    def tombstone_record(self, account_id: str, memory_id: str, reason: str) -> dict[str, Any]:
        store = self.load_store(account_id)
        at = _now_ms()
        operation_id = _stable_id("op", f"{account_id}:{memory_id}:{reason}:{at}")
        for record in store.get("records", []):
            if record.get("memoryId") == memory_id:
                record["status"] = "tombstoned"
                record["updatedAt"] = at
        tombstone = {
            "tombstoneId": _stable_id("tomb", f"{memory_id}:{reason}"),
            "accountId": account_id,
            "memoryId": memory_id,
            "dedupeKey": next((row.get("dedupeKey") for row in store.get("records", []) if row.get("memoryId") == memory_id), None),
            "reason": reason,
            "operationId": operation_id,
            "createdAt": at,
        }
        store.setdefault("tombstones", []).append(tombstone)
        store.pop("learningSummary", None)
        store = self._rebuild_core(account_id, store, at)
        store = self._save_without_reread(account_id, store, at)
        return {"store": store, "tombstone": tombstone}

    @_account_locked
    def update_record(
        self,
        account_id: str,
        memory_id: str,
        patch: dict[str, Any],
        now: int | None = None,
    ) -> dict[str, Any] | None:
        """用户编辑 Memory；追加 user_edit 来源并保留原 provenance。"""
        at = _now_ms(now)
        store = self.load_store(account_id)
        target = next((row for row in store.get("records", []) if row.get("memoryId") == memory_id), None)
        if target is None or target.get("status") == "tombstoned":
            return None
        if "title" in patch:
            target["title"] = str(patch.get("title") or "")[:120]
        if "summary" in patch:
            target["summary"] = str(patch.get("summary") or "")[:240]
        if "content" in patch:
            target["content"] = str(patch.get("content") or "")[:3000]
        target["sourceRefs"] = [
            *(target.get("sourceRefs") or []),
            {"type": "user_edit", "editId": _stable_id("edit", f"{memory_id}:{at}")},
        ]
        target["updatedAt"] = at
        target["version"] = int(target.get("version", 1)) + 1
        store = self._rebuild_core(account_id, store, at)
        store = self._save_without_reread(account_id, store, at)
        return {"store": store, "record": target}

    @_account_locked
    def delete_course_memory(self, account_id: str, course_id: str) -> dict[str, Any]:
        """删除课程时清理 course-scoped records 与该课 Evidence，并重建投影。"""
        store = self.load_store(account_id)
        at = _now_ms()
        operation_id = _stable_id("op-course", f"{account_id}:{course_id}:{at}")
        deleted_courses = list(store.get("deletedCourses") or [])
        if course_id not in deleted_courses:
            deleted_courses.append(course_id)
        store["deletedCourses"] = deleted_courses
        removed_evidence = [
            row for row in self.load_evidence(account_id)
            if row.get("courseId") == course_id
        ]
        remaining_evidence = [
            row for row in self.load_evidence(account_id)
            if row.get("courseId") != course_id
        ]
        self._atomic_write(
            self._evidence_path(account_id),
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in remaining_evidence),
        )

        removed_evidence_ids = {row.get("evidenceId") for row in removed_evidence if row.get("evidenceId")}
        remediation_rows = self._read_jsonl(self._remediation_path(account_id))
        remaining_remediation = [
            row for row in remediation_rows
            if row.get("beforeEvidenceId") not in removed_evidence_ids
            and row.get("afterEvidenceId") not in removed_evidence_ids
        ]
        self._atomic_write(
            self._remediation_path(account_id),
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in remaining_remediation),
        )

        candidates = self.load_candidates(account_id)
        remaining_candidates = [
            row for row in candidates
            if (row.get("scope") or {}).get("courseId") != course_id
        ]
        self._atomic_write(
            self._candidates_path(account_id),
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in remaining_candidates),
        )

        checkpoints_dir = self._memory_dir(account_id) / "checkpoints"
        if checkpoints_dir.exists():
            for path in checkpoints_dir.glob("*.json"):
                sealed = self._read_json(path)
                if sealed and (sealed.get("meta") or {}).get("courseId") == course_id:
                    try:
                        path.unlink()
                    except FileNotFoundError:
                        pass

        recaps_dir = self._memory_dir(account_id) / "recaps"
        if recaps_dir.exists():
            for path in recaps_dir.glob("*.json"):
                snapshot = self._read_json(path)
                if snapshot and snapshot.get("courseId") == course_id:
                    try:
                        path.unlink()
                    except FileNotFoundError:
                        pass

        for record in store.get("records", []):
            scope = record.get("scope") or {}
            if scope.get("type") == "course" and scope.get("courseId") == course_id and record.get("status") == "active":
                record["status"] = "tombstoned"
                record["updatedAt"] = at
                store.setdefault("tombstones", []).append({
                    "tombstoneId": _stable_id("tomb-course", f"{record.get('memoryId')}:{course_id}"),
                    "accountId": account_id,
                    "memoryId": record.get("memoryId"),
                    "dedupeKey": record.get("dedupeKey"),
                    "reason": "course_deleted",
                    "operationId": operation_id,
                    "createdAt": at,
                })

        store = self._rebuild_projections(
            store,
            remaining_evidence,
            remaining_remediation,
        )
        store.pop("learningSummary", None)
        store = self._rebuild_core(account_id, store, at)
        store = self._save_without_reread(account_id, store, at)
        return {"store": store, "removedEvidenceCount": len(removed_evidence)}
