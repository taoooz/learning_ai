from langgraph.graph import StateGraph, END
from ..outline.state import OutlineState
from .nodes import initial_node, ask_question_node, confirm_node, reconsider_node


def should_continue(state: OutlineState) -> str:
    """边路由：判断下一步"""
    # 如果是重新思考，直接结束让用户重试
    if state.get("status") == "reconsidering":
        return "reconsider"

    # 如果有当前问题，返回提问节点
    if state.get("current_question") is not None:
        return "ask_question"

    # 如果有 blueprint，返回确认节点
    if state.get("blueprint") is not None:
        return "confirm"

    # 如果需要工具调用
    if state.get("needs_tools"):
        return "tool_calling"

    # 默认回到初始节点
    return "initial"


def create_outline_graph():
    """创建 Outline Agent 的 LangGraph"""
    builder = StateGraph(OutlineState)

    # 添加节点
    builder.add_node("initial", initial_node)
    builder.add_node("ask_question", ask_question_node)
    builder.add_node("confirm", confirm_node)
    builder.add_node("reconsider", reconsider_node)

    # 设置入口点
    builder.set_entry_point("initial")

    # 条件边：从 initial 出发
    builder.add_conditional_edges(
        "initial",
        should_continue,
        {
            "ask_question": "ask_question",
            "confirm": "confirm",
            "reconsider": "reconsider",
            "tool_calling": "tool_calling",
            "initial": "initial",  # 循环回到 initial
        }
    )

    # 边：从 ask_question 结束，等待用户回答（通过外部 API）
    builder.add_edge("ask_question", END)

    # 边：其他节点结束
    builder.add_edge("confirm", END)
    builder.add_edge("reconsider", END)

    return builder.compile()
