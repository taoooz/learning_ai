from services.chat_agent import build_chat_system_prompt


def test_stream_error_does_not_leak_exception_details(monkeypatch):
    import services.chat_agent as chat_module

    class BrokenClient:
        def stream_chat_with_tools(self, **_kwargs):
            raise RuntimeError("secret-internal-detail: connection to 10.0.0.1 refused")
            yield  # pragma: no cover - 使其成为生成器函数

    monkeypatch.setattr(chat_module, "AgentClient", BrokenClient)
    chunks = list(chat_module.stream_chat_with_tools(
        messages=[{"role": "user", "content": "你好"}],
    ))
    joined = "".join(chunks)
    assert "secret-internal-detail" not in joined
    assert "抱歉，回复生成失败，请稍后重试。" in joined
    assert "data: [DONE]" in joined


def test_context_kept_without_memory():
    """回归：没有记忆载荷（新用户/记忆解析失败）时，课程上下文不得被整体丢弃"""
    prompt = build_chat_system_prompt(
        course_topic="提示词工程实践",
        context_info={
            "currentNodeTitle": "指令写作基础",
            "currentNodeGoal": "理解指令的基本结构",
            "questionContext": {
                "type": "wrong",
                "question": "好指令的关键是什么？",
                "correctAnswer": "明确的要求与背景",
                "userAnswer": "越长越好",
                "options": ["明确的要求与背景", "越长越好"],
            },
        },
        conversation_summary={"summary": "此前讨论过指令的清晰度"},
        chat_memory=None,
    )
    assert "提示词工程实践" in prompt
    assert "指令写作基础" in prompt
    assert "好指令的关键是什么？" in prompt
    assert "此前讨论过指令的清晰度" in prompt
    assert "100字以内" in prompt  # 完整 system 规则，而不是 base 兜底句


def test_minimal_prompt_without_any_optional_sections():
    """只有课程主题时也要带完整回答要求，而非退化成 base 一句话"""
    prompt = build_chat_system_prompt(course_topic="Python 入门")
    assert "Python 入门" in prompt
    assert "100字以内" in prompt


def test_memory_section_present_when_provided():
    """有记忆时照常注入 untrusted 包裹的记忆段"""
    prompt = build_chat_system_prompt(
        course_topic="Python 入门",
        chat_memory={"riskConcepts": ["装饰器"]},
    )
    assert "learning_memory" in prompt
    assert "装饰器" in prompt
