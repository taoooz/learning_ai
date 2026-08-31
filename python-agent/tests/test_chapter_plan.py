import asyncio
import json

import pytest

from schemas.learning_v2 import ChapterPlanRequest, TaskStreamRequest
from services.chapter_plan_service import generate_chapter_plan
from services.learning_v2_errors import (
    BlueprintDataError,
    ChapterNotFoundError,
    PlanValidationError,
)


def _blueprint() -> dict:
    """构造一个最小可用的 CourseBlueprintV2"""
    return {
        "blueprintId": "bp-course-1",
        "protocolVersion": 2,
        "topic": "提示词工程实践",
        "intentType": "skill_mastery",
        "targetScenario": "日常写提示词",
        "learnerStartingPoint": {
            "estimatedLevel": "beginner",
            "confirmedKnowledge": ["会用基础对话"],
            "likelyGaps": ["不清楚上下文机制"],
            "excludedTopics": [],
        },
        "courseObjectives": [
            {
                "objectiveId": "obj-1",
                "description": "能写出要求清晰的指令",
                "observableOutcome": "能写出让模型按要求输出的指令",
                "importance": "core",
                "evidenceRequirement": "exposure",
                "conceptKeys": ["指令"],
            },
            {
                "objectiveId": "obj-2",
                "description": "能给模型提供上下文",
                "observableOutcome": "能说明上下文对输出的影响",
                "importance": "supporting",
                "evidenceRequirement": "exposure",
                "conceptKeys": ["上下文"],
            },
        ],
        "successCriteria": [],
        "chapters": [
            {
                "chapterId": "ch-1",
                "index": 1,
                "title": "指令写作基础",
                "objectiveIds": ["obj-1", "obj-2"],
                "prerequisites": [],
                "teachingGoal": "理解指令的基本结构",
                "completionCriteria": [],
            },
        ],
        "createdAt": 1700000000000,
        "promptVersion": "blueprint-map-v1",
        "modelVersion": "derived-none",
    }


def _plan_request(blueprint: dict | None = None, chapter_id: str = "ch-1") -> ChapterPlanRequest:
    return ChapterPlanRequest(courseId="course-1", chapterId=chapter_id, blueprint=blueprint or _blueprint())


def _valid_tasks() -> list[dict]:
    """覆盖 obj-1/obj-2 的合法 3 任务"""
    return [
        {
            "taskId": "t1", "order": 1, "title": "指令为什么需要说清楚", "objectiveId": "obj-1",
            "taskGoal": "理解指令三要素", "observableOutcome": "能说出好指令包含什么",
            "conceptKeys": ["指令"], "prerequisiteTaskIds": [], "teachingPattern": "explain", "expectedMinutes": 3,
        },
        {
            "taskId": "t2", "order": 2, "title": "上下文如何影响输出", "objectiveId": "obj-2",
            "taskGoal": "理解上下文的作用", "observableOutcome": "能解释上下文对输出的影响",
            "conceptKeys": ["上下文"], "prerequisiteTaskIds": ["t1"], "teachingPattern": "compare", "expectedMinutes": 4,
        },
        {
            "taskId": "t3", "order": 3, "title": "写一条带上下文的要求", "objectiveId": "obj-1",
            "taskGoal": "动手写一条完整指令", "observableOutcome": "能写出一条包含要求与上下文的指令",
            "conceptKeys": ["指令", "上下文"], "prerequisiteTaskIds": ["t2"], "teachingPattern": "practice", "expectedMinutes": 5,
        },
    ]


class FakeChatClient:
    """假 LLM 客户端：chat 依次返回预置任务列表包装成的 OpenAI 格式响应"""
    model = "fake-model"

    def __init__(self, task_lists: list[list[dict]]):
        self.responses = [self._wrap(tasks) for tasks in task_lists]
        self.calls: list[list[dict]] = []

    @staticmethod
    def _wrap(tasks: list[dict]) -> dict:
        content = json.dumps({"tasks": tasks}, ensure_ascii=False)
        return {"choices": [{"message": {"content": content}}]}

    async def chat(self, messages: list[dict], model=None, max_tokens=1500) -> dict:
        self.calls.append(messages)
        return self.responses.pop(0)


def test_generate_plan_success_fills_fields():
    """正常生成：计划字段补齐、固定字段写入、事件字段与 TS 契约对齐"""
    client = FakeChatClient([_valid_tasks()])
    plan = asyncio.run(generate_chapter_plan(_plan_request(), client=client))

    assert plan["chapterId"] == "ch-1"
    assert plan["planId"].startswith("plan-")
    assert plan["planVersion"] == 1
    assert plan["status"] == "active"
    assert plan["objectiveIds"] == ["obj-1", "obj-2"]
    assert isinstance(plan["createdAt"], int)
    assert plan["createdAt"] == plan["updatedAt"]

    meta = plan["generationMeta"]
    assert meta["promptVersion"] == "chapter-plan-v1"
    assert meta["modelVersion"] == "fake-model"
    assert meta["degraded"] is False
    assert isinstance(meta["generatedAt"], int)
    assert isinstance(meta["durationMs"], int)

    tasks = plan["tasks"]
    assert [t["taskId"] for t in tasks] == ["t1", "t2", "t3"]
    assert [t["order"] for t in tasks] == [1, 2, 3]
    for task in tasks:
        assert task["evidencePolicy"] == "none"
        assert task["origin"] == "initial"
        assert task["status"] == "planned"
    assert tasks[0]["prerequisiteTaskIds"] == []
    assert tasks[1]["prerequisiteTaskIds"] == ["t1"]
    assert tasks[2]["prerequisiteTaskIds"] == ["t2"]
    assert len(client.calls) == 1


def test_task_id_filled_from_order():
    """模型漏写 taskId 时应按 t{order} 补齐"""
    raw = [{k: v for k, v in task.items() if k != "taskId"} for task in _valid_tasks()]
    client = FakeChatClient([raw])
    plan = asyncio.run(generate_chapter_plan(_plan_request(), client=client))
    assert [t["taskId"] for t in plan["tasks"]] == ["t1", "t2", "t3"]


def test_invalid_prereq_falls_back_to_linear():
    """前置依赖引用不存在的任务时退化为线性链"""
    raw = _valid_tasks()
    raw[1]["prerequisiteTaskIds"] = ["ghost"]
    client = FakeChatClient([raw])
    plan = asyncio.run(generate_chapter_plan(_plan_request(), client=client))
    assert plan["tasks"][1]["prerequisiteTaskIds"] == ["t1"]


def test_retry_once_then_success():
    """首版校验失败（任务 ID 重复 + 目标未覆盖）→ 带修复提示重试一次后成功"""
    bad = _valid_tasks()[:2]
    bad[1] = {**bad[1], "taskId": "t1", "objectiveId": "obj-1"}  # 重复 ID，且 obj-2 未被覆盖
    client = FakeChatClient([bad, _valid_tasks()])

    plan = asyncio.run(generate_chapter_plan(_plan_request(), client=client))
    assert len(client.calls) == 2
    assert [t["taskId"] for t in plan["tasks"]] == ["t1", "t2", "t3"]

    # 第二次调用的 user message 应带修复提示
    retry_message = client.calls[1][1]["content"]
    assert "DUPLICATE_TASK_ID" in retry_message
    assert "OBJECTIVE_NOT_COVERED" in retry_message


def test_retry_exhausted_raises():
    """重试仍失败时抛 PlanValidationError 并携带错误列表"""
    bad = [{**t, "taskGoal": ""} for t in _valid_tasks()]
    client = FakeChatClient([bad, bad])

    with pytest.raises(PlanValidationError) as excinfo:
        asyncio.run(generate_chapter_plan(_plan_request(), client=client))
    assert len(client.calls) == 2
    codes = {e["code"] for e in excinfo.value.errors}
    assert "EMPTY_TASK_FIELD" in codes


def test_empty_tasks_errors():
    """任务数为 0 是硬错误，重试两次后抛错"""
    client = FakeChatClient([[], []])
    with pytest.raises(PlanValidationError) as excinfo:
        asyncio.run(generate_chapter_plan(_plan_request(), client=client))
    codes = {e["code"] for e in excinfo.value.errors}
    assert "TASK_COUNT_OUT_OF_RANGE" in codes


def test_invalid_json_retries_then_raises():
    """模型输出不是合法 JSON 时触发重试，仍失败抛错"""
    class BadJsonClient(FakeChatClient):
        def __init__(self):
            super().__init__([])
            self.responses = [{"choices": [{"message": {"content": "抱歉，我无法生成。"}}]}] * 2

    with pytest.raises(PlanValidationError) as excinfo:
        asyncio.run(generate_chapter_plan(_plan_request(), client=BadJsonClient()))
    codes = {e["code"] for e in excinfo.value.errors}
    assert "INVALID_JSON" in codes


def test_two_tasks_passes_with_warning_only():
    """任务数 2 只是软约束告警，不阻断生成"""
    client = FakeChatClient([_valid_tasks()[:2]])
    plan = asyncio.run(generate_chapter_plan(_plan_request(), client=client))
    assert len(plan["tasks"]) == 2
    assert len(client.calls) == 1


def test_chapter_not_found_raises():
    """蓝图里没有目标章节时抛业务错误"""
    request = _plan_request(chapter_id="ch-999")
    with pytest.raises(ChapterNotFoundError):
        asyncio.run(generate_chapter_plan(request, client=FakeChatClient([])))


def test_objective_reference_missing_raises():
    """章节引用了不存在的课程目标时抛业务错误"""
    blueprint = _blueprint()
    blueprint["chapters"][0]["objectiveIds"] = ["obj-x"]
    with pytest.raises(BlueprintDataError):
        asyncio.run(generate_chapter_plan(_plan_request(blueprint), client=FakeChatClient([])))


def test_request_schema_defaults():
    """请求模型默认值：idempotencyKey 可空、previousTasks 默认空列表"""
    plan_req = ChapterPlanRequest(courseId="c", chapterId="ch", blueprint={})
    assert plan_req.idempotencyKey is None

    task_req = TaskStreamRequest(
        courseId="c", chapterId="ch", planId="p", planVersion=1, taskId="t1", attempt=1,
        task={"taskId": "t1", "title": "标题", "taskGoal": "目标", "teachingPattern": "explain", "observableOutcome": "结果"},
        chapter={"title": "章节", "teachingGoal": "章节目标"},
        courseTopic="主题",
        learnerStartingPoint={"estimatedLevel": "beginner"},
    )
    assert task_req.previousTasks == []
    assert task_req.nextTaskTitle is None
    assert task_req.idempotencyKey is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
