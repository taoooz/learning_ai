import pytest
from schemas.outline import OutlineRequest, LearnerPositioning, OutlineBlueprint
from services.outline_service import normalize_level, parse_content_blocks


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


def test_learner_positioning_schema():
    """测试 LearnerPositioning Schema"""
    positioning = LearnerPositioning(
        estimatedLevel="beginner",
        difficultySummary="适合前端开发者",
        backgroundSummary="有 React 基础",
        skipBasics=["React 基础"],
        whyThisCourseFits="深入理解状态管理",
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
            difficultySummary="中等难度",
            backgroundSummary="有 2 年前端经验",
            skipBasics=[],
            whyThisCourseFits="想深入理解状态管理",
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