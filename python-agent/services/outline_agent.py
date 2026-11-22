"""
Outline Agent 服务 — 带搜索能力的 Agent 版 outline 生成
复用 outline_service 的 prompt 构建和解析逻辑，
通过 AgentClient 实现 function calling 自动搜索
"""
import json
import os
import re
from typing import Generator
from lib.minimax_agent import AgentClient
from lib.tools.search_tools import SEARCH_TOOLS, TOOL_FUNCTIONS
from services.outline_service import (
    build_initial_prompt,
    needs_level_calibration,
    parse_content_blocks,
    make_initial_state,
)


def _user_friendly_error(e: Exception) -> str:
    """将 API 异常转换为用户友好的中文提示"""
    msg = str(e)
    if "529" in msg or "overloaded" in msg.lower():
        return "AI 服务当前繁忙，请稍等几秒后重试"
    if "ReadTimeout" in msg or "timed out" in msg:
        return "AI 服务响应超时，请稍后重试"
    if "500" in msg or "502" in msg or "503" in msg:
        return "AI 服务暂时不可用，请稍后重试"
    if "429" in msg or "rate" in msg.lower():
        return "请求过于频繁，请稍后重试"
    return "生成过程遇到问题，请稍后重试"


def _extract_content_from_agent_events(events: list[dict]) -> str:
    """从 Agent 事件序列中提取最终内容文本"""
    parts = []
    for event in events:
        if event["type"] == "content_delta":
            parts.append(event["content"])
    return "".join(parts)


# 与 prompt 约定一致：每次仅提 1 个问题，累计最多 3 个
MAX_QUESTIONS = 3
OUTLINE_REASONING_EFFORT = os.getenv("OUTLINE_REASONING_EFFORT", "low").strip() or None

_DEFAULT_CLARIFICATION_OPTIONS = [
    "还没有实际接触",
    "了解概念但缺少实践",
    "参与过部分实际工作",
    "能独立负责并希望系统提升",
]


def _fallback_calibration_question(topic: str) -> dict:
    """模型未按要求提问时，用低歧义选项完成必要校准。"""
    return {
        "id": "1",
        "question": f"为了确定「{topic}」的合适起点，你目前能独立做到哪一步？",
        "options": [
            "还没接触过这个主题",
            "了解一些概念，但没有独立实践",
            "在工作中参与过部分环节，仍需系统补齐",
            "能独立负责完整链路，希望重点查漏补缺",
        ],
    }


def _format_clarification_answers(answers: list[dict] | None, answer: str = "") -> str:
    """把批量答案整理成一条模型消息，保留问题 ID 便于模型对应答案。"""
    if answers:
        lines = [
            f"- [{item.get('questionId', f'q{index + 1}')}] {item.get('answer', '')}"
            for index, item in enumerate(answers)
            if str(item.get("answer") or "").strip()
        ]
        if lines:
            return "用户一次性回答了以下澄清问题：\n" + "\n".join(lines)
    return answer.strip()


def _normalize_clarification_options(options: list) -> list[str]:
    """兼容模型把 A/B/C/D 选项全部塞进一个 option 字段的输出。"""
    cleaned = [str(option).strip() for option in (options or []) if str(option).strip()]
    if not cleaned:
        return []
    if len(cleaned) == 1:
        text = cleaned[0]
        labels = re.findall(r'[A-D]\.', text)
        if len(labels) >= 2:
            parts = re.split(r'(?=[A-D]\.)', text)
            cleaned = parts
    return [
        re.sub(r'^[A-D]\.\s*', '', option).strip()
        for option in cleaned
        if re.sub(r'^[A-D]\.\s*', '', option).strip()
    ]


def _normalize_clarification_question(raw: dict, index: int, seen_ids: set[str]) -> dict | None:
    """把模型问题归一化为单题对象，并保证至少提供一组选择题选项。"""
    raw_id = str(raw.get("id") or f"{index + 1}")
    question_id = raw_id if raw_id not in seen_ids else f"{raw_id}-{index + 1}"
    question = str(raw.get("question") or "").strip()
    if not question:
        return None
    options = _normalize_clarification_options(raw.get("options") or [])
    if not options:
        # 模型偶尔会输出简答题。前端只接受选择题，统一降级为基础校准题。
        question = "为了确定课程起点，你目前的实际情况更接近哪一项？"
        options = list(_DEFAULT_CLARIFICATION_OPTIONS)
    seen_ids.add(question_id)
    return {"id": question_id, "question": question, "options": options}


def _complete_quiz_questions(content: str) -> list[dict]:
    """提取已经闭合的 <quiz> 题块，供流式逐题下发。"""
    questions: list[dict] = []
    for match in re.finditer(r'<quiz\b[^>]*>(.*?)</quiz>', content, re.DOTALL):
        parsed = parse_content_blocks(match.group(0))
        questions.extend(parsed.get("questions") or [])
    return questions


def _emit_clarification_form(
    questions: list[dict],
    session_id: str,
    state: dict,
) -> Generator[str, None, None]:
    """一次发送完整问题组，前端在本地逐题作答，最后一次性提交。"""
    if not questions:
        return
    normalized = []
    seen_ids: set[str] = set()
    for index, question in enumerate(questions[:3]):
        item = _normalize_clarification_question(question, index, seen_ids)
        if item:
            normalized.append(item)
    if not normalized:
        return

    state["questions_asked"].extend(question["question"] for question in normalized)
    state["current_question"] = normalized[0]
    yield f"data: {json.dumps({'type': 'question_start', 'questionNumber': state['question_count'] + 1, 'total': len(normalized)}, ensure_ascii=False)}\n\n"
    yield f"data: {json.dumps({'type': 'questions', 'questions': normalized, 'sessionId': session_id}, ensure_ascii=False)}\n\n"


def _stream_agent_sse(
    client,
    messages: list[dict],
    max_tokens: int,
    agent_events: list,
    reasoning_effort: str | None = None,
    content_observer=None,
) -> Generator[str, None, None]:
    """运行 Agent tool-calling 循环，把 agent 事件转成前端 SSE 格式，同时累积到 agent_events"""
    content_parts: list[str] = []
    for event in client.stream_chat_with_tools(
        messages=messages,
        tools=SEARCH_TOOLS,
        tool_functions=TOOL_FUNCTIONS,
        max_tokens=max_tokens,
        reasoning_split=True,
        max_iterations=8,
        max_searches=3,
        reasoning_effort=reasoning_effort or OUTLINE_REASONING_EFFORT,
    ):
        agent_events.append(event)

        if event["type"] == "thinking":
            yield f"data: {json.dumps({'type': 'thinking', 'message': event['message']}, ensure_ascii=False)}\n\n"

        elif event["type"] == "tool_call":
            tool_name = event["tool"]
            tool_args = event["args"]
            if tool_name == "web_search":
                query = tool_args.get("query", "")
                yield f"data: {json.dumps({'type': 'thinking', 'message': f'正在搜索：{query}'}, ensure_ascii=False)}\n\n"
            elif tool_name == "read_url":
                url = tool_args.get("url", "")
                yield f"data: {json.dumps({'type': 'thinking', 'message': f'正在读取：{url}'}, ensure_ascii=False)}\n\n"

        elif event["type"] == "content_delta":
            content = event["content"]
            if content:
                content_parts.append(content)
                yield f"data: {json.dumps({'type': 'content_delta', 'content': content}, ensure_ascii=False)}\n\n"
                if content_observer:
                    yield from content_observer("".join(content_parts))


def stream_outline_with_tools(
    topic: str,
    user_profile: dict,
    planning_memory: dict,
    # 推理型模型思考长度方差大，预算不足会截断在思考阶段。
    max_tokens: int = 12000,
) -> Generator[str, None, None]:
    """Agent 版 outline 生成（带搜索能力）

    流程:
    1. 构建 prompt（复用 outline_service 的 build_initial_prompt）
    2. 使用 AgentClient 进行 tool-calling 循环
    3. 将 Agent 事件转换为前端期望的 SSE 格式
    4. 解析最终内容（复用 outline_service 的 parse_content_blocks）
    5. 输出 blueprint/questions 事件序列

    Yields: SSE 格式字符串（data: {...}\\n\\n）
    """
    client = AgentClient()
    calibration_required = needs_level_calibration(planning_memory, user_profile)
    state = make_initial_state(topic, user_profile, planning_memory)
    state["forced_calibration"] = calibration_required
    system_prompt = build_initial_prompt(
        topic,
        user_profile,
        planning_memory,
        needs_calibration=calibration_required,
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "请开始。"},
    ]

    # 先创建 session，第一题闭合时前端就能拿到 sessionId 并开始作答。
    from memory.session import get_session_store
    session_store = get_session_store()
    session = session_store.create("outline", state)
    state["session_id"] = session.session_id
    session_id = session.session_id
    yield f"data: {json.dumps({'type': 'session_created', 'sessionId': session_id}, ensure_ascii=False)}\n\n"

    seen_question_ids: set[str] = set()
    streamed_questions: list[dict] = []
    processed_question_count = 0

    def observe_questions(content: str) -> Generator[str, None, None]:
        nonlocal processed_question_count
        complete = _complete_quiz_questions(content)
        for raw in complete[processed_question_count:]:
            index = len(streamed_questions)
            item = _normalize_clarification_question(raw, index, seen_question_ids)
            if not item:
                continue
            streamed_questions.append(item)
            state["questions_asked"].append(item["question"])
            state["current_question"] = item
            if len(streamed_questions) == 1:
                yield f"data: {json.dumps({'type': 'question_start', 'questionNumber': state['question_count'] + 1}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'questions', 'questions': [item], 'sessionId': session_id}, ensure_ascii=False)}\n\n"
        processed_question_count = len(complete)

    agent_events = []

    try:
        yield from _stream_agent_sse(
            client, messages, max_tokens, agent_events,
            content_observer=observe_questions,
        )
    except Exception as e:
        print(f"[Outline Agent] Error during agent loop: {e}")
        import traceback
        traceback.print_exc()
        msg = _user_friendly_error(e)
        yield f"data: {json.dumps({'type': 'error', 'message': msg}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    # 解析最终内容
    full_content = _extract_content_from_agent_events(agent_events)

    # 去除可能的 thinking 标签（兼容 reasoning_split=False 的情况）
    content_clean = re.sub(r'Thinking.*?Thinking', '', full_content, flags=re.DOTALL).strip()

    parsed = parse_content_blocks(content_clean)

    # 低置信度且有可迁移背景时，先强制完成一次起点校准，避免默认从小白开始。
    if calibration_required and parsed.get("outline") and state["question_count"] == 0:
        messages.append({"role": "assistant", "content": content_clean})
        messages.append({
            "role": "user",
            "content": (
                "先不要输出学习计划。请基于已有画像，只提出 1 个最能确认当前主题实际掌握边界的单选题；"
                "问题要询问用户实际做过什么或能独立完成什么。"
            ),
        })
        agent_events = []
        try:
            yield from _stream_agent_sse(
                client, messages, max_tokens, agent_events,
                content_observer=observe_questions,
            )
        except Exception as e:
            print(f"[Outline Agent] Calibration error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': _user_friendly_error(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        full_content = _extract_content_from_agent_events(agent_events)
        content_clean = re.sub(r'Thinking.*?Thinking', '', full_content, flags=re.DOTALL).strip()
        parsed = parse_content_blocks(content_clean)
        if parsed.get("outline") and not parsed.get("questions"):
            question = _fallback_calibration_question(topic)
            parsed = {"questions": [question], "outline": None}
            content_clean = question["question"]
            messages.append({"role": "assistant", "content": content_clean})

    # 生成 session_id 并保存状态
    questions = parsed.get("questions") or []
    if questions:
        if len(streamed_questions) < len(questions):
            yield from _emit_clarification_form(
                questions[len(streamed_questions):],
                session_id,
                state,
            )
    elif parsed.get("outline"):
        outline = parsed["outline"]
        blueprint = {
            "learningDirection": outline.get("learningDirection", ""),
            "learningKeypoint": outline.get("learningKeypoint", ""),
            "learningGoal": outline.get("learningGoal", ""),
            "learnerPositioning": {
                "estimatedLevel": outline.get("estimatedLevel", "beginner"),
                "difficultySummary": f"水平置信度：{outline.get('levelConfidence', 0.6)}",
                "backgroundSummary": outline.get("backgroundSummary", ""),
                "skipBasics": outline.get("skipBasics") or [],
                "likelyGaps": outline.get("likelyGaps") or [],
                "levelConfidence": outline.get("levelConfidence", 0.6),
                "preferredExampleDomains": outline.get("preferredExampleDomains") or [],
                "personalExampleLimit": outline.get("personalExampleLimit", 1),
                "whyThisCourseFits": "",
            },
        }
        state["blueprint"] = blueprint

        yield f"data: {json.dumps({'type': 'blueprint_start'}, ensure_ascii=False)}\n\n"
        for field in ["learningDirection", "learningGoal", "learnerPositioning"]:
            yield f"data: {json.dumps({'type': 'blueprint_field', 'field': field, 'value': blueprint[field]}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'type': 'confirmation', 'blueprint': blueprint, 'sessionId': session_id}, ensure_ascii=False)}\n\n"

    # 保存 messages 到 state：先写入本轮 AI 回复，下一轮模型才能看到
    # 自己提过的问题，否则会反复提出相似问题（澄清循环）
    if content_clean:
        messages.append({"role": "assistant", "content": content_clean})
    state["llm_messages"] = messages
    session_store.update(session_id, state)

    yield "data: [DONE]\n\n"


def stream_answer_with_tools(
    session_id: str,
    answer: str = "",
    answers: list[dict] | None = None,
    max_tokens: int = 8000,
) -> Generator[str, None, None]:
    """Agent 版 outline 多轮回答（带搜索能力）

    流程:
    1. 从 session 恢复历史 messages
    2. 追加用户回答
    3. 使用 AgentClient 进行 tool-calling 循环
    4. 解析最终内容，输出 questions/blueprint 事件
    5. 更新 session 状态

    Yields: SSE 格式字符串
    """
    from memory.session import get_session_store
    session_store = get_session_store()
    session = session_store.get(session_id)
    if not session:
        yield f"data: {json.dumps({'type': 'error', 'message': 'Session not found'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    state = session.state
    answer_text = _format_clarification_answers(answers, answer)
    if not answer_text:
        yield f"data: {json.dumps({'type': 'error', 'message': '缺少澄清回答', 'retryable': True}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return
    if answers:
        valid_answers = [str(item.get("answer") or "").strip() for item in answers if str(item.get("answer") or "").strip()]
        state["answers"].extend(valid_answers)
        state["question_count"] += len(valid_answers)
    else:
        state["answers"].append(answer_text)
        state["question_count"] += 1

    # 恢复历史 messages + 本轮用户回答
    messages = list(state.get("llm_messages", []))
    messages.append({"role": "user", "content": answer_text})
    if state.get("forced_calibration"):
        messages.append({
            "role": "user",
            "content": (
                "校准信息已收到。请结合这些回答直接输出 <outline> 学习计划，"
                "不要再提问；无法确定的内容写入 gaps，不要退回零基础假设。"
            ),
        })
        state["forced_calibration"] = False

    client = AgentClient()
    agent_events = []

    try:
        yield from _stream_agent_sse(client, messages, max_tokens, agent_events)
    except Exception as e:
        print(f"[Outline Answer Agent] Error: {e}")
        import traceback
        traceback.print_exc()
        msg = _user_friendly_error(e)
        yield f"data: {json.dumps({'type': 'error', 'message': msg}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    # 解析最终内容
    full_content = _extract_content_from_agent_events(agent_events)
    content_clean = re.sub(r'Thinking.*?Thinking', '', full_content, flags=re.DOTALL).strip()
    parsed = parse_content_blocks(content_clean)

    # 防御：累计提问已达上限但模型仍要提问时，追加指令再跑一轮，强制收敛到学习计划
    if parsed.get("questions") and not parsed.get("outline") and state["question_count"] >= MAX_QUESTIONS:
        print(f"[Outline Answer Agent] 提问数已达上限（{state['question_count']}），强制收敛到学习计划")
        messages.append({"role": "assistant", "content": content_clean})
        messages.append({"role": "user", "content": "已收集到足够信息，请不要再提问。请直接按输出格式给出 <outline> 学习计划。"})
        agent_events = []
        try:
            yield from _stream_agent_sse(client, messages, max_tokens, agent_events)
        except Exception as e:
            print(f"[Outline Answer Agent] Force converge error: {e}")
            import traceback
            traceback.print_exc()
            msg = _user_friendly_error(e)
            yield f"data: {json.dumps({'type': 'error', 'message': msg}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return
        full_content = _extract_content_from_agent_events(agent_events)
        content_clean = re.sub(r'Thinking.*?Thinking', '', full_content, flags=re.DOTALL).strip()
        parsed = parse_content_blocks(content_clean)

    questions = parsed.get("questions") or []
    if questions:
        yield from _emit_clarification_form(questions, session_id, state)
    elif parsed.get("outline"):
        outline = parsed["outline"]
        blueprint = {
            "learningDirection": outline.get("learningDirection", ""),
            "learningKeypoint": outline.get("learningKeypoint", ""),
            "learningGoal": outline.get("learningGoal", ""),
            "learnerPositioning": {
                "estimatedLevel": outline.get("estimatedLevel", "beginner"),
                "difficultySummary": f"水平置信度：{outline.get('levelConfidence', 0.6)}",
                "backgroundSummary": outline.get("backgroundSummary", ""),
                "skipBasics": outline.get("skipBasics") or [],
                "likelyGaps": outline.get("likelyGaps") or [],
                "levelConfidence": outline.get("levelConfidence", 0.6),
                "preferredExampleDomains": outline.get("preferredExampleDomains") or [],
                "personalExampleLimit": outline.get("personalExampleLimit", 1),
                "whyThisCourseFits": "",
            },
        }
        state["blueprint"] = blueprint

        yield f"data: {json.dumps({'type': 'blueprint_start'}, ensure_ascii=False)}\n\n"
        for field in ["learningDirection", "learningGoal", "learnerPositioning"]:
            yield f"data: {json.dumps({'type': 'blueprint_field', 'field': field, 'value': blueprint[field]}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'type': 'confirmation', 'blueprint': blueprint, 'sessionId': session_id}, ensure_ascii=False)}\n\n"

    # 保存 AI 回复和 messages 到 state：本轮 AI 回复必须写入，
    # 下一轮模型才能看到自己提过的问题，避免重复提问
    if content_clean:
        messages.append({"role": "assistant", "content": content_clean})
    state["llm_messages"] = messages
    session_store.update(session_id, state)

    yield "data: [DONE]\n\n"
