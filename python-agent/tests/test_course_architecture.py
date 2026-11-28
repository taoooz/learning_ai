import asyncio
import json

import pytest

from schemas.course_architecture import (
    ArchitectureChapter,
    CourseArchitecture,
    validate_course_architecture,
    validate_course_chapters,
)
from services.course_architect_service import (
    build_course_architect_prompt,
    build_course_architect_meta_prompt,
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


def _valid_chapter_plan() -> dict:
    architecture = _valid_architecture()
    return {
        "architectureVersion": architecture["architectureVersion"],
        "courseTopic": architecture["courseTopic"],
        "chapters": architecture["chapters"],
    }


def _valid_meta() -> dict:
    architecture = _valid_architecture()
    return {
        "thesis": architecture["thesis"],
        "conceptGraph": architecture["conceptGraph"],
        "examplePolicy": architecture["examplePolicy"],
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

    async def chat(self, messages, model=None, max_tokens=1500, response_format=None):
        self.review_calls.append(messages)
        payload = self.review_responses.pop(0) if self.review_responses else {
            "passed": True,
            "issues": [],
            "repairNotes": "",
        }
        return {"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}]}


class FakeChatOnlyClient:
    """兼容旧入口：只实现 MiniMaxClient.chat，不提供 Agent tool API。"""

    model = "fake-chat-only"

    def __init__(self, responses: list[dict]):
        self.responses = responses
        self.calls = []

    async def chat(self, messages, model=None, max_tokens=1500, response_format=None):
        self.calls.append(messages)
        payload = self.responses.pop(0)
        return {"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}]}


class FakeStreamingArchitectClient(FakeArchitectClient):
    def __init__(
        self,
        responses: list[dict] | None = None,
        review_responses: list[dict] | None = None,
        chapter_payload: dict | None = None,
    ):
        super().__init__(responses or [_valid_meta()], review_responses)
        self.chapter_payload = chapter_payload or _valid_chapter_plan()
        self.stream_calls = []
        self.stream_tools = []

    def stream_chat_with_tools(self, messages, tools, tool_functions, **kwargs):
        self.stream_calls.append(messages)
        self.stream_tools = tools
        content = json.dumps(self.chapter_payload, ensure_ascii=False)
        midpoint = content.index('"chapters"') + 1
        yield {"type": "content_delta", "content": content[:midpoint]}
        yield {"type": "content_delta", "content": content[midpoint:]}
        yield {"type": "done", "finish_reason": "stop"}


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


def test_stream_course_architecture_repairs_meta_without_restarting_chapters():
    broken_meta = _valid_meta()
    broken_meta["conceptGraph"] = broken_meta["conceptGraph"][:1]
    client = FakeStreamingArchitectClient(responses=[broken_meta, _valid_meta()])

    events = list(stream_course_architecture(
        topic="推荐系统核心链路",
        outline=_valid_architecture(),
        learner={"estimatedLevel": "intermediate", "skipBasics": []},
        client=client,
    ))

    assert len(client.stream_calls) == 1
    assert len(client.calls) == 2
    assert [event["type"] for event in events].count("node") == 2
    assert "章节已固定" in client.calls[1][-1]["content"]


def test_stream_course_architecture_supports_optional_semantic_review():
    client = FakeStreamingArchitectClient(
        review_responses=[{"passed": True, "issues": [], "repairNotes": ""}],
    )

    events = list(stream_course_architecture(
        topic="推荐系统核心链路",
        outline=_valid_architecture(),
        learner={"estimatedLevel": "intermediate", "skipBasics": []},
        client=client,
        review_mode="always",
    ))

    result = events[-1]
    assert result["type"] == "result"
    assert result["result"]["reviewSkipped"] is False
    assert len(client.review_calls) == 1


def test_stream_course_architecture_exposes_account_scoped_memory_search():
    client = FakeStreamingArchitectClient(
        review_responses=[{"passed": True, "issues": [], "repairNotes": ""}],
    )

    list(stream_course_architecture(
        topic="推荐系统核心链路",
        outline=_valid_architecture(),
        learner={"estimatedLevel": "intermediate", "skipBasics": []},
        client=client,
        account_id="account-1",
    ))

    assert "memory_search" in {
        tool.get("function", {}).get("name")
        for tool in client.stream_tools
    }
    assert "Memory 检索策略" in client.stream_calls[0][0]["content"]


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
        for index in range(1, 14)
    ]
    architecture = CourseArchitecture.model_validate(data)
    issues = validate_course_architecture(architecture)
    assert any("硬上限 12" in issue for issue in issues)


def test_course_architect_service_repairs_invalid_design_once():
    invalid = _valid_chapter_plan()
    invalid["chapters"][1]["deliverable"] = invalid["chapters"][0]["deliverable"]
    client = FakeArchitectClient([invalid, _valid_chapter_plan(), _valid_meta()])

    result = asyncio.run(generate_course_architecture(
        topic="推荐系统核心链路",
        outline={"learningGoal": "定位推荐问题"},
        learner={"estimatedLevel": "intermediate"},
        client=client,
    ))

    assert result["issues"] == []
    assert result["reviewSkipped"] is True
    assert result["architecture"]["chapters"][1]["deliverable"] == "能为一个推荐问题设计离线与在线验证方案"
    assert len(client.calls) == 3
    assert "交付物重复" in client.calls[1][-1]["content"]
    assert "只修复 chapters 阶段" in client.calls[1][-1]["content"]
    assert "thesis" in client.calls[2][0]["content"]


def test_course_architect_supports_chat_only_client():
    client = FakeChatOnlyClient([_valid_chapter_plan(), _valid_meta()])

    result = asyncio.run(generate_course_architecture(
        topic="推荐系统核心链路",
        outline={"learningGoal": "定位推荐问题"},
        learner={"estimatedLevel": "intermediate"},
        client=client,
        review_mode="off",
    ))

    assert result["issues"] == []
    assert result["reviewSkipped"] is True
    assert len(client.calls) == 2


def test_course_architect_repairs_metadata_without_regenerating_chapters():
    broken_meta = _valid_meta()
    broken_meta["conceptGraph"] = broken_meta["conceptGraph"][:1]
    client = FakeArchitectClient([
        _valid_chapter_plan(),
        broken_meta,
        _valid_meta(),
    ])

    result = asyncio.run(generate_course_architecture(
        topic="推荐系统核心链路",
        outline={"learningGoal": "定位推荐问题"},
        learner={"estimatedLevel": "intermediate"},
        client=client,
    ))

    assert result["issues"] == []
    assert len(client.calls) == 3
    assert "章节已固定" in client.calls[2][-1]["content"]
    assert "ch-1" in client.calls[2][1]["content"]


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
        [
            _valid_chapter_plan(),
            _valid_meta(),
            _valid_chapter_plan(),
            _valid_meta(),
        ],
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
    assert len(client.calls) == 4
    assert "DUPLICATE_CHAPTER" in client.calls[2][-1]["content"]
    assert "合并重复章节" in client.calls[2][-1]["content"]
    assert "untrusted_context_data" in client.review_calls[0][1]["content"]


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


def _staged_architecture(chapters_per_stage: list[int]) -> CourseArchitecture:
    """构造两层大纲：总章数可能很大，但每阶段章数可控。

    每章引用两个专属概念，避免触发「单概念章节过多」与「概念集重复」两条独立规则，
    使本用例只检验章数阈值本身。
    """
    raw = _valid_architecture()
    template = raw["chapters"][0]
    # 各章文案用词互异，避免触发相似度门（本用例只检验章数阈值）
    words = ["召回", "排序", "重排", "冷启", "分桶", "曝光", "点击", "留存",
             "画像", "标签", "向量", "索引", "缓存", "降级", "熔断", "灰度",
             "回灌", "去重", "打散", "配额"]
    stages, chapters, concepts = [], [], []
    n = 0
    for s_index, count in enumerate(chapters_per_stage, start=1):
        stage_id = f"st-{s_index}"
        stages.append({
            "stageId": stage_id, "title": f"阶段 {s_index}",
            "stageGoal": f"阶段 {s_index} 的认知增量", "chapterIds": [],
        })
        for c_index in range(1, count + 1):
            chapter_id = f"ch-{s_index}-{c_index}"
            ids = [f"k-{s_index}-{c_index}-a", f"k-{s_index}-{c_index}-b"]
            for cid in ids:
                concepts.append({
                    "conceptId": cid, "label": f"概念 {cid}",
                    "targetDepth": "understand", "rationale": "支撑本章判断",
                    "prerequisiteConceptIds": [],
                })
            w1, w2 = words[n % len(words)], words[(n + 7) % len(words)]
            n += 1
            stages[-1]["chapterIds"].append(chapter_id)
            chapters.append({
                **template,
                "chapterId": chapter_id,
                "title": f"{w1}与{w2}",
                "roleInCourse": f"讲清{w1}在链路中的职责，辨析它与{w2}的差别",
                "deliverable": f"能判断{w1}何时该让位给{w2}",
                "conceptIds": ids,
                "prerequisites": [],
                "stageId": stage_id,
            })
    raw["chapters"] = chapters
    raw["conceptGraph"] = concepts
    raw["structureMode"] = "staged"
    raw["stages"] = stages
    return CourseArchitecture.model_validate(raw)


def test_staged_architecture_review_uses_per_stage_size():
    """两层大纲：14 章分 5 阶段属正常，不该因总章数触发审查。"""
    balanced = _staged_architecture([4, 3, 3, 2, 2])
    assert len(balanced.chapters) == 14
    assert should_review_architecture(balanced, {"estimatedLevel": "intermediate"}) is False

    # 单个阶段塞 8 章 → 这一层没拆好，仍应审查
    lopsided = _staged_architecture([8, 1])
    assert should_review_architecture(lopsided, {"estimatedLevel": "intermediate"}) is True


def test_course_architect_prompt_declares_design_contract():
    prompt = build_course_architect_prompt(
        "推荐系统核心链路",
        {"learningGoal": "定位推荐问题"},
        {"estimatedLevel": "intermediate", "likelyGaps": ["召回排序边界"]},
        {"scene": "course_architecture"},
    )
    assert "不是内容作者" in prompt
    assert "课程结构由认知增量决定" in prompt
    assert "不得编造 URL" in prompt
    assert "系统学习、全面入门" in prompt
    assert "用户背景只调整起点" in prompt
    assert "不强制每章写报告" in prompt
    assert "严禁在本阶段输出 thesis" in prompt
    assert "learning_request" in prompt
    assert "untrusted_context_data" in prompt


def test_course_architect_meta_prompt_keeps_chapters_fixed():
    from schemas.course_architecture import CourseChapterPlan

    chapter_plan = _valid_chapter_plan()
    chapter_plan["chapters"][0]["conceptIds"] = ["c1-business-to-objective"]
    chapter_plan["chapters"][1]["conceptIds"] = ["c2-experiment-decision"]
    plan = CourseChapterPlan.model_validate(chapter_plan)
    prompt = build_course_architect_meta_prompt(
        "推荐系统核心链路",
        {"learningGoal": "定位推荐问题"},
        {"estimatedLevel": "intermediate", "likelyGaps": ["召回排序边界"]},
        plan,
        {"scene": "course_architecture"},
    )
    assert "不得新增、删除、重命名或改写章节" in prompt
    assert "personalExampleLimit" in prompt
    assert "推荐链路职责边界" in prompt
    assert "c1-business-to-objective" in prompt
    assert "c2-experiment-decision" in prompt
    assert "必须逐字使用" in prompt
    assert "禁止简化成 c1/c2/c3" in prompt


def _chapter_with_deliverable(deliverable: str):
    from schemas.course_architecture import ArchitectureChapter
    return ArchitectureChapter(
        chapterId="ch1",
        title="缓存一致性",
        roleInCourse="建立判断边界",
        conceptIds=["cache-aside"],
        deliverable=deliverable,
    )


def test_vague_deliverable_is_flagged():
    """交付物以空泛认知动词开头 → 校验 issue（进 architect 修复链）"""
    from schemas.course_architecture import validate_course_chapters
    for vague in ("掌握缓存一致性原理", "了解缓存穿透", "熟悉一致性协议", "理解缓存策略"):
        issues = validate_course_chapters([_chapter_with_deliverable(vague)])
        assert any("空泛认知动词" in issue for issue in issues), vague


def test_concrete_deliverable_passes_vague_check():
    """具体产物/行为描述不触发；'掌握度'是名词不误杀"""
    from schemas.course_architecture import validate_course_chapters
    for concrete in ("一份缓存穿透排查清单", "能独立判断缓存失效场景", "掌握度自评表"):
        issues = validate_course_chapters([_chapter_with_deliverable(concrete)])
        assert not any("空泛认知动词" in issue for issue in issues), concrete


def _failed_review() -> dict:
    return {
        "passed": False,
        "issues": [{"code": "WEAK_DELTA", "chapterIds": ["ch-1"], "message": "认知增量不足"}],
        "repairNotes": "",
    }


def test_stream_review_soft_gate_passes_with_issues(monkeypatch):
    """默认软门：修复后仍不通过 → 放行并携带 reviewIssues，不整课失败。"""
    monkeypatch.delenv("ARCHITECT_REVIEW_STRICT", raising=False)
    client = FakeStreamingArchitectClient(
        responses=[_valid_meta(), _valid_chapter_plan(), _valid_meta()],
        review_responses=[_failed_review(), _failed_review()],
    )
    events = list(stream_course_architecture(
        topic="推荐系统核心链路",
        outline=_valid_architecture(),
        learner={"estimatedLevel": "intermediate", "skipBasics": []},
        client=client,
        review_mode="always",
    ))
    result = events[-1]
    assert result["type"] == "result"
    assert result["result"]["issues"] == []
    assert result["result"]["reviewIssues"]
    assert len(client.review_calls) == 2


def test_stream_review_strict_gate_raises(monkeypatch):
    """ARCHITECT_REVIEW_STRICT=1 恢复硬门：二次审查仍不通过 → 整课失败。"""
    monkeypatch.setenv("ARCHITECT_REVIEW_STRICT", "1")
    client = FakeStreamingArchitectClient(
        responses=[_valid_meta(), _valid_chapter_plan(), _valid_meta()],
        review_responses=[_failed_review(), _failed_review()],
    )
    with pytest.raises(ValueError, match="课程架构审查未通过"):
        list(stream_course_architecture(
            topic="推荐系统核心链路",
            outline=_valid_architecture(),
            learner={"estimatedLevel": "intermediate", "skipBasics": []},
            client=client,
            review_mode="always",
        ))


def test_sync_review_soft_gate_returns_review_issues(monkeypatch):
    monkeypatch.delenv("ARCHITECT_REVIEW_STRICT", raising=False)
    client = FakeArchitectClient(
        responses=[_valid_chapter_plan(), _valid_meta(), _valid_chapter_plan(), _valid_meta()],
        review_responses=[_failed_review(), _failed_review()],
    )
    result = asyncio.run(generate_course_architecture(
        topic="推荐系统核心链路",
        outline=_valid_architecture(),
        learner={"estimatedLevel": "intermediate", "skipBasics": []},
        client=client,
        review_mode="always",
    ))
    assert result["issues"] == []
    assert result["reviewIssues"]


def test_chapter_count_hard_limit_is_twelve():
    """9～12 章不再硬拦截（交给 prompt 收敛与风险审查）；超过 12 章硬拦截。"""
    base = _valid_chapter_plan()["chapters"][0]
    nine = [
        ArchitectureChapter(**{**base, "chapterId": f"ch-{i}", "prerequisites": []})
        for i in range(9)
    ]
    assert not any("章节数量" in issue for issue in validate_course_chapters(nine))
    thirteen = [
        ArchitectureChapter(**{**base, "chapterId": f"ch-{i}", "prerequisites": []})
        for i in range(13)
    ]
    assert any("硬上限 12" in issue for issue in validate_course_chapters(thirteen))


# ---- response_format json_schema(strict) 迁移回归 ----

class RecordingArchitectClient(FakeArchitectClient):
    """记录 chat_with_tools 收到的 kwargs（含 response_format）。"""

    def __init__(self, responses, review_responses=None):
        super().__init__(responses, review_responses)
        self.kwargs_seen: list[dict] = []

    def chat_with_tools(self, messages, tools, tool_functions, **kwargs):
        self.kwargs_seen.append(kwargs)
        return super().chat_with_tools(messages, tools, tool_functions, **kwargs)


class RecordingStreamingClient(FakeStreamingArchitectClient):
    """记录流式与 meta 阶段收到的 kwargs（含 response_format）。"""

    def __init__(self, responses=None, review_responses=None, chapter_payload=None):
        super().__init__(responses, review_responses, chapter_payload)
        self.stream_kwargs: list[dict] = []
        self.kwargs_seen: list[dict] = []

    def stream_chat_with_tools(self, messages, tools, tool_functions, **kwargs):
        self.stream_kwargs.append(kwargs)
        yield from super().stream_chat_with_tools(messages, tools, tool_functions, **kwargs)

    def chat_with_tools(self, messages, tools, tool_functions, **kwargs):
        self.kwargs_seen.append(kwargs)
        return super().chat_with_tools(messages, tools, tool_functions, **kwargs)


class RecordingChatOnlyClient(FakeChatOnlyClient):
    """记录 chat 收到的 response_format。"""

    def __init__(self, responses):
        super().__init__(responses)
        self.formats: list = []

    async def chat(self, messages, model=None, max_tokens=1500, response_format=None):
        self.formats.append(response_format)
        return await super().chat(messages, model=model, max_tokens=max_tokens, response_format=response_format)


def test_stream_passes_strict_schemas_to_both_stages(monkeypatch):
    from schemas.course_architecture import COURSE_CHAPTERS_JSON_SCHEMA, COURSE_META_JSON_SCHEMA
    monkeypatch.setenv("LLM_STRICT_JSON_SCHEMA", "1")
    client = RecordingStreamingClient([])
    events = list(stream_course_architecture(
        topic="推荐系统核心链路",
        outline=_valid_architecture(),
        learner={"estimatedLevel": "intermediate", "skipBasics": []},
        client=client,
    ))
    assert events[-1]["type"] == "result"
    chapters_fmt = client.stream_kwargs[0]["response_format"]
    assert chapters_fmt["type"] == "json_schema"
    assert chapters_fmt["json_schema"]["name"] == "course_chapters"
    assert chapters_fmt["json_schema"]["strict"] is True
    assert chapters_fmt["json_schema"]["schema"] == COURSE_CHAPTERS_JSON_SCHEMA
    meta_fmt = client.kwargs_seen[0]["response_format"]
    assert meta_fmt["json_schema"]["name"] == "course_meta"
    assert meta_fmt["json_schema"]["schema"] == COURSE_META_JSON_SCHEMA


def test_stream_meta_repair_also_carries_strict_schema(monkeypatch):
    from schemas.course_architecture import COURSE_META_JSON_SCHEMA
    monkeypatch.setenv("LLM_STRICT_JSON_SCHEMA", "1")
    broken_meta = _valid_meta()
    broken_meta["conceptGraph"] = broken_meta["conceptGraph"][:1]
    client = RecordingStreamingClient(responses=[broken_meta, _valid_meta()])
    list(stream_course_architecture(
        topic="推荐系统核心链路",
        outline=_valid_architecture(),
        learner={"estimatedLevel": "intermediate", "skipBasics": []},
        client=client,
    ))
    assert len(client.kwargs_seen) == 2
    for kwargs in client.kwargs_seen:
        assert kwargs["response_format"]["json_schema"]["schema"] == COURSE_META_JSON_SCHEMA


def test_stream_env_off_uses_json_object(monkeypatch):
    monkeypatch.setenv("LLM_STRICT_JSON_SCHEMA", "0")
    client = RecordingStreamingClient([])
    list(stream_course_architecture(
        topic="推荐系统核心链路",
        outline=_valid_architecture(),
        learner={"estimatedLevel": "intermediate", "skipBasics": []},
        client=client,
    ))
    assert client.stream_kwargs[0]["response_format"] == {"type": "json_object"}
    assert client.kwargs_seen[0]["response_format"] == {"type": "json_object"}


def test_nonstream_generate_passes_strict_schemas(monkeypatch):
    from schemas.course_architecture import COURSE_CHAPTERS_JSON_SCHEMA, COURSE_META_JSON_SCHEMA
    monkeypatch.setenv("LLM_STRICT_JSON_SCHEMA", "1")
    client = RecordingArchitectClient([_valid_chapter_plan(), _valid_meta()])
    asyncio.run(generate_course_architecture(
        topic="推荐系统核心链路",
        outline={"learningGoal": "定位推荐问题"},
        learner={"estimatedLevel": "intermediate"},
        client=client,
    ))
    assert client.kwargs_seen[0]["response_format"]["json_schema"]["schema"] == COURSE_CHAPTERS_JSON_SCHEMA
    assert client.kwargs_seen[1]["response_format"]["json_schema"]["schema"] == COURSE_META_JSON_SCHEMA


def test_chat_only_client_receives_strict_schemas(monkeypatch):
    from schemas.course_architecture import COURSE_CHAPTERS_JSON_SCHEMA, COURSE_META_JSON_SCHEMA
    monkeypatch.setenv("LLM_STRICT_JSON_SCHEMA", "1")
    client = RecordingChatOnlyClient([_valid_chapter_plan(), _valid_meta()])
    asyncio.run(generate_course_architecture(
        topic="推荐系统核心链路",
        outline={"learningGoal": "定位推荐问题"},
        learner={"estimatedLevel": "intermediate"},
        client=client,
    ))
    assert client.formats[0]["json_schema"]["schema"] == COURSE_CHAPTERS_JSON_SCHEMA
    assert client.formats[1]["json_schema"]["schema"] == COURSE_META_JSON_SCHEMA


def test_architect_messages_coverage_is_hint_not_gate():
    """B3：架构阶段覆盖度只作提示，搜索策略始终在 system，是否搜索由模型判断。"""
    from services.course_architect_service import build_course_architect_chapters_messages

    covered = build_course_architect_chapters_messages(
        "推荐系统核心链路",
        {"learningDirection": "推荐系统核心链路"},
        {"estimatedLevel": "intermediate"},
        sources=[{
            "title": "推荐系统核心链路详解",
            "url": "https://example.com/recsys",
            "summary": "召回、排序与重排的完整链路",
        }],
    )
    assert "证据覆盖提示" in covered["user"]
    assert "初步匹配" in covered["user"]
    assert "联网搜索决策" in covered["system"]

    uncovered = build_course_architect_chapters_messages(
        "推荐系统核心链路",
        {},
        {"estimatedLevel": "intermediate"},
        sources=[],
    )
    assert "匹配较弱或暂无证据" in uncovered["user"]
    assert "联网搜索决策" in uncovered["system"]


# ---- 两层大纲 + 灵活章数（用户反馈#3 / I14）----

def _stage_chapter(cid: str, stage_id: str | None) -> ArchitectureChapter:
    return ArchitectureChapter(
        chapterId=cid,
        title=f"章节{cid}",
        roleInCourse=f"承接前章、铺垫后章的职责{cid}",
        conceptIds=[f"concept-{cid}"],
        deliverable=f"可验收交付物{cid}",
        prerequisites=[],
        stageId=stage_id,
    )


def test_flat_plan_backward_compatible():
    from schemas.course_architecture import CourseChapterPlan
    plan = CourseChapterPlan.model_validate(_valid_chapter_plan())
    assert plan.structureMode == "flat"
    assert plan.stages is None
    assert all(ch.stageId is None for ch in plan.chapters)
    assert not validate_course_chapters(plan.chapters, plan.structureMode, plan.stages)


def test_staged_valid_passes():
    from schemas.course_architecture import ArchitectureStage
    chapters = [_stage_chapter("ch-1", "stage-1"), _stage_chapter("ch-2", "stage-1"),
                _stage_chapter("ch-3", "stage-2")]
    stages = [
        ArchitectureStage(stageId="stage-1", title="基础阶段", stageGoal="建立边界", chapterIds=["ch-1", "ch-2"]),
        ArchitectureStage(stageId="stage-2", title="进阶阶段", stageGoal="独立判断", chapterIds=["ch-3"]),
    ]
    assert not validate_course_chapters(chapters, "staged", stages)


def test_staged_requires_stages():
    chapters = [_stage_chapter("ch-1", "stage-1")]
    issues = validate_course_chapters(chapters, "staged", None)
    assert any("必须提供 stages" in i for i in issues)


def test_staged_dangling_chapter_reference():
    from schemas.course_architecture import ArchitectureStage
    chapters = [_stage_chapter("ch-1", "stage-1")]
    stages = [ArchitectureStage(stageId="stage-1", title="阶段", stageGoal="目标", chapterIds=["ch-1", "ch-99"])]
    issues = validate_course_chapters(chapters, "staged", stages)
    assert any("不存在的章节：ch-99" in i for i in issues)


def test_staged_chapter_must_belong_to_stage():
    from schemas.course_architecture import ArchitectureStage
    chapters = [_stage_chapter("ch-1", None)]
    stages = [ArchitectureStage(stageId="stage-1", title="阶段", stageGoal="目标", chapterIds=["ch-1"])]
    issues = validate_course_chapters(chapters, "staged", stages)
    assert any("必须归属一个阶段" in i for i in issues)


def test_staged_chapter_not_in_stage_list():
    from schemas.course_architecture import ArchitectureStage
    chapters = [_stage_chapter("ch-1", "stage-1"), _stage_chapter("ch-2", "stage-1")]
    stages = [ArchitectureStage(stageId="stage-1", title="阶段", stageGoal="目标", chapterIds=["ch-1"])]
    issues = validate_course_chapters(chapters, "staged", stages)
    assert any("未出现在其所属阶段" in i for i in issues)


def test_staged_cap_eighteen():
    from schemas.course_architecture import ArchitectureStage
    chapters = [_stage_chapter(f"ch-{i}", "stage-1") for i in range(18)]
    stages = [ArchitectureStage(stageId="stage-1", title="阶段", stageGoal="目标",
                                chapterIds=[f"ch-{i}" for i in range(18)])]
    assert not any("章节数量" in i for i in validate_course_chapters(chapters, "staged", stages))
    chapters19 = [_stage_chapter(f"ch-{i}", "stage-1") for i in range(19)]
    stages19 = [ArchitectureStage(stageId="stage-1", title="阶段", stageGoal="目标",
                                  chapterIds=[f"ch-{i}" for i in range(19)])]
    assert any("硬上限 18" in i for i in validate_course_chapters(chapters19, "staged", stages19))


def test_chapters_schema_includes_stage_fields():
    from schemas.course_architecture import COURSE_CHAPTERS_JSON_SCHEMA
    assert "structureMode" in COURSE_CHAPTERS_JSON_SCHEMA["properties"]
    assert "stages" in COURSE_CHAPTERS_JSON_SCHEMA["properties"]
    assert "stageId" in COURSE_CHAPTERS_JSON_SCHEMA["properties"]["chapters"]["items"]["properties"]


def test_architect_prompt_declares_two_level_structure():
    prompt = build_course_architect_prompt(
        "推荐系统核心链路",
        {"learningGoal": "定位推荐问题"},
        {"estimatedLevel": "intermediate", "likelyGaps": ["召回排序边界"]},
        {"scene": "course_architecture"},
    )
    assert "structureMode" in prompt
    assert "staged" in prompt
    assert "stageId" in prompt
    assert "知识衔接" in prompt
