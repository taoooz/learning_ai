import asyncio
import json

import pytest

from schemas.learning_v2 import ChapterRecapRequest
from services.chapter_recap_service import generate_chapter_recap
from services.learning_v2_errors import RecapValidationError


def _recap_request(**overrides) -> ChapterRecapRequest:
    """构造标准 Recap 请求"""
    base = dict(
        courseId="course-1",
        chapterId="ch-1",
        planId="plan-1",
        planVersion=1,
        courseTopic="提示词工程实践",
        chapter={"title": "指令写作基础", "teachingGoal": "理解指令的基本结构"},
        tasks=[
            {"title": "指令为什么需要说清楚", "takeaway": "好指令包含明确的要求与背景"},
            {"title": "上下文如何影响输出", "takeaway": "上下文决定模型看到的约束"},
            {"title": "写一条带上下文的要求", "takeaway": None},
        ],
        nextChapterTitle="进阶：结构化输出",
    )
    base.update(overrides)
    return ChapterRecapRequest(**base)


class FakeChatClient:
    """假 LLM 客户端：chat 依次返回预置内容包装成的 OpenAI 格式响应"""
    model = "fake-model"

    def __init__(self, payloads: list[dict | str]):
        self.responses = [self._wrap(p) for p in payloads]
        self.calls: list[list[dict]] = []

    @staticmethod
    def _wrap(payload: dict | str) -> dict:
        content = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
        return {"choices": [{"message": {"content": content}}]}

    async def chat(self, messages: list[dict], model=None, max_tokens=1500) -> dict:
        self.calls.append(messages)
        return self.responses.pop(0)


def _valid_output(**overrides) -> dict:
    return {
        "keyTakeaways": ["好指令要写清要求", "上下文决定模型的约束", "动手写过一条完整指令"],
        "recommendedReview": "可以回头再写一条指令巩固",
        "nextChapterPreview": "下一章解决输出格式不稳定的问题",
        **overrides,
    }


def test_success_shape_and_generation_meta():
    """正常生成：字段齐全、chapterId 回显、generationMeta 与计划端点同范式"""
    client = FakeChatClient([_valid_output()])
    recap = asyncio.run(generate_chapter_recap(_recap_request(), client=client))

    assert recap["chapterId"] == "ch-1"
    assert recap["keyTakeaways"] == ["好指令要写清要求", "上下文决定模型的约束", "动手写过一条完整指令"]
    assert recap["recommendedReview"] == "可以回头再写一条指令巩固"
    assert recap["nextChapterPreview"] == "下一章解决输出格式不稳定的问题"

    meta = recap["generationMeta"]
    assert meta["promptVersion"] == "chapter_recap_v2"
    assert meta["modelVersion"] == "fake-model"
    assert meta["degraded"] is False
    assert isinstance(meta["generatedAt"], int)
    assert isinstance(meta["durationMs"], int)
    assert len(client.calls) == 1

    # prompt 输入段包含任务标题与要点
    system_prompt = client.calls[0][0]["content"]
    assert "指令为什么需要说清楚" in system_prompt
    assert "好指令包含明确的要求与背景" in system_prompt
    assert "进阶：结构化输出" in system_prompt


def test_evidence_fields_deterministically_empty():
    """证据红线（画像 §7.1）：模型偷产掌握度字段也一律由服务端置空"""
    sneaky = _valid_output(
        demonstratedObjectives=["obj-1"],
        fragileObjectives=["obj-2"],
        unresolvedQuestions=["什么是上下文"],
    )
    client = FakeChatClient([sneaky])
    recap = asyncio.run(generate_chapter_recap(_recap_request(), client=client))
    assert recap["demonstratedObjectives"] == []
    assert recap["fragileObjectives"] == []
    assert recap["unresolvedQuestions"] == []


def test_optional_fields_normalization():
    """可选字段：空白字符串归一为 None；缺省也是 None"""
    client = FakeChatClient([_valid_output(recommendedReview="   ", nextChapterPreview=None)])
    recap = asyncio.run(generate_chapter_recap(_recap_request(), client=client))
    assert recap["recommendedReview"] is None
    assert recap["nextChapterPreview"] is None


def test_takeaways_truncated_at_cap():
    """keyTakeaways 超过上限直接截断，不触发重试"""
    many = _valid_output(keyTakeaways=[f"要点{i}" for i in range(12)])
    client = FakeChatClient([many])
    recap = asyncio.run(generate_chapter_recap(_recap_request(), client=client))
    assert len(recap["keyTakeaways"]) == 8
    assert len(client.calls) == 1


def test_retry_once_then_success():
    """首版 keyTakeaways 为空 → 带修复提示重试一次后成功"""
    client = FakeChatClient([_valid_output(keyTakeaways=[]), _valid_output()])
    recap = asyncio.run(generate_chapter_recap(_recap_request(), client=client))
    assert len(client.calls) == 2
    assert len(recap["keyTakeaways"]) == 3

    retry_message = client.calls[1][1]["content"]
    assert "EMPTY_TAKEAWAYS" in retry_message


def test_retry_exhausted_raises():
    """重试仍失败时抛 RecapValidationError 并携带错误列表"""
    bad = _valid_output(keyTakeaways=[123])
    client = FakeChatClient([bad, bad])
    with pytest.raises(RecapValidationError) as excinfo:
        asyncio.run(generate_chapter_recap(_recap_request(), client=client))
    assert len(client.calls) == 2
    codes = {e["code"] for e in excinfo.value.errors}
    assert "INVALID_TAKEAWAY_ENTRY" in codes


def test_invalid_json_retries_then_raises():
    """模型输出不是合法 JSON 时触发重试，仍失败抛错"""
    client = FakeChatClient(["抱歉，我无法生成。", "还是不行。"])
    with pytest.raises(RecapValidationError) as excinfo:
        asyncio.run(generate_chapter_recap(_recap_request(), client=client))
    codes = {e["code"] for e in excinfo.value.errors}
    assert "INVALID_JSON" in codes


def test_empty_tasks_section_fallback():
    """没有任何任务要点时 prompt 段走兜底文案，生成仍正常"""
    client = FakeChatClient([_valid_output()])
    recap = asyncio.run(generate_chapter_recap(_recap_request(tasks=[]), client=client))
    assert recap["chapterId"] == "ch-1"
    assert "（本章没有任务要点记录）" in client.calls[0][0]["content"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
