"""TOC prompt 的课程级证据注入约束。"""

from services.toc_service import build_toc_prompt


def test_toc_prompt_injects_course_evidence():
    prompt = build_toc_prompt(
        {"topic": "React 进阶实战"},
        evidence="- React 19 release notes\\n  引入 Actions\\n  来源: https://react.dev/blog/react-19",
        sources=[{"title": "React 19 release notes", "url": "https://react.dev/blog/react-19"}],
    )
    assert "课程证据包" in prompt
    assert "React 19 release notes" in prompt
    assert "https://react.dev/blog/react-19" in prompt
    assert "不要规划证据未支持的高风险版本细节" in prompt


def test_toc_prompt_without_evidence_has_no_section():
    prompt = build_toc_prompt({"topic": "写作表达"})
    assert "课程证据包" not in prompt
