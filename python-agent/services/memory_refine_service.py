"""
Memory Refine Service — LLM 驱动的记忆精炼

分析最近的聊天对话和学习事件，返回结构化洞察：
- 学习旅程总结
- 偏好更新
- 概念理解修正

借鉴 DeepTutor 的 refresh_from_turn 设计，但适配我们的 MemoryStoreV3 架构。
NO_CHANGE 机制：LLM 判断无需修改时返回空结果，避免无意义 token 消耗。
"""
import json
import httpx
import os
from typing import Optional
from prompts import get_prompt


def _build_user_prompt(
    recent_messages: list[dict],
    current_summary: Optional[dict],
    concept_count: int,
    topic_count: int,
    recent_events_summary: str,
) -> str:
    """构建精炼请求的用户消息"""
    parts = []

    # 当前学习总结（如有）
    if current_summary:
        parts.append(f"## 当前学习总结\n旅程：{current_summary.get('journey', '暂无')}\n重点：{current_summary.get('currentFocus', '暂无')}\n洞察：{'、'.join(current_summary.get('learnerInsights', []))}\n待关注：{'、'.join(current_summary.get('areasToWatch', []))}")
    else:
        parts.append("## 当前学习总结\n暂无（首次分析）")

    # 数据概况
    parts.append(f"## 数据概况\n已跟踪概念：{concept_count} 个\n已学习主题：{topic_count} 个")

    # 最近事件摘要
    if recent_events_summary:
        parts.append(f"## 最近学习活动\n{recent_events_summary}")

    # 最近对话（最多保留 10 轮）
    if recent_messages:
        formatted = []
        for msg in recent_messages[-10:]:
            role = "用户" if msg.get("role") == "user" else "助理"
            content = msg.get("content", "").strip()
            if content:
                formatted.append(f"{role}：{content[:200]}")
        if formatted:
            parts.append(f"## 最近对话\n" + "\n".join(formatted))

    return "\n\n".join(parts)


def refine_memory(
    recent_messages: list[dict],
    current_summary: Optional[dict] = None,
    concept_count: int = 0,
    topic_count: int = 0,
    recent_events_summary: str = "",
) -> dict:
    """执行一次记忆精炼

    Args:
        recent_messages: 最近的对话消息列表 [{role, content}, ...]
        current_summary: 当前的 learningSummary（可为 None）
        concept_count: 概念投影数量
        topic_count: 主题投影数量
        recent_events_summary: 最近事件的人工摘要

    Returns:
        MemoryRefineResult 结构的 dict
    """
    # 早期退出：对话太少不值得分析
    user_messages = [m for m in recent_messages if m.get("role") == "user"]
    if len(user_messages) < 3:
        return {"summary": None, "preferenceUpdates": [], "conceptCorrections": []}

    user_prompt = _build_user_prompt(
        recent_messages=recent_messages,
        current_summary=current_summary,
        concept_count=concept_count,
        topic_count=topic_count,
        recent_events_summary=recent_events_summary,
    )

    messages = [
        {"role": "system", "content": get_prompt("memory_refine", "system")},
        {"role": "user", "content": user_prompt},
    ]

    try:
        api_key = os.getenv("LLM_API_KEY", "")
        base_url = os.getenv("LLM_API_BASE", "http://muses-openapi-prod.weizhipin.com/v1")
        model = os.getenv("LLM_MODEL", "muses/deepseek-v4-flash")
        with httpx.Client() as http_client:
            resp = http_client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": 800,
                },
                timeout=60.0,
            )
            resp.raise_for_status()
            response = resp.json()

        content = response.get("choices", [{}])[0].get("message", {}).get("content", "")

        # 解析 JSON（parse_json_response 统一处理 markdown 包裹、未转义引号与裸控制字符）
        from lib.minimax import parse_json_response
        result = parse_json_response(content)

        # 验证结构
        return {
            "summary": result.get("summary"),
            "preferenceUpdates": result.get("preferenceUpdates", []),
            "conceptCorrections": result.get("conceptCorrections", []),
        }

    except json.JSONDecodeError:
        print("[Memory Refine] JSON 解析失败，跳过本次精炼")
        return {"summary": None, "preferenceUpdates": [], "conceptCorrections": []}
    except Exception as e:
        print(f"[Memory Refine] Error: {e}")
        return {"summary": None, "preferenceUpdates": [], "conceptCorrections": []}
