from typing import TypedDict, Optional, Annotated
from langgraph.graph import add_messages


class OutlineState(TypedDict):
    """Outline Agent 状态"""

    # 核心标识
    session_id: str
    agent_type: str  # "outline"

    # 输入
    topic: str
    user_profile: dict
    user_memory: dict

    # 对话历史
    messages: Annotated[list[dict], add_messages]

    # 业务状态
    current_question: Optional[dict]  # {"id": "q1", "question": "...", "options": [...]}
    question_count: int  # 已问问题数，最多 3
    questions_asked: list[str]  # 已问问题的 ID 列表
    answers: list[str]  # 用户回答
    blueprint: Optional[dict]  # 最终 blueprint

    # 状态机状态
    status: str  # initial/asking/confirming/reconsidering

    # 工具调用标记
    needs_tools: bool
    tool_results: list[dict]