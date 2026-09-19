# tests/test_checkpoint.py — P3 结构化 Checkpoint：schema 校验 + 程序判分 + JSON 提取

import pytest
from pydantic import ValidationError

from schemas.checkpoint import (
    CheckpointDefinitionModel,
    CheckpointEvaluateRequest,
    CheckpointEvaluationModel,
)
from services.checkpoint_service import _extract_json, evaluate_checkpoint


def _scenario_choice(**overrides) -> CheckpointDefinitionModel:
    base = dict(
        checkpointId="cp-1",
        objectiveId="obj-1",
        taskId="task-1",
        conceptKeys=["etag"],
        kind="scenario_choice",
        prompt="浏览器收到 304 时应该怎么做？",
        options=[
            {"id": "a", "text": "重新下载资源"},
            {"id": "b", "text": "使用本地缓存"},
            {"id": "c", "text": "清空缓存"},
            {"id": "d", "text": "报错退出"},
        ],
        correctAnswer="b",
        remediationHint="304 表示资源未变化。",
        estimatedSeconds=45,
    )
    base.update(overrides)
    return CheckpointDefinitionModel(**base)


def _sequence(**overrides) -> CheckpointDefinitionModel:
    base = dict(
        checkpointId="cp-2",
        objectiveId="obj-1",
        taskId="task-1",
        kind="sequence",
        prompt="按正确顺序排列条件请求流程",
        sequenceItems=[
            {"id": "s1", "text": "浏览器发 If-None-Match"},
            {"id": "s2", "text": "服务器比对 ETag"},
            {"id": "s3", "text": "服务器返回 304"},
        ],
        correctAnswer=["s1", "s2", "s3"],
        remediationHint="先发请求再比对。",
        estimatedSeconds=45,
    )
    base.update(overrides)
    return CheckpointDefinitionModel(**base)


# ---- Schema 校验 ----


def test_scenario_choice_valid():
    cp = _scenario_choice()
    assert cp.kind == "scenario_choice"
    assert len(cp.options) == 4
    assert cp.correctAnswer == "b"


def test_sequence_valid():
    cp = _sequence()
    assert cp.kind == "sequence"
    assert cp.correctAnswer == ["s1", "s2", "s3"]


def test_invalid_kind_rejected():
    with pytest.raises(ValidationError):
        _scenario_choice(kind="self_explanation")


def test_unknown_fields_rejected():
    with pytest.raises(ValidationError):
        _scenario_choice(evidence=[])


# ---- 程序判分 ----


def test_scenario_choice_correct():
    cp = _scenario_choice()
    result = evaluate_checkpoint(cp, "b", attempt=1)
    assert result.correct is True
    assert result.outcome == "demonstrated"
    assert result.nextAction == "continue"
    assert result.confidence == 1.0


def test_scenario_choice_wrong_first_attempt():
    cp = _scenario_choice()
    result = evaluate_checkpoint(cp, "a", attempt=1)
    assert result.correct is False
    assert result.outcome == "not_demonstrated"
    assert result.nextAction == "remediate_here"
    assert result.correctAnswer == "b"


def test_scenario_choice_wrong_second_attempt_continues():
    """补救最多两轮：第二轮错误 → continue + not_demonstrated，不锁死"""
    cp = _scenario_choice()
    result = evaluate_checkpoint(cp, "a", attempt=2)
    assert result.correct is False
    assert result.outcome == "not_demonstrated"
    assert result.nextAction == "continue"


def test_sequence_correct():
    cp = _sequence()
    result = evaluate_checkpoint(cp, ["s1", "s2", "s3"], attempt=1)
    assert result.correct is True
    assert result.outcome == "demonstrated"


def test_sequence_wrong_order():
    cp = _sequence()
    result = evaluate_checkpoint(cp, ["s2", "s1", "s3"], attempt=1)
    assert result.correct is False
    assert result.nextAction == "remediate_here"


def test_sequence_type_mismatch():
    """answer 类型与题型不匹配 → 判错"""
    cp = _sequence()
    result = evaluate_checkpoint(cp, "s1", attempt=1)
    assert result.correct is False


# ---- JSON 提取 ----


def test_extract_json_plain():
    result = _extract_json('{"kind": "scenario_choice", "prompt": "test"}')
    assert result["kind"] == "scenario_choice"


def test_extract_json_with_fence():
    result = _extract_json('```json\n{"kind": "sequence"}\n```')
    assert result["kind"] == "sequence"


def test_extract_json_with_surrounding_text():
    result = _extract_json('以下是题目：\n{"kind": "scenario_choice"}\n请查收。')
    assert result["kind"] == "scenario_choice"


def test_extract_json_not_found():
    with pytest.raises(ValueError, match="未找到 JSON"):
        _extract_json("没有 JSON 内容")


# ---- 端点 ----


def _endpoint_client():
    from fastapi.testclient import TestClient
    from main import app

    return TestClient(app)


def test_evaluate_endpoint_correct_answer():
    client = _endpoint_client()
    cp = _scenario_choice()
    response = client.post("/api/learning/v2/checkpoints/evaluate", json={
        "courseId": "c1", "chapterId": "ch1", "taskId": "task-1",
        "checkpointId": "cp-1", "answer": "b", "attempt": 1,
        "idempotencyKey": "cp:ch1:v1:task-1:cp-1",
        "checkpoint": cp.model_dump(),
    })
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["evaluation"]["correct"] is True


def test_evaluate_endpoint_missing_checkpoint():
    client = _endpoint_client()
    response = client.post("/api/learning/v2/checkpoints/evaluate", json={
        "courseId": "c1", "chapterId": "ch1", "taskId": "task-1",
        "checkpointId": "cp-1", "answer": "b", "attempt": 1,
        "idempotencyKey": "cp:ch1:v1:task-1:cp-1",
    })
    assert response.status_code == 422
    assert "checkpoint" in response.json()["message"].lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
