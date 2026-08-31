# tests/test_inline_tutor.py — P2 流内答疑请求模型、prompt 与 Tutor SSE 服务（计划 Task 3 / Task 4）
# 契约对齐：
# - InlineTutorRequest 与 lib/learning-v2/tutor-context.ts InlineTutorRequestPayload 逐字段对齐，
#   extra='forbid' 拒绝整门课程对象或全量历史混入
# - build_inline_tutor_prompt 明确中文回答当前问题、不输出思维过程、不产出证据结论
# - 事件序列 tutor_started → tutor_block_started → tutor_block_delta* → tutor_block_completed
#   → tutor_completed → request_completed（设计文档 §2.2）

import asyncio
import json

import httpx
import pytest
from pydantic import ValidationError

from prompts.inline_tutor import build_inline_tutor_prompt
from schemas.tutor import InlineTutorRequest, InlineTutorResponse
from services.inline_tutor_service import (
    BLOCK_ID,
    TutorRequestDataError,
    classify_tutor_error,
    extract_tutor_envelope_ids,
    stream_tutor_events,
)


def _request(**overrides) -> InlineTutorRequest:
    base = dict(
        mode="inline_tutor",
        courseId="course-1",
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


def test_request_requires_course_id():
    """缺 courseId → 校验失败（端点层 422）"""
    payload = _request().model_dump()
    del payload["courseId"]
    with pytest.raises(ValidationError):
        InlineTutorRequest(**payload)


# ---- Task 8：HTTP 端点必填字段校验 → 422（流尚未开始，直接 JSON 错误体） ----


def _endpoint_client():
    from fastapi.testclient import TestClient

    from main import app

    return TestClient(app)


def test_invalid_question_context_is_rejected():
    """缺 question 等必填字段 → 端点层 422，不触达 LLM"""
    client = _endpoint_client()

    payload = _request().model_dump()
    del payload["question"]
    response = client.post("/api/learning/v2/tutor/stream", json=payload)
    assert response.status_code == 422
    body = response.json()
    assert body["ok"] is False
    assert body["code"] == "INVALID_REQUEST"
    assert body["retryable"] is False
    assert "question" in body["message"]

    # 其余必填字段同理：缺 idempotencyKey → 422
    payload = _request().model_dump()
    del payload["idempotencyKey"]
    response = client.post("/api/learning/v2/tutor/stream", json=payload)
    assert response.status_code == 422


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


# ---- Task 4：Tutor SSE 服务 ----


class FakeTutorClient:
    """假 LLM 客户端：stream_chat 产出预置增量；可选在开头或第 N 个增量后抛异常"""
    model = "fake-model"

    def __init__(self, deltas=(), error: Exception | None = None, error_after: int | None = None):
        self.deltas = list(deltas)
        self.error = error
        self.error_after = error_after  # 发出 N 个增量后抛错；None 表示开始前抛错

    async def stream_chat(self, messages, model=None, max_tokens=1500):
        if self.error is not None and self.error_after is None:
            raise self.error
        for index, delta in enumerate(self.deltas):
            if self.error_after is not None and index == self.error_after:
                raise self.error
            yield {"choices": [{"delta": {"content": delta}}]}


async def _collect_tutor(gen):
    return [event async for event in gen]


def fake_tutor_events(answer: str | None = None, client=None, **request_overrides) -> list[dict]:
    """以假 LLM 客户端运行 Tutor 服务，返回完整事件序列（answer 作为单个增量发出）"""
    if client is None:
        client = FakeTutorClient(deltas=[answer] if answer is not None else [])
    request = _request(**request_overrides)
    chapter_id, plan_version = extract_tutor_envelope_ids(request)
    return asyncio.run(_collect_tutor(
        stream_tutor_events(request, chapter_id, plan_version, client=client)
    ))


def test_tutor_event_order_and_utf8():
    events = list(fake_tutor_events(answer='ETag 可以理解为版本指纹'))
    assert [event['type'] for event in events] == [
        'tutor_started', 'tutor_block_started', 'tutor_block_delta',
        'tutor_block_completed', 'tutor_completed', 'request_completed',
    ]
    assert any('版本指纹' in json.dumps(event, ensure_ascii=False) for event in events)


def test_tutor_llm_failure_returns_retryable_error():
    error = classify_tutor_error(TimeoutError())
    assert error.code == 'LLM_TIMEOUT'
    assert error.retryable is True


def test_tutor_envelope_fields_and_sequence():
    """外壳字段：章节/版本从幂等键解析，courseId 回填请求值，任务/问题守卫字段齐全，sequence 严格递增"""
    events = list(fake_tutor_events(answer='304 只回包头不回正文。'))
    request_id = events[0]["requestId"]
    assert request_id.startswith("req-")
    for index, event in enumerate(events, 1):
        assert event["eventId"] == f"{request_id}:{index}"
        assert event["sequence"] == index
        assert event["chapterId"] == "ch-1"      # 解析自幂等键
        assert event["planVersion"] == 1
        assert event["taskId"] == "task-1"
        assert event["questionId"] == "q-1"
        assert event["courseId"] == "course-1"   # 事件外壳 courseId 回填请求携带的真实值
        assert isinstance(event["timestamp"], int)

    assert events[0]["payload"] == {"questionId": "q-1"}
    assert events[1]["payload"] == {"blockId": BLOCK_ID}
    assert events[2]["payload"] == {"blockId": BLOCK_ID, "delta": "304 只回包头不回正文。"}
    assert events[3]["payload"]["block"] == {
        "type": "markdown", "blockId": BLOCK_ID, "markdown": "304 只回包头不回正文。",
    }

    # tutor_completed = InlineTutorResponse 形状：questionId + markdown-only blocks + generationMeta
    completed = events[4]["payload"]
    assert completed["questionId"] == "q-1"
    assert completed["blocks"] == [
        {"type": "markdown", "blockId": BLOCK_ID, "markdown": "304 只回包头不回正文。"},
    ]
    meta = completed["generationMeta"]
    assert meta["promptVersion"] == "inline-tutor-v1"
    assert meta["modelVersion"] == "fake-model"
    assert meta["degraded"] is False
    assert isinstance(meta["generatedAt"], int)
    assert isinstance(meta["durationMs"], int)

    assert events[5]["payload"]["requestId"] == request_id
    assert events[5]["payload"]["status"] == "completed"

    # 证据红线：任何事件载荷都不得携带 evidence
    assert all("evidence" not in event["payload"] for event in events)


def test_tutor_multiple_deltas_accumulate_into_single_markdown_block():
    """LLM 输出只进 tutor_block_delta；多个增量累积为同一个固定 blockId 的块"""
    events = fake_tutor_events(client=FakeTutorClient(deltas=["304 ", "没有正文，", "只有包头。"]))
    types = [event["type"] for event in events]
    assert types.count("tutor_block_delta") == 3
    assert types.count("tutor_block_completed") == 1
    assert all(
        event["payload"]["blockId"] == BLOCK_ID
        for event in events
        if event["type"] in ("tutor_block_started", "tutor_block_delta")
    )
    block_completed = next(e for e in events if e["type"] == "tutor_block_completed")
    assert block_completed["payload"]["block"]["markdown"] == "304 没有正文，只有包头。"


def test_tutor_llm_timeout_before_stream_emits_error_events():
    """流开始前超时 → request_error(LLM_TIMEOUT, retryable) + request_completed(failed)"""
    events = fake_tutor_events(client=FakeTutorClient(error=httpx.ReadTimeout("timeout")))
    assert [event["type"] for event in events] == [
        "tutor_started", "tutor_block_started", "request_error", "request_completed",
    ]
    assert events[2]["payload"]["code"] == "LLM_TIMEOUT"
    assert events[2]["payload"]["retryable"] is True
    assert events[2]["payload"]["message"]  # 中文可展示消息
    assert events[3]["payload"]["status"] == "failed"
    assert events[3]["payload"]["errorCode"] == "LLM_TIMEOUT"


def test_tutor_stream_broken_midway_keeps_emitted_deltas():
    """流中断（已有增量）→ UPSTREAM_STREAM_BROKEN，已发增量保留在序列中"""
    client = FakeTutorClient(deltas=["第一句。", "第二句。"], error=httpx.ReadError("boom"), error_after=1)
    events = fake_tutor_events(client=client)
    assert [event["type"] for event in events] == [
        "tutor_started", "tutor_block_started", "tutor_block_delta",
        "request_error", "request_completed",
    ]
    assert events[3]["payload"]["code"] == "UPSTREAM_STREAM_BROKEN"
    assert events[3]["payload"]["retryable"] is True
    assert events[4]["payload"]["errorCode"] == "UPSTREAM_STREAM_BROKEN"
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))


def test_tutor_empty_answer_emits_empty_content_error():
    """累积内容为空 → EMPTY_CONTENT + failed"""
    events = fake_tutor_events(client=FakeTutorClient(deltas=[]))
    assert events[-2]["payload"]["code"] == "EMPTY_CONTENT"
    assert events[-2]["payload"]["retryable"] is True
    assert events[-1]["payload"]["status"] == "failed"


def test_tutor_envelope_course_id_matches_request():
    """事件外壳 courseId 取自请求携带值（普通请求字段，不进入幂等键格式）"""
    events = fake_tutor_events(answer='回答', courseId='course-42')
    assert all(event["courseId"] == "course-42" for event in events)


def test_extract_tutor_envelope_ids_from_idempotency_key():
    chapter_id, plan_version = extract_tutor_envelope_ids(_request())
    assert chapter_id == "ch-1"
    assert plan_version == 1


def test_extract_tutor_envelope_ids_rejects_bad_or_inconsistent_key():
    """幂等键格式无效或与请求任务/问题不一致 → 端点层 422 前置错误"""
    with pytest.raises(TutorRequestDataError):
        extract_tutor_envelope_ids(_request(idempotencyKey="task:ch-1:v1:task-1:q-1"))
    with pytest.raises(TutorRequestDataError):
        extract_tutor_envelope_ids(_request(idempotencyKey="tutor:ch-1:v1:task-OTHER:q-1"))
    with pytest.raises(TutorRequestDataError):
        extract_tutor_envelope_ids(_request(idempotencyKey="tutor:ch-1:v1:task-1:q-OTHER"))
    with pytest.raises(TutorRequestDataError):
        extract_tutor_envelope_ids(_request(idempotencyKey=""))


def test_classify_tutor_error_covers_llm_failure_modes():
    """全部 LLM 失败模式都得到稳定 code、中文 message 且可重试"""
    timeout = classify_tutor_error(httpx.ReadTimeout("timeout"))
    assert (timeout.code, timeout.retryable) == ("LLM_TIMEOUT", True)

    response = httpx.Response(429, request=httpx.Request("POST", "http://llm.local/chat"))
    limited = classify_tutor_error(
        httpx.HTTPStatusError("429", request=response.request, response=response)
    )
    assert (limited.code, limited.retryable) == ("LLM_RATE_LIMITED", True)

    unavailable = classify_tutor_error(httpx.ConnectError("refused"))
    assert (unavailable.code, unavailable.retryable) == ("LLM_UNAVAILABLE", True)

    generic = classify_tutor_error(RuntimeError("boom"))
    assert (generic.code, generic.retryable) == ("UPSTREAM_ERROR", True)

    for error in (timeout, limited, unavailable, generic):
        assert error.message  # 用户可见中文消息非空
        assert "http" not in error.message.lower()  # 不泄露内部 URL


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
