import json

from schemas.prompt_lab import PromptLabRunRequest
from services.prompt_lab_service import (
    compile_prompt_lab_stage,
    run_prompt_lab_stream,
)
from tests.test_chapter_plan import _blueprint, _valid_tasks
from tests.test_course_architecture import (
    _valid_architecture,
    _valid_chapter_plan,
    _valid_meta,
)


def _task_request() -> dict:
    return {
        "courseId": "course-1",
        "chapterId": "ch-1",
        "planId": "plan-1",
        "planVersion": 1,
        "taskId": "t1",
        "attempt": 1,
        "task": {
            "taskId": "t1",
            "title": "指令为什么需要说清楚",
            "taskGoal": "理解指令三要素",
            "teachingPattern": "explain",
            "observableOutcome": "能说出好指令包含什么",
        },
        "chapter": {"title": "指令写作基础", "teachingGoal": "理解指令的基本结构"},
        "courseTopic": "提示词工程实践",
        "learnerStartingPoint": {
            "estimatedLevel": "beginner",
            "confirmedKnowledge": ["会用基础对话"],
            "likelyGaps": ["不清楚上下文机制"],
        },
    }


def _stage_inputs(stage: str) -> dict:
    outline = _valid_architecture()
    learner = outline["thesis"]
    base = {
        "topic": "提示词工程实践",
        "userProfile": {"summary": "产品经理"},
        "planningMemory": {},
        "outline": {
            "learningDirection": "提示词工程实践",
            "learningGoal": "写出结构清晰的提示词",
            "learnerPositioning": {"estimatedLevel": "intermediate"},
        },
        "learner": {"estimatedLevel": "intermediate", "backgroundSummary": "有产品经验"},
        "chapterPlan": _valid_chapter_plan(),
        "architecture": _valid_architecture(),
        "blueprint": _blueprint(),
        "chapterId": "ch-1",
        "tasks": _valid_tasks(),
        "request": _task_request(),
    }
    if stage == "outline_answer":
        base["answers"] = [{"questionId": "1", "answer": "参与过实际工作"}]
    return base


def test_compile_prompt_lab_reuses_all_production_builders():
    stages = [
        "outline_initial",
        "outline_answer",
        "architect_chapters",
        "architect_meta",
        "architect_review",
        "chapter_plan",
        "chapter_plan_review",
        "task_search_decision",
        "task_content",
    ]
    for stage in stages:
        compiled = compile_prompt_lab_stage(stage, _stage_inputs(stage))
        assert compiled["systemPrompt"].strip()
        assert compiled["userMessage"].strip()
        assert compiled["config"]["maxTokens"] > 0

    meta = compile_prompt_lab_stage("architect_meta", _stage_inputs("architect_meta"))
    assert "c1-business-to-objective" in meta["systemPrompt"] or "c1" in meta["systemPrompt"]
    assert "untrusted_context_data" in meta["systemPrompt"]


class FakeAgentClient:
    model = "fake-prompt-lab"

    def stream_chat_with_tools(self, messages, tools, tool_functions, **kwargs):
        payload = _valid_chapter_plan()
        yield {"type": "thinking", "message": "先设计章节。"}
        yield {"type": "content_delta", "content": json.dumps(payload, ensure_ascii=False)}
        yield {"type": "done", "finish_reason": "stop"}


def test_run_prompt_lab_streams_and_parses_structured_output(monkeypatch):
    import services.prompt_lab_service as service

    monkeypatch.setattr(service, "AgentClient", FakeAgentClient)
    request = PromptLabRunRequest(
        stage="architect_chapters",
        inputs=_stage_inputs("architect_chapters"),
        system_prompt="测试 system",
        user_message="生成章节",
        tools_enabled=False,
        max_tokens=1000,
    )
    events = []
    for raw in run_prompt_lab_stream(request):
        if not raw.startswith("data: "):
            continue
        body = raw[6:].strip()
        if body != "[DONE]":
            events.append(json.loads(body))

    assert [event["type"] for event in events] == ["thinking", "content_delta", "parsed", "metrics"]
    assert events[2]["validation"]["valid"] is True
    assert len(events[2]["parsed"]["chapters"]) == 2
