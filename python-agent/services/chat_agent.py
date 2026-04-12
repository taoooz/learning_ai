"""
Chat Agent 服务 — 带搜索能力的学习对话
前端构建好 system prompt 和 messages，Python Agent 透传并叠加搜索能力
AI 自主判断是否需要搜索（不确定时才搜，简单问题直接回答）

输出格式与 MiniMax 原始 SSE 格式兼容，前端无需改动
"""
import json
from typing import Generator
from lib.minimax_agent import AgentClient
from lib.tools.search_tools import SEARCH_TOOLS, TOOL_FUNCTIONS


def _format_content_delta(content: str) -> str:
    """将内容包装为 MiniMax SSE 格式"""
    return f"data: {json.dumps({'choices': [{'delta': {'content': content}}]}, ensure_ascii=False)}\n\n"


def _format_reasoning_delta(text: str) -> str:
    """将思考内容包装为 MiniMax SSE 格式（reasoning_split=true）"""
    return f"data: {json.dumps({'choices': [{'delta': {'reasoning_details': [{'text': text}]}}]}, ensure_ascii=False)}\n\n"


def stream_chat_with_tools(
    messages: list[dict],
    max_tokens: int = 1500,
    max_iterations: int = 2,
) -> Generator[str, None, None]:
    """Agent 版学习对话（带搜索能力，流式）

    AI 自主判断是否需要搜索：
    - 简单概念问题（"什么是闭包"）→ 直接回答
    - 不确定或时效性强的问题 → 先搜索再回答
    - max_iterations=2 限制最多 2 次工具调用，控制延迟

    输出 MiniMax 兼容 SSE 格式，前端解析无需改动：
    - 思考过程: data: {"choices":[{"delta":{"reasoning_details":[{"text":"..."}]}}]}
    - 实际回答: data: {"choices":[{"delta":{"content":"..."}}]}
    - 结束标记: data: [DONE]

    Args:
        messages: 完整的对话历史（system + user/assistant）
        max_tokens: 最大生成 token
        max_iterations: 最大工具调用次数（默认 2，控制延迟）

    Yields: SSE 格式字符串
    """
    client = AgentClient()

    try:
        for event in client.stream_chat_with_tools(
            messages=messages,
            tools=SEARCH_TOOLS,
            tool_functions=TOOL_FUNCTIONS,
            max_tokens=max_tokens,
            reasoning_split=True,
            max_iterations=max_iterations,
        ):
            if event["type"] == "thinking":
                # 思考过程转发为 reasoning_details（前端会显示思考状态）
                yield _format_reasoning_delta(event["message"])

            elif event["type"] == "tool_call":
                # 工具调用时显示搜索提示（作为 reasoning 发送）
                tool_name = event["tool"]
                tool_args = event["args"]
                if tool_name == "web_search":
                    query = tool_args.get("query", "")
                    yield _format_reasoning_delta(f"正在搜索：{query}")
                elif tool_name == "read_url":
                    url = tool_args.get("url", "")
                    yield _format_reasoning_delta(f"正在读取：{url}")

            elif event["type"] == "tool_result":
                pass

            elif event["type"] == "content_delta":
                # 实际回答内容，MiniMax 兼容格式
                yield _format_content_delta(event["content"])

            elif event["type"] == "done":
                yield "data: [DONE]\n\n"

    except Exception as e:
        print(f"[Chat Agent] Error: {e}")
        import traceback
        traceback.print_exc()
        # 错误也用 MiniMax 兼容格式输出
        yield _format_content_delta(f"抱歉，回复生成失败：{str(e)}")
        yield "data: [DONE]\n\n"
