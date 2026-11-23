import pytest
from schemas.outline import OutlineRequest, LearnerPositioning, OutlineBlueprint
from schemas.outline import OutlineAnswerRequest
from services.outline_agent import (
    _stream_agent_sse,
    _complete_quiz_questions,
    _emit_clarification_form,
    _format_clarification_answers,
    _normalize_clarification_question,
    _normalize_clarification_options,
)
from services.outline_service import (
    build_initial_messages,
    needs_level_calibration,
    normalize_level,
    parse_content_blocks,
)


def test_normalize_level_chinese_to_english():
    """模型输出的中文水平词应归一化为英文键"""
    assert normalize_level("初级") == "beginner"
    assert normalize_level("中级") == "intermediate"
    assert normalize_level("高级") == "advanced"
    assert normalize_level("入门") == "novice"
    # 英文值原样通过，未知值回退 beginner
    assert normalize_level("beginner") == "beginner"
    assert normalize_level("未知值") == "beginner"
    assert normalize_level("") == "beginner"


class _CaptureToolClient:
    def __init__(self):
        self.tools = []

    def stream_chat_with_tools(self, messages, tools, tool_functions, **kwargs):
        self.tools = tools
        yield {"type": "content_delta", "content": "ok"}
        yield {"type": "done", "finish_reason": "stop"}


def test_outline_agent_exposes_memory_search_only_with_account():
    client = _CaptureToolClient()
    events = list(_stream_agent_sse(
        client,
        [{"role": "system", "content": "test"}, {"role": "user", "content": "test"}],
        100,
        [],
        memory_account_id="account-1",
    ))
    assert events
    assert "memory_search" in {tool["function"]["name"] for tool in client.tools}

    no_account = _CaptureToolClient()
    list(_stream_agent_sse(
        no_account,
        [{"role": "system", "content": "test"}, {"role": "user", "content": "test"}],
        100,
        [],
    ))
    assert "memory_search" not in {tool["function"]["name"] for tool in no_account.tools}

    prompt = build_initial_messages(
        "推荐系统",
        {"targetJob": "产品经理"},
        {"learnerSnapshot": {"estimatedLevel": "intermediate"}},
        allow_memory_search=True,
    )
    assert "Memory 检索策略" in prompt["system"]
    assert "Memory 检索策略" not in prompt["user"]


def test_parse_outline_normalizes_level():
    """parse_content_blocks 解析出的 estimatedLevel 应为归一化后的英文键"""
    content = """<outline>
<div slot="direction">AI 实战入门</div>
<div slot="keypoint">概念解析</div>
<div slot="object">独立搭建 AI 应用</div>
<div slot="level">中级</div>
</outline>"""
    parsed = parse_content_blocks(content)
    assert parsed["outline"]["estimatedLevel"] == "intermediate"


def test_parse_outline_keeps_calibration_and_example_policy():
    content = """<outline>
<div slot="direction">推荐系统进阶</div>
<div slot="object">能独立拆解推荐链路</div>
<div slot="level">中级</div>
<div slot="confidence">0.72</div>
<div slot="background">做过内容运营，参与过推荐位配置</div>
<div slot="knowledge">已掌握1：推荐系统基本概念；已掌握2：曝光与点击</div>
<div slot="gaps">可能缺口1：召回与排序边界；可能缺口2：离线评估</div>
<div slot="exampleDomains">电商推荐；内容平台</div>
<div slot="personalExampleLimit">1</div>
</outline>"""
    outline = parse_content_blocks(content)["outline"]
    assert outline["levelConfidence"] == 0.72
    assert outline["skipBasics"] == ["推荐系统基本概念", "曝光与点击"]
    assert outline["likelyGaps"] == ["召回与排序边界", "离线评估"]
    assert outline["preferredExampleDomains"] == ["电商推荐", "内容平台"]
    assert outline["personalExampleLimit"] == 1


def test_low_confidence_with_transferable_background_requires_calibration():
    memory = {
        "learnerSnapshot": {"estimatedLevel": "novice", "confidence": 0.35},
        "transferableBackground": ["做过内容运营，参与过推荐位配置"],
    }
    assert needs_level_calibration(memory) is True
    assert needs_level_calibration({
        "learnerSnapshot": {"estimatedLevel": "intermediate", "confidence": 0.82},
        "transferableBackground": [],
    }) is False


def test_batch_clarification_answers_are_merged_into_one_model_message():
    answers = [
        {"questionId": "q1", "answer": "参与过推荐位配置"},
        {"questionId": "q2", "answer": "想能定位召回问题"},
    ]
    text = _format_clarification_answers(answers)
    assert "一次性回答" in text
    assert "[q1] 参与过推荐位配置" in text
    assert "[q2] 想能定位召回问题" in text


def test_clarification_form_emits_all_questions_once():
    state = {"question_count": 0, "questions_asked": [], "current_question": None}
    events = list(_emit_clarification_form(
        [
            {"id": "q1", "question": "你做过什么？", "options": ["没有", "参与过"]},
            {"id": "q2", "question": "你最想解决什么？", "options": ["定位问题", "设计实验"]},
        ],
        "session-1",
        state,
    ))
    assert len(events) == 2
    assert '"type": "question_start"' in events[0]
    assert '"total": 2' in events[0]
    payload = events[1].split("data: ", 1)[1].split("\n\n", 1)[0]
    import json
    parsed = json.loads(payload)
    assert len(parsed["questions"]) == 2
    assert state["questions_asked"] == ["你做过什么？", "你最想解决什么？"]


def test_clarification_options_split_when_model_puts_all_labels_in_one_field():
    options = _normalize_clarification_options([
        "A.只看过概念，没有实践B.搭过简单 demoC.独立做过一个环节D.完整负责过线上链路",
    ])
    assert options == ["只看过概念，没有实践", "搭过简单 demo", "独立做过一个环节", "完整负责过线上链路"]


def test_clarification_question_without_options_gets_choice_fallback():
    question = _normalize_clarification_question(
        {"id": "q1", "question": "请描述一下你的经历", "options": []},
        0,
        set(),
    )
    assert question is not None
    assert len(question["options"]) == 4
    assert question["options"][0] == "还没有实际接触"


def test_complete_quiz_questions_only_returns_closed_blocks():
    content = '''<quiz id="1"><div slot="question">第一题</div><div slot="option_A">A</div></quiz>
<quiz id="2"><div slot="question">第二题</div><div slot="option_A">B</div></quiz>'''
    questions = _complete_quiz_questions(content)
    assert [question["id"] for question in questions] == ["1", "2"]
    assert _complete_quiz_questions('<quiz id="3"><div slot="question">未闭合') == []


def test_outline_answer_request_supports_batch_answers_without_legacy_answer():
    request = OutlineAnswerRequest(
        sessionId="session-1",
        answers=[{"questionId": "q1", "answer": "参与过推荐位配置"}],
    )
    assert request.answer is None
    assert request.answers[0].questionId == "q1"


def test_learner_positioning_schema():
    """测试 LearnerPositioning Schema"""
    positioning = LearnerPositioning(
        estimatedLevel="beginner",
        backgroundSummary="有 React 基础",
        skipBasics=["React 基础"],
    )
    assert positioning.estimatedLevel == "beginner"
    assert "React" in positioning.backgroundSummary


def test_outline_blueprint_schema():
    """测试 OutlineBlueprint Schema"""
    blueprint = OutlineBlueprint(
        learningDirection="深入学习 React 状态管理",
        learningGoal="掌握 Redux、Zustand 等状态管理方案",
        learnerPositioning=LearnerPositioning(
            estimatedLevel="intermediate",
            backgroundSummary="有 2 年前端经验",
            skipBasics=[],
        ),
    )
    assert "React" in blueprint.learningDirection
    assert blueprint.learnerPositioning.estimatedLevel == "intermediate"


def test_outline_request_schema():
    """测试 OutlineRequest Schema"""
    req = OutlineRequest(
        topic="React 状态管理",
        userProfile={"background": "前端开发"},
        userMemory={"extractedInsights": {}},
    )
    assert req.topic == "React 状态管理"
    assert req.userProfile["background"] == "前端开发"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


def test_parse_outline_intent_type_contract():
    """intentType 是澄清阶段建立的业务契约：只接受枚举，缺失/非法返回 None 由前端回退"""
    content = """<outline>
<div slot="direction">AI 排障实战</div>
<div slot="object">能独立定位常见故障</div>
<div slot="intentType">problem_solving</div>
<div slot="level">中级</div>
</outline>"""
    assert parse_content_blocks(content)["outline"]["intentType"] == "problem_solving"
    # 大小写归一化
    assert parse_content_blocks(content.replace("problem_solving", "Skill_Mastery"))["outline"]["intentType"] == "skill_mastery"
    # 非法值与缺失槽位都返回 None
    assert parse_content_blocks(content.replace("problem_solving", "casual_chat"))["outline"]["intentType"] is None
    assert parse_content_blocks(content.replace('<div slot="intentType">problem_solving</div>\n', ''))["outline"]["intentType"] is None


def test_confidence_threshold_single_source():
    """置信度阈值统一为 0.6：prompt 与代码同源，边界行为确定。"""
    from services.outline_service import LEVEL_CONFIDENCE_THRESHOLD
    assert LEVEL_CONFIDENCE_THRESHOLD == 0.6
    low = {"learnerSnapshot": {"estimatedLevel": "intermediate", "confidence": 0.59}}
    ok = {"learnerSnapshot": {"estimatedLevel": "intermediate", "confidence": 0.6}}
    assert needs_level_calibration(low) is True
    assert needs_level_calibration(ok) is False
