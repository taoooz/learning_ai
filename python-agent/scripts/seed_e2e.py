"""为 Playwright E2E 构造确定性的 server 模式账户数据。"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.memory_candidate_service import (
    derive_repeated_behavior_candidates,
    validate_candidates,
)
from services.memory_v4_store import MemoryV4Store
from services.user_data_store import UserDataStore

ACCOUNT = "eeee-eeee-eeee"
COURSE_ID = "course-memory-e2e"
CHAPTER_ID = "ch-1"
PLAN_ID = "plan-e2e-0001"
CHECKPOINT_ID = "cp-e2e-original"
REMEDIATION_CHECKPOINT_ID = "cp-e2e-original-r1"
NOW = 1_800_000_000_000
DATA_ROOT = Path(__file__).resolve().parent.parent / "data" / "user_data"
OUTPUT = Path("/tmp") / "learning-ai-e2e-seed.json"


def _course() -> dict[str, Any]:
    blueprint = {
        "blueprintId": "bp-e2e-memory",
        "protocolVersion": 2,
        "topic": "HTTP 缓存 E2E",
        "intentType": "conceptual_understanding",
        "targetScenario": "在真实前端项目中判断何时复用缓存",
        "mission": {
            "why": "验证 Memory V4 真实学习链路",
            "targetScenario": "前端缓存判断",
            "successCriteria": ["能区分 200 与 304", "能解释 ETag 优先级"],
            "constraints": ["E2E 测试课程"],
            "outOfScope": [],
        },
        "learnerStartingPoint": {
            "estimatedLevel": "beginner",
            "confirmedKnowledge": [],
            "likelyGaps": ["协商缓存"],
            "excludedTopics": [],
        },
        "courseObjectives": [{
            "objectiveId": "obj-1",
            "description": "理解协商缓存与验证头优先级",
            "observableOutcome": "能判断 ETag 与 Last-Modified 同时存在时的返回结果",
            "importance": "core",
            "evidenceRequirement": "demonstration",
            "conceptKeys": ["ETag", "Last-Modified", "304"],
        }],
        "successCriteria": ["完成章末检查"],
        "chapters": [
            {
                "chapterId": CHAPTER_ID,
                "index": 1,
                "title": "E2E：ETag 与 Last-Modified",
                "objectiveIds": ["obj-1"],
                "prerequisites": [],
                "teachingGoal": "理解验证头优先级",
                "completionCriteria": ["完成理解检查"],
            },
            {
                "chapterId": "ch-2",
                "index": 2,
                "title": "E2E：缓存复用判断",
                "objectiveIds": ["obj-1"],
                "prerequisites": [CHAPTER_ID],
                "teachingGoal": "判断何时复用缓存",
                "completionCriteria": ["完成理解检查"],
            },
        ],
        "createdAt": NOW,
        "promptVersion": "e2e-v1",
        "modelVersion": "e2e-fixture",
    }
    return {
        "courseId": COURSE_ID,
        "blueprint": blueprint,
        "treeView": {
            "courseId": COURSE_ID,
            "topic": "HTTP 缓存 E2E",
            "totalChapters": 2,
            "chapters": [
                {"chapterId": CHAPTER_ID, "index": 1, "title": "E2E：ETag 与 Last-Modified", "status": "available"},
                {"chapterId": "ch-2", "index": 2, "title": "E2E：缓存复用判断", "status": "locked"},
            ],
        },
        "createdAt": NOW,
    }


def _checkpoint_definition(checkpoint_id: str, prompt: str, hint: str) -> dict[str, Any]:
    return {
        "checkpointId": checkpoint_id,
        "objectiveId": "obj-1",
        "taskId": "t1",
        "conceptKeys": ["ETag", "Last-Modified"],
        "kind": "scenario_choice",
        "prompt": prompt,
        "options": [
            {"id": "a", "text": "A. 直接返回 304，因为存在 Last-Modified"},
            {"id": "b", "text": "B. 返回 200，因为 ETag 不匹配时优先走新资源"},
            {"id": "c", "text": "C. 返回 412，要求重新下载"},
            {"id": "d", "text": "D. 同时返回 200 和 304"},
        ],
        "correctAnswer": "b",
        "remediationHint": hint,
        "estimatedSeconds": 45,
        "sourceRefs": [],
    }


def _lesson(original: dict[str, Any]) -> dict[str, Any]:
    sanitized = dict(original)
    sanitized.pop("correctAnswer", None)
    return {
        "protocolVersion": 2,
        "chapterId": CHAPTER_ID,
        "chapterPlan": {
            "chapterId": CHAPTER_ID,
            "planId": PLAN_ID,
            "planVersion": 1,
            "objectiveIds": ["obj-1"],
            "tasks": [{
                "taskId": "t1",
                "order": 1,
                "title": "E2E 验证头优先级",
                "objectiveId": "obj-1",
                "taskGoal": "判断 ETag 与 Last-Modified 同时存在时的结果",
                "observableOutcome": "能选出正确返回状态",
                "conceptKeys": ["ETag", "Last-Modified"],
                "prerequisiteTaskIds": [],
                "teachingPattern": "compare",
                "expectedMinutes": 2,
                "evidencePolicy": "checkpoint",
                "origin": "initial",
                "status": "planned",
            }],
            "status": "active",
            "createdAt": NOW,
            "updatedAt": NOW,
            "generationMeta": {"promptVersion": "e2e-v1", "modelVersion": "e2e-fixture", "generatedAt": NOW},
        },
        "runtime": {
            "status": "awaiting_user",
            "currentTaskId": "t1",
            "currentTaskStatus": "awaiting_user",
            "completedTaskIds": ["t1"],
            "skippedTaskIds": [],
            "latestSequence": 2,
            "lastActiveAt": NOW,
        },
        "streamItems": [
            {
                "itemId": "tc:t1:v1",
                "sequence": 1,
                "createdAt": NOW,
                "type": "task_content",
                "taskId": "t1",
                "blocks": [{
                    "id": "block-e2e-1",
                    "type": "markdown",
                    "markdown": "当 ETag 与 Last-Modified 同时存在时，只要请求带 If-None-Match，服务器就优先校验 ETag。",
                }],
                "boundaryPrompt": {"takeaway": "ETag 优先，Last-Modified 仅在指纹缺席时兜底。"},
            },
            {
                "itemId": f"checkpoint:{CHECKPOINT_ID}",
                "sequence": 2,
                "createdAt": NOW,
                "type": "checkpoint",
                "taskId": "t1",
                "checkpoint": sanitized,
                "remediationAttempt": 0,
                "status": "pending",
            },
        ],
        "evidence": [],
        "updatedAt": NOW,
    }


def seed_course_and_checkpoints() -> dict[str, Any]:
    user_store = UserDataStore(DATA_ROOT)
    user_store.save_courses(ACCOUNT, [_course()])
    original = _checkpoint_definition(CHECKPOINT_ID, "E2E：ETag 与 Last-Modified 同时存在且 ETag 不匹配时返回什么？", "ETag 不匹配时直接返回新资源。")
    remediated = _checkpoint_definition(REMEDIATION_CHECKPOINT_ID, "补救后 E2E：服务器优先校验哪个验证头？", "优先校验 If-None-Match。")
    user_store.save_lesson(ACCOUNT, COURSE_ID, CHAPTER_ID, _lesson(original))

    memory_store = MemoryV4Store(DATA_ROOT)
    base_meta = {
        "accountId": ACCOUNT,
        "courseId": COURSE_ID,
        "chapterId": CHAPTER_ID,
        "courseTopic": "HTTP 缓存 E2E",
        "taskId": "t1",
        "objectiveId": "obj-1",
        "taskTitle": "E2E 验证头优先级",
        "taskGoal": "判断 ETag 与 Last-Modified 同时存在时的结果",
        "chapterTitle": "E2E：ETag 与 Last-Modified",
        "teachingGoal": "理解验证头优先级",
        "taskContentSummary": "ETag 与 Last-Modified 同时存在时优先校验 ETag。",
        "planId": PLAN_ID,
        "planVersion": 1,
    }
    memory_store.save_checkpoint_definition(ACCOUNT, original, base_meta)
    memory_store.save_checkpoint_definition(ACCOUNT, remediated, {**base_meta, "remediationId": "rem-e2e-1", "previousCheckpointId": CHECKPOINT_ID})
    return {"original": original, "remediated": remediated}


def seed_memory() -> dict[str, Any]:
    store = MemoryV4Store(DATA_ROOT)
    store.ingest_profile(ACCOUNT, {
        "targetJob": "E2E 产品经理",
        "workExperience": [{"company": "E2E 公司", "position": "产品经理", "description": "负责缓存性能优化"}],
        "education": [{"school": "E2E University", "major": "计算机"}],
        "insights": {"learningStyle": "实践型", "technicalLevel": "业务级"},
    }, now=NOW)

    messages = [
        {"messageId": "e2e-pref-1", "role": "user", "content": "以后复杂概念请分步骤解释"},
        {"messageId": "e2e-pref-2", "role": "user", "content": "还是分步骤说明更好"},
    ]
    explicit = validate_candidates([{
        "kind": "preference",
        "title": "E2E 分步骤偏好",
        "summary": "复杂概念分步骤",
        "content": "以后复杂概念请分步骤解释",
        "scopeType": "user",
        "sourceType": "explicit_user_statement",
        "confidence": 0.92,
        "importance": 0.8,
        "durability": "long_term",
        "suggestedAction": "add",
        "tags": ["explanation_style"],
        "sourceMessageId": "e2e-pref-1",
        "sourceQuote": "以后复杂概念请分步骤解释",
    }], account_id=ACCOUNT, course_id=COURSE_ID, topic="HTTP 缓存 E2E", messages=messages, now=NOW)
    repeated = derive_repeated_behavior_candidates(account_id=ACCOUNT, course_id=COURSE_ID, messages=messages, now=NOW)
    delete_fixture = validate_candidates([{
        "kind": "preference",
        "title": "E2E 临时删除记忆",
        "summary": "仅用于删除链路测试",
        "content": "E2E 临时删除记忆：仅用于测试",
        "scopeType": "user",
        "sourceType": "explicit_user_statement",
        "confidence": 0.9,
        "importance": 0.1,
        "durability": "long_term",
        "suggestedAction": "add",
        "tags": ["e2e"],
        "sourceMessageId": "e2e-delete-1",
        "sourceQuote": "E2E 临时删除记忆：仅用于测试",
    }], account_id=ACCOUNT, course_id=COURSE_ID, topic="HTTP 缓存 E2E", messages=[{
        "messageId": "e2e-delete-1", "role": "user", "content": "E2E 临时删除记忆：仅用于测试",
    }], now=NOW)

    before_ev = {
        "evidenceId": "ev-e2e-taught-before", "evidenceKey": "evk-e2e-before", "idempotencyKey": "idem-e2e-before",
        "accountId": ACCOUNT, "protocolVersion": 4, "courseId": COURSE_ID, "chapterId": CHAPTER_ID,
        "courseTopic": "HTTP 缓存 E2E", "topic": "HTTP 缓存 E2E", "objectiveId": "obj-1",
        "conceptKeys": ["ETag 优先级"], "taskId": "t1", "checkpointId": "cp-e2e-teach",
        "kind": "scenario_choice", "outcome": "not_demonstrated", "strength": "moderate", "score": 0,
        "confidence": 1, "attempt": 1, "hintLevel": "none", "isRemediationAttempt": False,
        "sourceItemId": "cp-e2e-teach", "planVersion": 1, "evaluator": "rule",
        "evaluationVersion": "checkpoint-rule-v1", "misconceptionCodes": [], "createdAt": NOW,
    }
    after_ev = {
        **before_ev,
        "evidenceId": "ev-e2e-taught-after", "evidenceKey": "evk-e2e-after", "idempotencyKey": "idem-e2e-after",
        "checkpointId": "cp-e2e-teach-r1", "sourceItemId": "cp-e2e-teach-r1",
        "outcome": "demonstrated", "score": 1, "isRemediationAttempt": True, "createdAt": NOW + 1,
    }
    store.append_evidence(ACCOUNT, before_ev)
    store.append_evidence(ACCOUNT, after_ev)
    store.append_remediation(ACCOUNT, {
        "remediationId": "rem-e2e-teach-1", "accountId": ACCOUNT, "originCheckpointId": "cp-e2e-teach",
        "conceptKeys": ["ETag 优先级"], "triggerEvidenceId": before_ev["evidenceId"],
        "beforeEvidenceId": before_ev["evidenceId"], "afterEvidenceId": after_ev["evidenceId"],
        "strategyKey": "llm-remediation-v1", "strategyVersion": "1", "round": 1,
        "outcome": "helped", "createdAt": NOW + 2,
    })

    for candidate in [*explicit, *repeated, *delete_fixture]:
        store.append_candidate(ACCOUNT, candidate)
    consolidated = store.consolidate_candidates(ACCOUNT)
    records = consolidated["store"]["records"]
    explicit_record = next(r for r in records if r.get("title") == "E2E 分步骤偏好" and r.get("status") == "active")
    repeated_record = next(r for r in records if r.get("sourceType") == "repeated_behavior" and r.get("status") == "active")
    teaching_record = next(r for r in records if r.get("kind") == "teaching_strategy" and r.get("status") == "active")
    delete_record = next(r for r in records if r.get("title") == "E2E 临时删除记忆" and r.get("status") == "active")

    store.append_chat_transcript(ACCOUNT, COURSE_ID, [
        {"messageId": "e2e-chat-1", "role": "user", "content": "E2E 讨论 ETag 和 Last-Modified 的优先级", "createdAt": NOW + 10},
        {"messageId": "e2e-chat-2", "role": "assistant", "content": "优先校验 If-None-Match，时间戳只做兜底。", "createdAt": NOW + 11},
    ], now=NOW + 12)
    store.set_learning_summary(ACCOUNT, {
        "journey": "E2E 正在验证 Memory V4 的服务端学习链路。",
        "currentFocus": "ETag 与 Last-Modified 优先级",
        "learnerInsights": ["偏好分步骤解释"],
        "areasToWatch": ["304 响应细节"],
        "sourceRecordIds": [explicit_record["memoryId"]],
        "sourceEvidenceIds": [before_ev["evidenceId"], after_ev["evidenceId"]],
        "summaryVersion": "learning-summary-v1",
        "sourceLedgerRevision": 2,
        "generatedAt": NOW + 13,
    })
    return {
        "explicitMemoryId": explicit_record["memoryId"],
        "repeatedMemoryId": repeated_record["memoryId"],
        "teachingMemoryId": teaching_record["memoryId"],
        "deleteMemoryId": delete_record["memoryId"],
    }


def main() -> None:
    account_dir = DATA_ROOT / ACCOUNT
    shutil.rmtree(account_dir, ignore_errors=True)
    checkpoints = seed_course_and_checkpoints()
    memory = seed_memory()
    OUTPUT.write_text(json.dumps({
        "account": ACCOUNT,
        "courseId": COURSE_ID,
        "chapterId": CHAPTER_ID,
        "checkpointId": CHECKPOINT_ID,
        "remediationCheckpointId": REMEDIATION_CHECKPOINT_ID,
        "checkpointPrompt": checkpoints["original"]["prompt"],
        "remediationPrompt": checkpoints["remediated"]["prompt"],
        **memory,
    }, ensure_ascii=False, indent=2))
    print(str(OUTPUT))


if __name__ == "__main__":
    main()
