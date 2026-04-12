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


def _extract_content_from_agent_events(events: list[dict]) -> str:
    """从 Agent 事件序列中提取最终内容文本"""
    parts = []
    for event in events:
        if event["type"] == "content_delta":
            parts.append(event["content"])
    return "".join(parts)


def stream_outline_with_tools(
    topic: str,
    user_profile: dict,
    user_memory: dict,
    max_tokens: int = 3000,
) -> Generator[dict, None, None]:
    """Agent 版 outline 生成（带搜索能力）

    Yields: dict 事件（由 EventSourceResponse 包装为 SSE）
    """
    client = AgentClient()
    system_prompt = build_initial_prompt(topic, user_profile, user_memory)
    state = make_initial_state(topic, user_profile, user_memory)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "请开始。"},
    ]

    agent_events = []

    try:
        for event in client.stream_chat_with_tools(
            messages=messages,
            tools=SEARCH_TOOLS,
            tool_functions=TOOL_FUNCTIONS,
            max_tokens=max_tokens,
            reasoning_split=True,
            max_iterations=10,
        ):
            agent_events.append(event)

            if event["type"] == "thinking":
                yield {"type": "thinking", "message": event["message"]}

            elif event["type"] == "tool_call":
                tool_name = event["tool"]
                tool_args = event["args"]
                if tool_name == "web_search":
                    query = tool_args.get("query", "")
                    yield {"type": "thinking", "message": f"正在搜索：{query}"}
                elif tool_name == "read_url":
                    url = tool_args.get("url", "")
                    yield {"type": "thinking", "message": f"正在读取：{url}"}

            elif event["type"] == "content_delta":
                yield {"type": "content_delta", "content": event["content"]}

    except Exception as e:
        print(f"[Outline Agent] Error during agent loop: {e}")
        import traceback
        traceback.print_exc()
        yield {"type": "error", "message": str(e)}
        return

    # 解析最终内容
    full_content = _extract_content_from_agent_events(agent_events)
    content_clean = re.sub(r'Thinking.*?Thinking', '', full_content, flags=re.DOTALL).strip()
    print(f"[DEBUG] full_content length={len(full_content)}, preview={repr(full_content[:300])}")
    parsed = parse_content_blocks(content_clean)
    print(f"[DEBUG] parsed keys={list(parsed.keys())}, outline={bool(parsed.get('outline'))}")

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

        yield {"type": "question_start", "questionNumber": state["question_count"] + 1}
        yield {"type": "questions", "questions": [q], "sessionId": session_id}

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

        yield {"type": "blueprint_start"}
        for field in ["learningDirection", "learningGoal", "learnerPositioning"]:
            yield {"type": "blueprint_field", "field": field, "value": blueprint[field]}
        yield {"type": "confirmation", "blueprint": blueprint, "sessionId": session_id}

    # 保存 messages 到 state
    state["llm_messages"] = messages
    session_store.update(session_id, state)

    yield {"type": "session_created", "sessionId": session_id}


def stream_answer_with_tools(
    session_id: str,
    answer: str,
    max_tokens: int = 1500,
) -> Generator[dict, None, None]:
    """Agent 版 outline 多轮回答（带搜索能力）

    Yields: dict 事件
    """
    from memory.session import get_session_store
    session_store = get_session_store()
    session = session_store.get(session_id)
    if not session:
        yield {"type": "error", "message": "Session not found"}
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
        for event in client.stream_chat_with_tools(
            messages=messages,
            tools=SEARCH_TOOLS,
            tool_functions=TOOL_FUNCTIONS,
            max_tokens=max_tokens,
            reasoning_split=True,
            max_iterations=10,
        ):
            agent_events.append(event)

            if event["type"] == "thinking":
                yield {"type": "thinking", "message": event["message"]}

            elif event["type"] == "tool_call":
                tool_name = event["tool"]
                tool_args = event["args"]
                if tool_name == "web_search":
                    query = tool_args.get("query", "")
                    yield {"type": "thinking", "message": f"正在搜索：{query}"}
                elif tool_name == "read_url":
                    url = tool_args.get("url", "")
                    yield {"type": "thinking", "message": f"正在读取：{url}"}

            elif event["type"] == "content_delta":
                yield {"type": "content_delta", "content": event["content"]}

    except Exception as e:
        print(f"[Outline Answer Agent] Error: {e}")
        import traceback
        traceback.print_exc()
        yield {"type": "error", "message": str(e)}
        return

    # 解析最终内容
    full_content = _extract_content_from_agent_events(agent_events)
    content_clean = re.sub(r'Thinking.*?Thinking', '', full_content, flags=re.DOTALL).strip()
    print(f"[DEBUG] full_content length={len(full_content)}, preview={repr(full_content[:300])}")
    parsed = parse_content_blocks(content_clean)
    print(f"[DEBUG] parsed keys={list(parsed.keys())}, outline={bool(parsed.get('outline'))}")

    if parsed.get("questions"):
        q = parsed["questions"][0]
        state["questions_asked"].append(q["question"])
        state["current_question"] = q

        yield {"type": "question_start", "questionNumber": state["question_count"] + 1}
        yield {"type": "questions", "questions": [q], "sessionId": session_id}

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

        yield {"type": "blueprint_start"}
        for field in ["learningDirection", "learningGoal", "learnerPositioning"]:
            yield {"type": "blueprint_field", "field": field, "value": blueprint[field]}
        yield {"type": "confirmation", "blueprint": blueprint, "sessionId": session_id}

    # 保存 AI 回复和 messages 到 state
    state["llm_messages"] = messages
    session_store.update(session_id, state)
