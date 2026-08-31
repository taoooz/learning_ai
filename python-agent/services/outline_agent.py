"""
Outline Agent 服务 — 带搜索能力的 Agent 版 outline 生成
复用 outline_service 的 prompt 构建和解析逻辑，
通过 AgentClient 实现 function calling 自动搜索
"""
import json
import re
from typing import Generator
from lib.minimax_agent import AgentClient
from lib.tools.search_tools import SEARCH_TOOLS, TOOL_FUNCTIONS
from services.outline_service import (
    build_initial_prompt,
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


def _stream_agent_sse(client, messages: list[dict], max_tokens: int, agent_events: list) -> Generator[str, None, None]:
    """运行 Agent tool-calling 循环，把 agent 事件转成前端 SSE 格式，同时累积到 agent_events"""
    for event in client.stream_chat_with_tools(
        messages=messages,
        tools=SEARCH_TOOLS,
        tool_functions=TOOL_FUNCTIONS,
        max_tokens=max_tokens,
        reasoning_split=True,
        max_iterations=8,
        max_searches=3,
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
                yield f"data: {json.dumps({'type': 'content_delta', 'content': content}, ensure_ascii=False)}\n\n"


def stream_outline_with_tools(
    topic: str,
    user_profile: dict,
    planning_memory: dict,
    max_tokens: int = 6000,
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
    system_prompt = build_initial_prompt(topic, user_profile, planning_memory)
    state = make_initial_state(topic, user_profile, planning_memory)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "请开始。"},
    ]

    agent_events = []

    try:
        yield from _stream_agent_sse(client, messages, max_tokens, agent_events)
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

    # 生成 session_id 并保存状态
    from memory.session import get_session_store
    session_store = get_session_store()
    session = session_store.create("outline", state)
    state["session_id"] = session.session_id
    session_id = session.session_id

    if parsed.get("questions"):
        q = parsed["questions"][0]
        state["questions_asked"].append(q["question"])
        state["current_question"] = q

        yield f"data: {json.dumps({'type': 'question_start', 'questionNumber': state['question_count'] + 1}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'type': 'questions', 'questions': [q], 'sessionId': session_id}, ensure_ascii=False)}\n\n"

    if parsed.get("outline"):
        outline = parsed["outline"]
        blueprint = {
            "learningDirection": outline.get("learningDirection", ""),
            "learningKeypoint": outline.get("learningKeypoint", ""),
            "learningGoal": outline.get("learningGoal", ""),
            "learnerPositioning": {
                "estimatedLevel": outline.get("estimatedLevel", "beginner"),
                "difficultySummary": "",
                "backgroundSummary": outline.get("backgroundSummary", ""),
                "skipBasics": outline.get("skipBasics", []),
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

    yield f"data: {json.dumps({'type': 'session_created', 'sessionId': session_id}, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"


def stream_answer_with_tools(
    session_id: str,
    answer: str,
    max_tokens: int = 4000,
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
    state["answers"].append(answer)
    state["question_count"] += 1

    # 恢复历史 messages + 本轮用户回答
    messages = list(state.get("llm_messages", []))
    messages.append({"role": "user", "content": answer})

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

    if parsed.get("questions"):
        q = parsed["questions"][0]
        state["questions_asked"].append(q["question"])
        state["current_question"] = q

        yield f"data: {json.dumps({'type': 'question_start', 'questionNumber': state['question_count'] + 1}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'type': 'questions', 'questions': [q], 'sessionId': session_id}, ensure_ascii=False)}\n\n"

    if parsed.get("outline"):
        outline = parsed["outline"]
        blueprint = {
            "learningDirection": outline.get("learningDirection", ""),
            "learningKeypoint": outline.get("learningKeypoint", ""),
            "learningGoal": outline.get("learningGoal", ""),
            "learnerPositioning": {
                "estimatedLevel": outline.get("estimatedLevel", "beginner"),
                "difficultySummary": "",
                "backgroundSummary": outline.get("backgroundSummary", ""),
                "skipBasics": outline.get("skipBasics", []),
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
