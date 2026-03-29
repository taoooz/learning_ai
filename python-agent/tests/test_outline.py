import pytest
from schemas.outline import OutlineRequest, LearnerPositioning, OutlineBlueprint


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