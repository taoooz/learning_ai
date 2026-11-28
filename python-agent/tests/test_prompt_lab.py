import json

from fastapi.testclient import TestClient

from schemas.prompt_lab import PromptLabAssistantRequest, PromptLabRunRequest
from services.prompt_lab_service import (
    compile_prompt_lab_stage,
    run_prompt_lab_assistant,
    run_prompt_lab_stream,
)
from tests.test_chapter_plan import _blueprint, _valid_tasks
from tests.test_course_architecture import (
    _valid_architecture,
    _valid_chapter_plan,
    _valid_meta,
)
from lib.tools.memory_tools import create_memory_search


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
        assert "提示词工程实践" not in compiled["systemPrompt"]

    meta = compile_prompt_lab_stage("architect_meta", _stage_inputs("architect_meta"))
    assert "c1-business-to-objective" in meta["userMessage"] or "c1" in meta["userMessage"]
    assert "untrusted_context_data" in meta["userMessage"]
    assert "<input_context>" not in meta["systemPrompt"]


def test_prompt_lab_splits_static_system_and_dynamic_user_context():
    outline = compile_prompt_lab_stage("outline_initial", _stage_inputs("outline_initial"))
    assert "<critical_rules>" in outline["systemPrompt"]
    assert "提示词工程实践" not in outline["systemPrompt"]
    assert "提示词工程实践" in outline["userMessage"]

    chapters = compile_prompt_lab_stage("architect_chapters", _stage_inputs("architect_chapters"))
    assert "<stage_contract>" in chapters["systemPrompt"]
    assert "<input_context>" not in chapters["systemPrompt"]
    assert "<input_context>" in chapters["userMessage"]
    assert "提示词工程实践" in chapters["userMessage"]

    chapter_plan = compile_prompt_lab_stage("chapter_plan", _stage_inputs("chapter_plan"))
    assert "<chapter_context>" not in chapter_plan["systemPrompt"]
    assert "<chapter_context>" in chapter_plan["userMessage"]
    assert "<output_format>" in chapter_plan["systemPrompt"]
    assert "<goal_alignment>" in chapter_plan["systemPrompt"]
    assert "指令写作基础" in chapter_plan["userMessage"]

    task_content = compile_prompt_lab_stage("task_content", _stage_inputs("task_content"))
    assert "<task_context>" not in task_content["systemPrompt"]
    assert "<task_context>" in task_content["userMessage"]
    assert "<output_format>" in task_content["systemPrompt"]
    assert "浏览器缓存就像便利店的临期食品折扣" in task_content["systemPrompt"]
    assert "指令为什么需要说清楚" in task_content["userMessage"]


class FakeAgentClient:
    model = "fake-prompt-lab"
    last_instance = None

    def __init__(self):
        self.tools = []
        FakeAgentClient.last_instance = self

    def stream_chat_with_tools(self, messages, tools, tool_functions, **kwargs):
        self.tools = tools
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
        tools_enabled=True,
        max_tokens=1000,
    )
    events = []
    client = service.AgentClient()
    for raw in run_prompt_lab_stream(request, account_id="account-1"):
        if not raw.startswith("data: "):
            continue
        body = raw[6:].strip()
        if body != "[DONE]":
            events.append(json.loads(body))

    assert [event["type"] for event in events] == ["thinking", "content_delta", "parsed", "metrics"]
    assert events[2]["validation"]["valid"] is True
    assert len(events[2]["parsed"]["chapters"]) == 2
    assert "memory_search" in {
        tool["function"]["name"]
        for tool in FakeAgentClient.last_instance.tools
    }


def test_prompt_lab_memory_snapshot_uses_read_only_planning_payload(monkeypatch):
    import routers.prompt_lab as router_module
    from main import app

    monkeypatch.setenv("PYTHON_INTERNAL_TOKEN", "prompt-lab-token")
    monkeypatch.setattr(router_module, "MemoryV4Store", lambda: object())
    monkeypatch.setattr(
        router_module,
        "safe_resolve_memory_context",
        lambda *_args, **_kwargs: {"scene": "course_planning"},
    )
    monkeypatch.setattr(
        router_module,
        "to_planning_prompt_payload",
        lambda *_args, **_kwargs: {
            "userProfile": {"targetJob": "产品经理", "insights": {"summary": "有推荐经验"}},
            "planningMemory": {"learnerSnapshot": {"estimatedLevel": "intermediate"}},
        },
    )

    response = TestClient(app).post(
        "/api/debug/course-pipeline/memory-snapshot",
        json={"topic": "推荐系统"},
        headers={"X-Internal-Token": "prompt-lab-token", "X-Account-Id": "account-1"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "server_memory_v4"
    assert body["userProfile"]["targetJob"] == "产品经理"
    assert body["planningMemory"]["learnerSnapshot"]["estimatedLevel"] == "intermediate"


def test_prompt_lab_gate_blocks_production_without_flag(monkeypatch):
    from main import app

    monkeypatch.setenv("PYTHON_INTERNAL_TOKEN", "prompt-lab-token")
    monkeypatch.setenv("ENV", "production")
    monkeypatch.delenv("ENABLE_PROMPT_DEBUGGER", raising=False)
    response = TestClient(app).post(
        "/api/debug/course-pipeline/memory-snapshot",
        json={"topic": "推荐系统"},
        headers={"X-Internal-Token": "prompt-lab-token", "X-Account-Id": "account-1"},
    )
    assert response.status_code == 404


def test_prompt_lab_gate_allows_production_with_flag(monkeypatch):
    import routers.prompt_lab as router_module
    from main import app

    monkeypatch.setenv("PYTHON_INTERNAL_TOKEN", "prompt-lab-token")
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("ENABLE_PROMPT_DEBUGGER", "1")
    monkeypatch.setattr(router_module, "MemoryV4Store", lambda: object())
    monkeypatch.setattr(
        router_module,
        "safe_resolve_memory_context",
        lambda *_args, **_kwargs: {"scene": "course_planning"},
    )
    monkeypatch.setattr(
        router_module,
        "to_planning_prompt_payload",
        lambda *_args, **_kwargs: {"userProfile": {}, "planningMemory": {}},
    )
    response = TestClient(app).post(
        "/api/debug/course-pipeline/memory-snapshot",
        json={"topic": "推荐系统"},
        headers={"X-Internal-Token": "prompt-lab-token", "X-Account-Id": "account-1"},
    )
    assert response.status_code == 200


def test_prompt_lab_memory_search_returns_content_without_record_ids(monkeypatch):
    import lib.tools.memory_tools as memory_tools

    class FakeStore:
        def load_store(self, _account_id):
            return {
                "records": [
                    {
                        "memoryId": "mem-secret-1",
                        "status": "active",
                        "kind": "fact",
                        "title": "推荐系统工作经验",
                        "summary": "参与过召回和重排",
                        "content": "负责过推荐位与重排规则设计",
                        "conceptKeys": ["召回", "重排"],
                        "tags": ["work"],
                        "importance": 0.8,
                    },
                ],
            }

    monkeypatch.setattr(memory_tools, "MemoryV4Store", lambda: FakeStore())
    # R6 渐进式披露：正文需显式 detail="full"；本例校验正文不泄漏 record ID。
    result = create_memory_search("account-1")("推荐 重排", detail="full")
    assert "负责过推荐位与重排规则设计" in result
    assert "mem-secret-1" not in result


class FakeAssistantClient:
    def __init__(self):
        self.messages = None

    def chat_with_tools(self, messages, tools, tool_functions, **kwargs):
        self.messages = messages
        return {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "answer": "输出规范应放在 system prompt。",
                        "score": 76,
                        "issues": ["输出格式被放进了 user prompt"],
                        "suggestions": ["把 output_format 与示例移回 system"],
                        "revisedSystemPrompt": "修订后的 system prompt",
                        "revisedUserMessage": "修订后的 user prompt",
                    }, ensure_ascii=False),
                },
            }],
        }


def test_prompt_lab_assistant_uses_stage_context_and_returns_revision(monkeypatch):
    import services.prompt_lab_service as service

    fake = FakeAssistantClient()
    monkeypatch.setattr(service, "AgentClient", lambda: fake)
    request = PromptLabAssistantRequest(
        stage="task_content",
        action="optimize_prompt",
        message="把输出规范放回 system",
        context={
            "stageTitle": "任务正文生成",
            "systemPrompt": "当前 system",
            "userMessage": "当前 user",
            "lastRun": {"content": "模型输出"},
        },
    )
    result = run_prompt_lab_assistant(request)
    assert result["score"] == 76
    assert result["revisedSystemPrompt"] == "修订后的 system prompt"
    assert "任务正文生成" in fake.messages[0]["content"]
    assert "把输出规范放回 system" in fake.messages[-1]["content"]
