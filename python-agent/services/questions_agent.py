"""
Questions Agent 服务 — 带搜索能力的 Agent 版练习题生成
复用 questions_service 的 prompt 构建逻辑，
通过 AgentClient 实现 function calling 自动搜索
"""
from lib.minimax_agent import AgentClient
from lib.tools.search_tools import SEARCH_TOOLS, TOOL_FUNCTIONS
from services.questions_service import build_questions_prompt


def generate_questions_with_tools(topic: str, cards: list, payload: dict) -> dict:
    """Agent 版 Questions 生成（带搜索能力）

    流程:
    1. 构建 prompt（复用 questions_service 的 build_questions_prompt）
    2. 使用流式 AgentClient 进行 tool-calling 循环
    3. 解析最终 JSON 并返回

    Returns: 解析后的 questions JSON
    """
    client = AgentClient()
    system_prompt = build_questions_prompt(topic, cards, payload)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "请生成本章节的练习题。"},
    ]

    # 使用流式调用，max_searches=1 限制搜索（出题基本不需要搜索）
    full_content = ""
    for event in client.stream_chat_with_tools(
        messages=messages,
        tools=SEARCH_TOOLS,
        tool_functions=TOOL_FUNCTIONS,
        max_tokens=8000,
        reasoning_split=True,
        max_iterations=3,
        max_searches=1,
    ):
        if event["type"] == "content_delta":
            full_content += event["content"]

    # 解析 JSON（parse_json_response 内部统一处理 XML 清理和控制字符）
    from lib.minimax import parse_json_response
    return parse_json_response(full_content)
