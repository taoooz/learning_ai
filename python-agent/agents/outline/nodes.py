import json
from typing import Literal
from ..outline.state import OutlineState
from ...lib.minimax import MiniMaxClient, parse_json_response


# 全局 MiniMax 客户端
_minimax_client: MiniMaxClient | None = None


def get_minimax_client() -> MiniMaxClient:
    global _minimax_client
    if _minimax_client is None:
        _minimax_client = MiniMaxClient()
    return _minimax_client


def extract_json_from_response(response: dict) -> dict:
    """从 MiniMax 响应中提取 JSON"""
    content = response.get("choices", [{}])[0].get("message", {}).get("content", "{}")
    return parse_json_response(content)


def initial_node(state: OutlineState) -> OutlineState:
    """初始节点：调用模型判断"""
    client = get_minimax_client()

    # 构建 prompt
    user_profile = state.get("user_profile", {})
    user_memory = state.get("user_memory", {})
    topic = state.get("topic", "")

    # 构建用户信息字符串
    profile_str = f"背景: {user_profile.get('background', '未提供')}"
    memory_str = json.dumps(user_memory, ensure_ascii=False)

    # 如果有之前的问答，加入上下文
    if state.get("answers"):
        qa_pairs = []
        for i, (q, a) in enumerate(zip(state.get("questions_asked", []), state["answers"])):
            qa_pairs.append(f"Q{i+1}: {q}\nA{i+1}: {a}")
        previous_qa = "\n".join(qa_pairs)
        prompt = f"""## 用户之前的问题和回答
{previous_qa}

## 主题
{topic}

基于用户的回答，判断是否还需要问更多问题，还是信息已经足够。
只返回 JSON。"""
    else:
        prompt = f"""## 用户信息
{profile_str}

## 记忆信息
{memory_str}

## 主题
{topic}

请判断是否需要向用户提问以获取更多信息。如果需要，只问最关键的1个问题。
只返回 JSON。"""

    # 调用模型
    response = client.chat(
        messages=[
            {"role": "system", "content": ""},
            {"role": "user", "content": prompt}
        ],
        max_tokens=1000,
    )

    result = extract_json_from_response(response)

    # 根据响应类型更新状态
    if result.get("type") == "questions":
        questions = result.get("questions", [])
        if questions:
            return {
                **state,
                "messages": state["messages"] + [{"role": "assistant", "content": json.dumps(result)}],
                "current_question": questions[0],
                "question_count": state["question_count"] + 1,
                "questions_asked": state["questions_asked"] + [questions[0]["id"]],
                "status": "asking",
                "needs_tools": False,
            }
    elif result.get("type") == "confirmation":
        return {
            **state,
            "messages": state["messages"] + [{"role": "assistant", "content": json.dumps(result)}],
            "blueprint": result.get("blueprint"),
            "status": "confirming",
            "current_question": None,
            "needs_tools": False,
        }
    elif result.get("type") == "reconsider":
        return {
            **state,
            "messages": state["messages"] + [{"role": "assistant", "content": json.dumps(result)}],
            "status": "reconsidering",
            "current_question": None,
            "needs_tools": False,
        }

    return state


def ask_question_node(state: OutlineState) -> OutlineState:
    """提问节点：等待用户回答"""
    return {
        **state,
        "status": "asking",
    }


def receive_answer_node(state: OutlineState, answer: str) -> OutlineState:
    """接收答案节点：存储答案，继续循环"""
    return {
        **state,
        "messages": state["messages"] + [{"role": "user", "content": answer}],
        "answers": state["answers"] + [answer],
        "current_question": None,
        "status": "initial",
    }


def confirm_node(state: OutlineState) -> OutlineState:
    """确认节点：最终 blueprint 已生成"""
    return {
        **state,
        "status": "confirming",
    }


def reconsider_node(state: OutlineState) -> OutlineState:
    """重新思考节点"""
    return {
        **state,
        "status": "reconsidering",
    }
