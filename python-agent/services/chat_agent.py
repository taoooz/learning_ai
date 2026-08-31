"""
Chat Agent 服务 — 带搜索能力的学习对话
Python Agent 端构建 system prompt，叠加搜索能力
AI 自主判断是否需要搜索（不确定时才搜，简单问题直接回答）

输出格式与 MiniMax 原始 SSE 格式兼容，前端无需改动
"""
import json
from typing import Generator, Optional
from lib.minimax_agent import AgentClient
from prompts import get_prompt
from lib.tools.search_tools import SEARCH_TOOLS, TOOL_FUNCTIONS


def _format_content_delta(content: str) -> str:
    """将内容包装为 MiniMax SSE 格式"""
    return f"data: {json.dumps({'choices': [{'delta': {'content': content}}]}, ensure_ascii=False)}\n\n"


def _format_reasoning_delta(text: str) -> str:
    """将思考内容包装为 MiniMax SSE 格式（reasoning_split=true）"""
    return f"data: {json.dumps({'choices': [{'delta': {'reasoning_details': [{'text': text}]}}]}, ensure_ascii=False)}\n\n"


def _build_memory_section(chat_memory: Optional[dict]) -> str:
    """将 ChatMemoryPayload 格式化为记忆重点部分"""
    if not chat_memory:
        return ''

    # 学习旅程总结（LLM 精炼生成）
    learning_summary = chat_memory.get('learningSummary')
    summary_section = ''
    if learning_summary:
        journey = learning_summary.get('journey', '')
        focus = learning_summary.get('currentFocus', '')
        insights = learning_summary.get('learnerInsights', [])
        watch = learning_summary.get('areasToWatch', [])
        summary_section = f"""
## 学习旅程洞察
学习旅程：{journey}
当前重点：{focus}
学习者特点：{'、'.join(insights) if insights else '暂无'}
需关注：{'、'.join(watch) if watch else '暂无'}"""

    topic_summary = chat_memory.get('topicSummary', '暂无')

    focus_states = chat_memory.get('focusConceptStates', [])
    if focus_states:
        focus_lines = []
        for item in focus_states:
            concept = item.get('concept', '')
            status = item.get('status', '')
            score = item.get('masteryScore', 0)
            hints = item.get('misconceptionHints', [])
            hint_str = f"；误区：{' / '.join(hints)}" if hints else ''
            focus_lines.append(f"- {concept}: {status} ({score}){hint_str}")
        focus_text = '\n'.join(focus_lines)
    else:
        focus_text = '暂无'

    risk = chat_memory.get('riskConcepts', [])
    recent_q = chat_memory.get('recentQuestionSummaries', [])
    analogy = chat_memory.get('analogyHints', [])
    styles = chat_memory.get('preferredExplanationStyles', [])

    return f"""## 用户记忆重点
主题摘要：{topic_summary}
当前最该关注的概念：
{focus_text}
高风险概念：{'、'.join(risk) if risk else '暂无'}
最近相关提问：{'；'.join(recent_q) if recent_q else '暂无'}
可用类比：{'；'.join(analogy) if analogy else '暂无'}
偏好解释方式：{'、'.join(styles) if styles else '暂无'}{summary_section}"""


def build_chat_system_prompt(
    course_topic: str,
    context_info: Optional[dict] = None,
    conversation_summary: Optional[dict] = None,
    chat_memory: Optional[dict] = None,
) -> str:
    """构建 chat system prompt（从 Next.js chat-context.ts 迁移）

    近期对话由 messages 数组全量携带（前端已过滤过期消息），
    system prompt 只补充过期对话的压缩摘要，避免历史双份嵌入浪费 token。

    Args:
        course_topic: 课程主题
        context_info: 上下文信息（currentNodeTitle, currentNodeGoal, questionContext）
        conversation_summary: 过期对话摘要
        chat_memory: ChatMemoryPayload 精简记忆
    """
    if not chat_memory:
        return get_prompt("chat", "base")

    # 题目上下文
    question_section = ''
    qc = (context_info or {}).get('questionContext')
    if qc:
        correct = qc.get('correctAnswer', '')
        if isinstance(correct, list):
            correct_text = '、'.join(correct)
        else:
            correct_text = str(correct)

        options = qc.get('options', [])
        options_text = '\n'.join(
            f"{chr(65 + i)}. {opt}" for i, opt in enumerate(options)
        ) if options else '无'

        if qc.get('type') == 'correct':
            question_section = get_prompt("chat", "question_correct",
                question=qc.get('question', ''),
                correct_text=correct_text,
                options_text=options_text)
        else:
            # 将用户答案从完整文本转为序号
            user_answer_raw = qc.get('userAnswer', '')
            if user_answer_raw and options:
                # 查找用户答案在 options 中的索引，转为 ABC 序号
                try:
                    idx = options.index(user_answer_raw)
                    user_answer_text = f"选项 {chr(65 + idx)}"
                except ValueError:
                    user_answer_text = user_answer_raw  # 找不到就用原文
            else:
                user_answer_text = user_answer_raw

            question_section = get_prompt("chat", "question_wrong",
                question=qc.get('question', ''),
                correct_text=correct_text,
                user_answer=user_answer_text,
                options_text=options_text)

    # 当前学习节点
    node_title = (context_info or {}).get('currentNodeTitle')
    node_goal = (context_info or {}).get('currentNodeGoal')
    node_section = ''
    if node_title:
        node_section = get_prompt("chat", "node_section",
            node_title=node_title, node_goal=node_goal or '')

    # 过期对话摘要（近期对话在 messages 数组中，不再重复嵌入）
    expired_summary = (conversation_summary or {}).get('summary')
    summary_section = f"## 更早的对话摘要\n{expired_summary}\n\n" if expired_summary else ''

    memory_section = _build_memory_section(chat_memory)

    system_text = get_prompt("chat", "system")
    return f"""{system_text}

## 当前课程信息
主题：{course_topic}

## 当前学习场景{node_section}{question_section}

{memory_section}

{summary_section}请基于以上信息，简洁回答用户当前问题。"""


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
                yield _format_reasoning_delta(event["message"])

            elif event["type"] == "tool_call":
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
                yield _format_content_delta(event["content"])

            elif event["type"] == "done":
                yield "data: [DONE]\n\n"

    except Exception as e:
        print(f"[Chat Agent] Error: {e}")
        import traceback
        traceback.print_exc()
        yield _format_content_delta(f"抱歉，回复生成失败：{str(e)}")
        yield "data: [DONE]\n\n"
