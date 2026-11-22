import asyncio
import json

from schemas.course_architecture import CourseArchitecture, validate_course_architecture
from services.course_architect_service import (
    build_course_architect_prompt,
    _complete_chapter_objects,
    generate_course_architecture,
    should_review_architecture,
    stream_course_architecture,
)


def _valid_architecture() -> dict:
    return {
        "architectureVersion": 1,
        "courseTopic": "推荐系统核心链路",
        "thesis": {
            "audience": "有内容运营背景、懂基本指标的学习者",
            "currentBoundary": ["能配置推荐位", "还不能独立判断召回与排序问题"],
            "targetCapability": "能定位推荐问题所在链路并提出验证方案",
            "learningDelta": ["从看报表到判断链路边界", "从经验决策到指标验证"],
            "nonGoals": ["不从零讲推荐系统历史"],
        },
        "conceptGraph": [
            {
                "conceptId": "c1",
                "label": "召回与排序边界",
                "targetDepth": "apply",
                "rationale": "这是定位问题和选择指标的前提",
                "prerequisiteConceptIds": [],
                "evidenceIds": ["ev-01"],
            },
            {
                "conceptId": "c2",
                "label": "评估指标",
                "targetDepth": "transfer",
                "rationale": "需要能在新场景选择指标",
                "prerequisiteConceptIds": ["c1"],
                "evidenceIds": [],
            },
        ],
        "chapters": [
            {
                "chapterId": "ch-1",
                "title": "推荐链路职责边界",
                "roleInCourse": "建立召回、排序、重排的诊断框架",
                "conceptIds": ["c1"],
                "deliverable": "能判断一个推荐问题属于哪个链路环节",
                "prerequisites": [],
                "assessmentMode": "checkpoint",
            },
            {
                "chapterId": "ch-2",
                "title": "推荐效果评估",
                "roleInCourse": "把业务问题转成可验证指标",
                "conceptIds": ["c2"],
                "deliverable": "能为一个推荐问题设计离线与在线验证方案",
                "prerequisites": ["ch-1"],
                "assessmentMode": "checkpoint",
            },
        ],
        "examplePolicy": {
            "preferredDomains": ["内容平台", "电商推荐"],
            "personalExampleLimit": 1,
            "avoidRepeatedScenarios": True,
        },
    }


class FakeArchitectClient:
    model = "fake-architect"

    def __init__(self, responses: list[dict], review_responses: list[dict] | None = None):
        self.responses = responses
        self.review_responses = review_responses or []
        self.calls = []
        self.review_calls = []

    def chat_with_tools(self, messages, tools, tool_functions, **kwargs):
        self.calls.append(messages)
        payload = self.responses.pop(0)
        return {"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}]}

    async def chat(self, messages, model=None, max_tokens=1500):
        self.review_calls.append(messages)
        payload = self.review_responses.pop(0) if self.review_responses else {
            "passed": True,
            "issues": [],
            "repairNotes": "",
        }
        return {"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}]}


class FakeStreamingArchitectClient(FakeArchitectClient):
    def stream_chat_with_tools(self, messages, tools, tool_functions, **kwargs):
        content = json.dumps(_valid_architecture(), ensure_ascii=False)
        midpoint = content.index('"chapters"') + 1
        yield {"type": "content_delta", "content": content[:midpoint]}
        yield {"type": "content_delta", "content": content[midpoint:]}
        yield {"type": "done"}

def test_valid_architecture_passes_deterministic_validation():
    architecture = CourseArchitecture.model_validate(_valid_architecture())
    assert validate_course_architecture(architecture) == []


def test_streamed_chapter_parser_only_returns_closed_chapter_objects():
    content = json.dumps(_valid_architecture(), ensure_ascii=False)
    closed = content[:content.index('"chapters"') + len('"chapters":[') + 80]
    assert _complete_chapter_objects(closed) == []
    assert len(_complete_chapter_objects(content)) == 2


def test_stream_course_architecture_emits_nodes_before_final_result():
    client = FakeStreamingArchitectClient([])
    events = list(stream_course_architecture(
        topic="推荐系统核心链路",
        outline=_valid_architecture(),
        learner={"estimatedLevel": "intermediate", "skipBasics": []},
        client=client,
    ))
    types = [event["type"] for event in events]
    assert types.count("node") == 2
    assert types[-1] == "result"
    assert types.index("node") < types.index("result")


def test_architecture_detects_duplicate_deliverable_and_missing_reference():
    data = _valid_architecture()
    data["chapters"][1]["deliverable"] = data["chapters"][0]["deliverable"]
    data["chapters"][0]["conceptIds"] = ["ghost"]
    architecture = CourseArchitecture.model_validate(data)
    issues = validate_course_architecture(architecture)
    assert any("交付物重复" in issue for issue in issues)
    assert any("不存在的概念" in issue for issue in issues)


def test_architecture_detects_dependency_cycle():
    data = _valid_architecture()
    data["chapters"][0]["prerequisites"] = ["ch-2"]
    architecture = CourseArchitecture.model_validate(data)
    issues = validate_course_architecture(architecture)
    assert any("章节依赖存在循环" in issue for issue in issues)


def test_architecture_requires_scope_convergence():
    data = _valid_architecture()
    template_chapter = data["chapters"][0]
    data["chapters"] = [
        {**template_chapter, "chapterId": f"ch-{index}", "title": f"拆分章节 {index}", "prerequisites": []}
        for index in range(1, 10)
    ]
    architecture = CourseArchitecture.model_validate(data)
    issues = validate_course_architecture(architecture)
    assert any("章节数量 9 过多" in issue for issue in issues)


def test_course_architect_service_repairs_invalid_design_once():
    invalid = _valid_architecture()
    invalid["chapters"][1]["deliverable"] = invalid["chapters"][0]["deliverable"]
    client = FakeArchitectClient([invalid, _valid_architecture()])

    result = asyncio.run(generate_course_architecture(
        topic="推荐系统核心链路",
        outline={"learningGoal": "定位推荐问题"},
        learner={"estimatedLevel": "intermediate"},
        client=client,
    ))

    assert result["issues"] == []
    assert result["reviewSkipped"] is True
    assert result["architecture"]["chapters"][1]["deliverable"] == "能为一个推荐问题设计离线与在线验证方案"
    assert len(client.calls) == 2
    assert "交付物重复" in client.calls[1][-1]["content"]


def test_course_architect_semantic_review_can_trigger_revision():
    review_fail = {
        "passed": False,
        "issues": [{
            "code": "DUPLICATE_CHAPTER",
            "chapterIds": ["ch-1", "ch-2"],
            "message": "两章都在建立推荐链路认知，应合并。",
        }],
        "repairNotes": "合并重复章节，并把评估能力提前到同一认知台阶。",
    }
    client = FakeArchitectClient(
        [_valid_architecture(), _valid_architecture()],
        review_responses=[review_fail, {"passed": True, "issues": [], "repairNotes": ""}],
    )
    result = asyncio.run(generate_course_architecture(
        topic="推荐系统核心链路",
        outline={"learningGoal": "定位推荐问题"},
        learner={"estimatedLevel": "intermediate"},
        client=client,
        review_mode="always",
    ))

    assert result["issues"] == []
    assert len(client.calls) == 2
    assert "DUPLICATE_CHAPTER" in client.calls[1][-1]["content"]
    assert "合并重复章节" in client.calls[1][-1]["content"]


def test_optional_review_skips_normal_architecture_and_runs_on_risk():
    normal = CourseArchitecture.model_validate(_valid_architecture())
    assert should_review_architecture(normal, {"estimatedLevel": "intermediate"}) is False
    assert should_review_architecture(normal, {"estimatedLevel": "intermediate", "skipBasics": None}) is False
    assert should_review_architecture(normal, {"estimatedLevel": "intermediate"}, "always") is True

    risky = _valid_architecture()
    template = risky["chapters"][0]
    risky["chapters"] = [
        {
            **template,
            "chapterId": f"ch-{index}",
            "title": f"链路认知 {index}",
            "deliverable": f"能解释推荐链路边界 {index}",
            "prerequisites": [],
        }
        for index in range(1, 7)
    ]
    architecture = CourseArchitecture.model_validate(risky)
    assert should_review_architecture(architecture, {"estimatedLevel": "intermediate"}) is True


def test_course_architect_prompt_declares_design_contract():
    prompt = build_course_architect_prompt(
        "推荐系统核心链路",
        {"learningGoal": "定位推荐问题"},
        {"estimatedLevel": "intermediate", "likelyGaps": ["召回排序边界"]},
        {"scene": "course_architecture"},
    )
    assert "不是内容作者" in prompt
    assert "课程结构由认知增量决定" in prompt
    assert "personalExampleLimit" in prompt
    assert "不得编造 URL" in prompt
    assert "系统学习、全面入门" in prompt
    assert "用户背景只调整起点" in prompt
    assert "不强制每章写报告" in prompt
