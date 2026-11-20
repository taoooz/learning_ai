import asyncio
import json
from unittest.mock import AsyncMock

from services.memory_summary_service import rebuild_learning_summary, validate_summary
from services.memory_v4_store import MemoryV4Store


def _profile():
    return {
        "targetJob": "AI 产品经理",
        "workExperience": [],
        "education": [],
        "insights": {
            "workSummary": ["做过数据产品"],
            "educationSummary": [],
            "analogyExperiences": [],
            "learningStyle": "实践型",
            "technicalLevel": "业务级",
            "valuePriorities": ["效率"],
            "summary": "偏实践的学习者",
        },
    }


def test_validate_summary_requires_core_fields():
    assert validate_summary({"journey": "", "currentFocus": "Agent"}, record_ids=[], evidence_ids=[], ledger_revision=0) is None
    summary = validate_summary({
        "journey": "正在学习 Agent",
        "currentFocus": "工具调用",
        "learnerInsights": ["偏好实践例子"],
        "areasToWatch": ["工具选择时机"],
    }, record_ids=["mem-1"], evidence_ids=["ev-1"], ledger_revision=2)
    assert summary["summaryVersion"] == "learning-summary-v1"
    assert summary["sourceRecordIds"] == ["mem-1"]


def test_rebuild_learning_summary_persists(tmp_path):
    async def run():
        store = MemoryV4Store(tmp_path)
        store.ingest_profile("account-a", _profile(), now=1000)
        store.append_evidence("account-a", {
            "evidenceId": "ev-1", "evidenceKey": "key-1", "idempotencyKey": "idem-1",
            "accountId": "account-a", "protocolVersion": 4, "courseId": "course-1",
            "chapterId": "ch-1", "courseTopic": "Agent", "topic": "Agent", "objectiveId": "obj-1",
            "conceptKeys": ["工具调用"], "taskId": "task-1", "checkpointId": "cp-1",
            "kind": "scenario_choice", "outcome": "not_demonstrated", "strength": "moderate",
            "score": 0.2, "confidence": 0.8, "attempt": 1, "hintLevel": "none",
            "isRemediationAttempt": False, "sourceItemId": "cp-1", "planVersion": 1,
            "evaluator": "rule", "evaluationVersion": "checkpoint-rule-v1",
            "misconceptionCodes": ["混淆工具选择时机"], "createdAt": 1000,
        })
        client = AsyncMock()
        client.chat.return_value = {"choices": [{"message": {"content": json.dumps({
            "journey": "正在从数据产品转向 AI 产品",
            "currentFocus": "Agent 工具调用",
            "learnerInsights": ["偏好实践型讲解"],
            "areasToWatch": ["工具选择时机"],
        }, ensure_ascii=False)}}]}
        return await rebuild_learning_summary(store, "account-a", client=client)

    summary = asyncio.run(run())
    assert summary is not None
    store = MemoryV4Store(tmp_path)
    persisted = store.load_store("account-a")["learningSummary"]
    assert persisted["currentFocus"] == "Agent 工具调用"
    assert persisted["sourceRecordIds"]
    assert persisted["sourceEvidenceIds"] == ["ev-1"]
