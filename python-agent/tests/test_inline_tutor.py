# tests/test_inline_tutor.py — P2 流内答疑请求模型与 prompt（计划 Task 3）
# 契约对齐：
# - InlineTutorRequest 与 lib/learning-v2/tutor-context.ts InlineTutorRequestPayload 逐字段对齐，
#   extra='forbid' 拒绝整门课程对象或全量历史混入
# - build_inline_tutor_prompt 明确中文回答当前问题、不输出思维过程、不产出证据结论

import pytest
from pydantic import ValidationError

from prompts.inline_tutor import build_inline_tutor_prompt
from schemas.tutor import InlineTutorRequest, InlineTutorResponse


def _request(**overrides) -> InlineTutorRequest:
    base = dict(
        mode="inline_tutor",
        courseTopic="HTTP 缓存",
        chapter={"title": "验证策略", "teachingGoal": "理解强缓存和协商缓存"},
        task={"taskId": "task-1", "title": "ETag", "taskDescription": "理解条件请求"},
        visibleContent="ETag 可以理解为资源的版本指纹。",
        recentInlineQA=[
            {"question": "什么是强缓存？", "answer": "强缓存通过 Cache-Control 等响应头控制。"},
        ],
        question={"questionId": "q-1", "text": "304 为什么没有正文？"},
        idempotencyKey="tutor:ch-1:v1:task-1:q-1",
    )
    base.update(overrides)
    return InlineTutorRequest(**base)


def test_prompt_contains_current_task_but_not_full_course():
    """简报基线：prompt 含当前任务与当前问题，明确不输出思维过程"""
    request = _request()
    prompt = build_inline_tutor_prompt(request)
    assert "当前任务" in prompt
    assert request.question.text in prompt
    assert "不要输出思维过程" in prompt


def test_prompt_requires_chinese_and_forbids_evidence_conclusions():
    """中文作答；不得产出掌握度/证据结论（画像文档 §7.1 红线）"""
    prompt = build_inline_tutor_prompt(_request())
    assert "中文" in prompt
    assert "掌握度" in prompt
    assert "证据" in prompt


def test_prompt_carries_minimal_context_fields():
    """课程主题、章节、任务、已展示内容与最近问答都进入 prompt"""
    request = _request()
    prompt = build_inline_tutor_prompt(request)
    assert request.courseTopic in prompt
    assert request.chapter.title in prompt
    assert request.chapter.teachingGoal in prompt
    assert request.task.title in prompt
    assert request.task.taskDescription in prompt
    assert request.visibleContent in prompt
    assert request.recentInlineQA[0].question in prompt
    assert request.recentInlineQA[0].answer in prompt


def test_prompt_handles_empty_optional_context():
    """无已展示内容 / 无历史问答时占位「（暂无）」而不是空白段"""
    prompt = build_inline_tutor_prompt(_request(visibleContent="", recentInlineQA=[]))
    assert "（暂无）" in prompt


def test_request_rejects_unknown_fields():
    """extra='forbid'：整门课程对象或任何未定义字段一律拒绝"""
    with pytest.raises(ValidationError):
        _request(fullCourse={"chapters": []})
    with pytest.raises(ValidationError):
        InlineTutorRequest(
            **{
                **_request().model_dump(),
                "chapter": {"title": "验证策略", "teachingGoal": "理解强缓存和协商缓存", "extra": 1},
            }
        )


def test_request_mode_must_be_inline_tutor():
    with pytest.raises(ValidationError):
        _request(mode="chat")


def test_recent_inline_qa_defaults_to_empty_list():
    payload = {k: v for k, v in _request().model_dump().items() if k != "recentInlineQA"}
    assert InlineTutorRequest(**payload).recentInlineQA == []


def test_request_requires_question_and_idempotency_key():
    payload = _request().model_dump()
    del payload["question"]
    with pytest.raises(ValidationError):
        InlineTutorRequest(**payload)
    payload = _request().model_dump()
    del payload["idempotencyKey"]
    with pytest.raises(ValidationError):
        InlineTutorRequest(**payload)


def test_response_shape_and_forbid():
    """InlineTutorResponse 对齐 TutorCompletedPayload；只允许 markdown 块且拒绝多余字段"""
    response = InlineTutorResponse(
        questionId="q-1",
        blocks=[{"type": "markdown", "blockId": "tb1", "markdown": "304 只回包头不回正文。"}],
        generationMeta={"promptVersion": "inline-tutor-v1"},
    )
    assert response.blocks[0].markdown == "304 只回包头不回正文。"

    with pytest.raises(ValidationError):
        InlineTutorResponse(
            questionId="q-1",
            blocks=[{"type": "key_point", "blockId": "tb1", "points": []}],
            generationMeta={},
        )
    with pytest.raises(ValidationError):
        InlineTutorResponse(
            questionId="q-1",
            blocks=[{"type": "markdown", "blockId": "tb1", "markdown": "正文"}],
            generationMeta={},
            evidence=[],
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
