"""
TOC Agent 服务 — 带搜索能力的 Agent 版课程目录生成
复用 toc_service 的 prompt 构建和解析逻辑，
通过 AgentClient 实现 function calling 自动搜索
"""
import json
import re
from typing import Generator
from lib.minimax_agent import AgentClient
from lib.tools.search_tools import SEARCH_TOOLS, TOOL_FUNCTIONS
from services.toc_service import (
    build_toc_prompt,
    _extract_json_string_field,
    _extract_complete_node_objects,
)


def stream_toc_with_tools(
    blueprint: dict,
    planning_payload: dict = None,
    user_profile: dict = None,
    max_tokens: int = 2000,
) -> Generator[str, None, None]:
    """Agent 版 TOC 生成（带搜索能力）

    流程:
    1. 构建 prompt（复用 toc_service 的 build_toc_prompt）
    2. 使用 AgentClient 进行 tool-calling 循环
    3. 将 Agent 事件转换为前端期望的 SSE 格式（thinking/tool 信息）
    4. 解析最终内容，逐字段 yield 和原版 stream_toc_events 一致的事件格式

    Yields: SSE 格式字符串（data: {...}\n\n）
    """
    client = AgentClient()
    system_prompt = build_toc_prompt(blueprint, planning_payload, user_profile)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "请生成课程目录。"},
    ]

    agent_events = []

    try:
        for event in client.stream_chat_with_tools(
            messages=messages,
            tools=SEARCH_TOOLS,
            tool_functions=TOOL_FUNCTIONS,
            max_tokens=max_tokens,
            reasoning_split=True,
            max_iterations=3,
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

    except Exception as e:
        print(f"[TOC Agent] Error during agent loop: {e}")
        import traceback
        traceback.print_exc()
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    # 从 agent 事件中提取最终内容
    full_content = ""
    for event in agent_events:
        if event["type"] == "content_delta":
            full_content += event["content"]

    # 去除可能的 thinking 标签
    content_clean = re.sub(r'Thinking.*?Thinking', '', full_content, flags=re.DOTALL).strip()

    # 解析并 yield 事件（和 stream_toc_events 输出格式一致）
    emitted_course_name = None
    emitted_course_description = None
    emitted_node_count = 0

    course_name = _extract_json_string_field(content_clean, "courseName")
    if course_name and course_name != emitted_course_name:
        emitted_course_name = course_name
        yield f"data: {json.dumps({'type': 'course_name', 'value': course_name}, ensure_ascii=False)}\n\n"

    course_description = _extract_json_string_field(content_clean, "courseDescription")
    if course_description and course_description != emitted_course_description:
        emitted_course_description = course_description
        yield f"data: {json.dumps({'type': 'course_description', 'value': course_description}, ensure_ascii=False)}\n\n"

    nodes = _extract_complete_node_objects(content_clean)
    while emitted_node_count < len(nodes):
        node = nodes[emitted_node_count]
        if isinstance(node, dict) and all(key in node for key in ("index", "title", "description")):
            yield f"data: {json.dumps({'type': 'node', 'node': {'index': node['index'], 'title': node['title'], 'description': node['description'], 'frame': node.get('frame', 'total_split_total')}}, ensure_ascii=False)}\n\n"
        emitted_node_count += 1

    # 完整解析
    from lib.minimax import parse_json_response
    result = parse_json_response(content_clean)
    yield f"data: {json.dumps({'type': 'complete', 'result': result}, ensure_ascii=False)}\n\n"

    yield "data: [DONE]\n\n"
