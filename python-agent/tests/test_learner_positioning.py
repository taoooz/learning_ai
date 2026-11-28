"""I16 学习者起点文本优先：背景描述驱动起点，水平评级仅针对本主题、置末。

回归保护：避免把“对某主题初级”误读成“对一切初级”而铺垫通用基础。
"""
from types import SimpleNamespace

from services.chapter_plan_service import _format_learner
from services.course_architect_service import _format_learner_for_review
from services.task_content_service import _format_learner_lines


BG = "资深产品经理，懂业务与 PRD，已了解 Agent 基本形态，但对 SuperAgent 具体设计陌生。"


def _task_learner():
    return SimpleNamespace(
        estimatedLevel="beginner",
        confirmedKnowledge=["产品需求文档"],
        likelyGaps=["存算分离"],
        excludedTopics=["ChatBot 与 Agent 区别"],
        backgroundSummary=BG,
        preferredExampleDomains=[],
        personalExampleLimit=None,
    )


def test_task_learner_background_before_level():
    lines = _format_learner_lines(_task_learner())
    joined = "\n".join(lines)
    assert joined.index("学习者背景") < joined.index("相对水平")
    assert "当前水平：初级" not in joined
    assert "仅针对本课程主题" in joined


def test_task_learner_no_background_keeps_level_topic_specific():
    learner = _task_learner()
    learner.backgroundSummary = None
    lines = _format_learner_lines(learner)
    joined = "\n".join(lines)
    assert "相对水平" in joined and "仅针对本课程主题" in joined


def test_chapter_plan_learner_text_first():
    sp = {
        "estimatedLevel": "beginner",
        "backgroundSummary": BG,
        "confirmedKnowledge": ["产品需求文档"],
        "excludedTopics": ["ChatBot 与 Agent 区别"],
        "likelyGaps": ["存算分离"],
    }
    text = _format_learner(sp)
    assert text.index("学习者背景") < text.index("相对水平")
    assert "当前水平：初级" not in text
    assert "仅针对本课程主题" in text


def test_architect_review_learner_text_first():
    learner = {
        "estimatedLevel": "beginner",
        "backgroundSummary": BG,
        "skipBasics": ["ChatBot 与 Agent 区别"],
        "likelyGaps": ["存算分离"],
    }
    text = _format_learner_for_review(learner)
    assert text.index("学习者背景") < text.index("相对水平")
    assert "当前水平：beginner" not in text
    assert "仅针对本课程主题" in text


def test_architect_review_empty_learner():
    assert _format_learner_for_review({}) == "- 无学习者画像"
