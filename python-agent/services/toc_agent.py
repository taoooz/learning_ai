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
    max_tokens: int = 4000,
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
    # 实时流式解析状态
    streaming_content = ""
    emitted_course_name = None
    emitted_course_description = None
    emitted_nodes = []       # 已流式输出的节点，最终解析失败时用于兜底
    consumed_node_count = 0  # 已扫描的节点数（含无效节点，避免重复扫描）

    def _try_parse_and_yield():
        """从当前累积内容中增量解析 TOC 字段并 yield SSE 事件"""
        nonlocal emitted_course_name, emitted_course_description, consumed_node_count
        content_clean = re.sub(r'Thinking.*?Thinking', '', streaming_content, flags=re.DOTALL).strip()
        if not content_clean:
            return

        course_name = _extract_json_string_field(content_clean, "courseName")
        if course_name and course_name != emitted_course_name:
            emitted_course_name = course_name
            yield f"data: {json.dumps({'type': 'course_name', 'value': course_name}, ensure_ascii=False)}\n\n"

        course_description = _extract_json_string_field(content_clean, "courseDescription")
        if course_description and course_description != emitted_course_description:
            emitted_course_description = course_description
            yield f"data: {json.dumps({'type': 'course_description', 'value': course_description}, ensure_ascii=False)}\n\n"

        nodes = _extract_complete_node_objects(content_clean)
        while consumed_node_count < len(nodes):
            node = nodes[consumed_node_count]
            consumed_node_count += 1
            if isinstance(node, dict) and all(key in node for key in ("index", "title", "description")):
                emitted_node = {
                    'index': node['index'],
                    'title': node['title'],
                    'description': node['description'],
                    'frame': node.get('frame', 'total_split_total'),
                }
                emitted_nodes.append(emitted_node)
                yield f"data: {json.dumps({'type': 'node', 'node': emitted_node}, ensure_ascii=False)}\n\n"

    try:
        for event in client.stream_chat_with_tools(
            messages=messages,
            tools=SEARCH_TOOLS,
            tool_functions=TOOL_FUNCTIONS,
            max_tokens=max_tokens,
            reasoning_split=True,
            max_iterations=5,
        ):
            agent_events.append(event)

            if event["type"] == "thinking":
                yield f"data: {json.dumps({'type': 'thinking', 'message': event['message']}, ensure_ascii=False)}\n\n"

            elif event["type"] == "content_delta":
                streaming_content += event["content"]
                for sse in _try_parse_and_yield():
                    yield sse

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
        from services.outline_agent import _user_friendly_error
        yield f"data: {json.dumps({'type': 'error', 'message': _user_friendly_error(e)}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    # 最终兜底解析（确保 complete 事件包含完整数据）
    content_clean = re.sub(r'Thinking.*?Thinking', '', streaming_content, flags=re.DOTALL).strip()
    from lib.minimax import parse_json_response
    result = None
    try:
        parsed = parse_json_response(content_clean)
        parsed_nodes = parsed.get("nodes") if isinstance(parsed, dict) else None
        if isinstance(parsed_nodes, list) and parsed_nodes:
            result = parsed
    except Exception:
        pass

    if result is None:
        # 最终解析失败或未解析出节点：退化为流式阶段已提取的节点数据
        result = {
            "courseName": emitted_course_name or blueprint.get("topic", ""),
            "courseDescription": emitted_course_description or "",
            "nodes": emitted_nodes,
        }

    if not result.get("nodes"):
        # 空目录不可用：明确发 error 事件，让前端展示错误并引导重试，
        # 而不是用空结果假装完成（静默降级）
        yield f"data: {json.dumps({'type': 'error', 'message': '课程目录生成失败，请重试'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    yield f"data: {json.dumps({'type': 'complete', 'result': result}, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"
