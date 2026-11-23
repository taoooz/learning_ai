"""
Outline Agent 业务逻辑服务
负责 prompt 构建、流式调用、状态管理
"""
import json
from typing import TypedDict, Optional, AsyncGenerator
from lib.minimax import MiniMaxClient, parse_json_response
from lib.constants import LEVEL_DESCRIPTIONS, LEARNING_STYLE_DESCRIPTIONS, TECHNICAL_LEVEL_DESCRIPTIONS
from memory.session import get_session_store
from prompts import build_prompt
from services.memory_context_v4 import wrap_untrusted_context


class OutlineState(TypedDict):
    """Outline Agent 状态"""
    session_id: str
    agent_type: str
    topic: str
    user_profile: dict
    planning_memory: dict
    messages: list[dict]
    current_question: Optional[dict]
    question_count: int
    questions_asked: list[str]
    answers: list[str]
    blueprint: Optional[dict]
    status: str
    needs_tools: bool
    tool_results: list[dict]

BLUEPRINT_SCHEMA = """
{
  "learningDirection": "学习方向描述（1-2句话）",
  "learningGoal": "学习目标描述（1-2句话）",
  "learnerPositioning": {
    "estimatedLevel": "初级 | 中级 | 高级 之一",
    "difficultySummary": "难度定位说明",
    "backgroundSummary": "相关背景说明",
    "skipBasics": ["可以跳过的基础内容列表"],
    "whyThisCourseFits": "为什么这门课适合该用户"
  }
}
"""

_client: MiniMaxClient | None = None

def get_client() -> MiniMaxClient:
    global _client
    if _client is None:
        _client = MiniMaxClient()
    return _client


# prompt 约定模型输出中文水平词，但前端展示与下游 prompt（LEVEL_DESCRIPTIONS 等）
# 均以英文键为准，统一在解析层归一化，避免各消费方各自踩空
_LEVEL_ALIASES = {
    "入门": "novice",
    "零基础": "novice",
    "初级": "beginner",
    "中级": "intermediate",
    "高级": "advanced",
}
_VALID_LEVELS = {"novice", "beginner", "intermediate", "advanced"}


def normalize_level(level: str) -> str:
    """将模型输出的水平值归一化为英文键；无法识别时回退 beginner"""
    value = (level or "").strip()
    normalized = _LEVEL_ALIASES.get(value, value.lower())
    return normalized if normalized in _VALID_LEVELS else "beginner"


def needs_level_calibration(planning_memory: dict | None = None, user_profile: dict | None = None) -> bool:
    """判断是否必须先用一个校准问题确认起点，避免把可迁移背景当成零基础。"""
    memory = planning_memory or {}
    learner = memory.get("learnerSnapshot") or {}
    try:
        confidence = float(learner.get("confidence", 0.35))
    except (TypeError, ValueError):
        confidence = 0.35
    level = str(learner.get("estimatedLevel") or "").lower()
    transferable_background = memory.get("transferableBackground") or []
    insights = (user_profile or {}).get("insights") or {}
    profile_background = (
        insights.get("workSummary") or []
    ) + (insights.get("analogyExperiences") or [])
    has_background = bool(transferable_background or profile_background)

    if confidence < 0.55:
        return True
    return has_background and level in {"novice", "beginner"}


def _format_user_profile(user_profile: dict) -> str:
    """将用户画像 JSON 格式化为可读文本"""
    sections = []

    # 目标岗位
    target_job = user_profile.get('targetJob')
    if target_job:
        sections.append(f"目标岗位：{target_job}")

    insights = user_profile.get('insights')
    if insights:
        # 工作背景
        work_items = insights.get('workSummary', [])
        if work_items:
            sections.append("工作背景：\n" + '\n'.join(f"- {item}" for item in work_items))

        # 教育背景
        edu_items = insights.get('educationSummary', [])
        if edu_items:
            sections.append("教育背景：\n" + '\n'.join(f"- {item}" for item in edu_items))

        # 类比经历
        analogy_items = insights.get('analogyExperiences', [])
        if analogy_items:
            sections.append("类比经历：\n" + '\n'.join(f"- {item}" for item in analogy_items))

        # 学习风格
        learning_style = insights.get('learningStyle')
        if learning_style:
            desc = LEARNING_STYLE_DESCRIPTIONS.get(learning_style, learning_style)
            sections.append(f"学习风格：{desc}")

        # 技术接受度
        tech_level = insights.get('technicalLevel')
        if tech_level:
            desc = TECHNICAL_LEVEL_DESCRIPTIONS.get(tech_level, tech_level)
            sections.append(f"技术接受度：{desc}")

        # 价值关注点
        value_priorities = insights.get('valuePriorities', [])
        if value_priorities:
            sections.append(f"价值关注点：{', '.join(value_priorities)}，举例时优先围绕这些方向")

        # 总结
        summary = insights.get('summary')
        if summary:
            sections.append(f"背景总结：{summary}")

    return '\n\n'.join(sections) if sections else '暂无'


def _format_learning_plan(blueprint: dict) -> str:
    """将 outline blueprint 格式化为可读文本"""
    parts = []
    if blueprint.get('learningDirection'):
        parts.append(f"课程定位：{blueprint['learningDirection']}")
    if blueprint.get('learningKeypoint'):
        parts.append(f"课程重点：{blueprint['learningKeypoint']}")
    if blueprint.get('learningGoal'):
        parts.append(f"学习目标：{blueprint['learningGoal']}")

    positioning = blueprint.get('learnerPositioning', {})
    level = positioning.get('estimatedLevel', '')
    if level:
        level_label = LEVEL_DESCRIPTIONS.get(level, '')
        if level_label:
            parts.append(f"当前水平：{level_label}")
    if positioning.get('backgroundSummary'):
        parts.append(f"相关背景：{positioning['backgroundSummary']}")
    skip = positioning.get('skipBasics', [])
    if skip:
        parts.append(f"已掌握知识：{', '.join(skip)}")

    return '\n'.join(parts) if parts else '暂无'


def _format_planning_memory(planning_memory: dict) -> str:
    """将 PlanningMemoryPayload 格式化为可读文本"""
    sections = []

    learner = planning_memory.get('learnerSnapshot', {})
    if learner:
        level = learner.get('estimatedLevel', '')
        if level:
            level_map = {'novice': '零基础', 'beginner': '初级', 'intermediate': '中级', 'advanced': '高级'}
            sections.append(f"当前水平：{level_map.get(level, level)}")
        goal = learner.get('targetGoal')
        if goal:
            sections.append(f"学习目标：{goal}")

    bg = planning_memory.get('transferableBackground', [])
    if bg:
        sections.append("可迁移背景：\n" + '\n'.join(f"- {item}" for item in bg))

    must_cover = planning_memory.get('mustCoverConcepts', [])
    if must_cover:
        sections.append(f"必须覆盖的概念：{', '.join(must_cover)}")

    skippable = planning_memory.get('skippableBasics', [])
    if skippable:
        sections.append(f"可跳过的基础：{', '.join(skippable)}")

    risk = planning_memory.get('riskConcepts', [])
    if risk:
        sections.append(f"需重点关注的概念：{', '.join(risk)}")

    recent = planning_memory.get('recentRelevantCourses', [])
    if recent:
        courses = [f"- {c.get('topic', '')}：{c.get('summary', '')}" for c in recent]
        sections.append("近期相关课程：\n" + '\n'.join(courses))

    summary = planning_memory.get('learningSummary')
    if summary:
        sections.append(
            "学习旅程摘要：\n"
            f"- 旅程：{summary.get('journey', '')}\n"
            f"- 当前重点：{summary.get('currentFocus', '')}\n"
            f"- 学习者特点：{'、'.join(summary.get('learnerInsights') or []) or '暂无'}\n"
            f"- 需关注：{'、'.join(summary.get('areasToWatch') or []) or '暂无'}"
        )

    return '\n\n'.join(sections) if sections else ''


def build_initial_messages(
    topic: str,
    user_profile: dict,
    planning_memory: dict,
    needs_calibration: bool = False,
) -> dict[str, str]:
    """system 只保留行为与输出契约；本轮用户输入、画像和记忆进入 user prompt。"""
    # 画像和 Memory 都可能包含用户或模型生成文本，统一按不可信数据注入。
    profile_section = wrap_untrusted_context("user_profile", user_profile) if user_profile else '暂无'

    # 精简记忆上下文（无数据时不输出此模块）
    memory_section = ''
    if planning_memory:
        memory_section = wrap_untrusted_context("learning_memory", planning_memory)

    from datetime import date
    today = date.today().isoformat()

    system_prompt = build_prompt(
        "outline",
        ["critical_rules", "output_format"],
        today=today,
    )
    user_prompt = build_prompt(
        "outline",
        ["user_context"],
        topic=topic,
        profile_section=profile_section,
        memory_section=memory_section,
    )
    if needs_calibration:
        system_prompt += (
            "\n\n## 强制校准状态\n"
            "当前画像存在可迁移背景，但尚不足以确认该主题的实际掌握边界。"
            "请先提出 1 个高信息量的单选题，确认用户实际做过什么或能独立完成什么；"
            "收到回答后再输出学习计划，不要先按零基础生成。"
        )
    return {"system": system_prompt, "user": user_prompt}


def build_initial_prompt(topic: str, user_profile: dict, planning_memory: dict, needs_calibration: bool = False) -> str:
    """兼容入口：返回 system + user 的完整文本，供旧调试脚本使用。"""
    messages = build_initial_messages(topic, user_profile, planning_memory, needs_calibration)
    return messages["system"] + "\n\n" + messages["user"]


async def stream_llm_and_parse(messages: list[dict] | str, max_tokens: int = 1000):
    """流式调用 LLM，yield thinking + content_delta 事件
    messages: messages 数组，或 system prompt 字符串（自动包装）
    """
    # 当前内部调用既可能传完整 messages，也可能直接传 system prompt
    if isinstance(messages, str):
        messages = [{"role": "system", "content": messages}, {"role": "user", "content": "请开始。"}]

    client = get_client()
    full_content = ""

    for chunk in client.stream_chat_sync(
        messages=messages,
        max_tokens=max_tokens,
    ):
        delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
        if not delta:
            continue
        
        full_content += delta
        yield {"type": "content_delta", "content": delta}
    
    # 处理完整内容，提取 thinking 和正文
    import re
    think_pattern = r'<think>(.*?)</think>'
    thinks = re.findall(think_pattern, full_content, re.DOTALL)
    
    # 移除 think 标签，得到正文
    content_without_think = re.sub(think_pattern, '', full_content, flags=re.DOTALL).strip()
    
    # 如果有 thinking 内容，发送 thinking 事件
    if thinks:
        for think in thinks:
            yield {"type": "thinking", "message": think.strip()}
    
    # 解析问题和纲要
    parsed = parse_content_blocks(content_without_think)
    yield {"type": "__full_content__", "content": content_without_think, "parsed": parsed}


def parse_content_blocks(content: str) -> dict:
    """解析 HTML 标签格式的问题和纲要"""
    import re
    result = {"questions": [], "outline": None}
    
    # 解析 <quiz>
    quiz_pattern = r'<quiz\s+id="(\d+)">(.*?)</quiz>'
    for match in re.finditer(quiz_pattern, content, re.DOTALL):
        quiz_id = match.group(1)
        quiz_content = match.group(2)
        
        question_match = re.search(r'<div\s+slot="question">(.*?)</div>', quiz_content, re.DOTALL)
        question = question_match.group(1).strip() if question_match else ""
        
        options = []
        for opt_match in re.finditer(r'<div\s+slot="option_([A-Z])">(.*?)</div>', quiz_content, re.DOTALL):
            options.append(opt_match.group(2).strip())
        
        result["questions"].append({"id": quiz_id, "question": question, "options": options})
    
    # 解析 <outline>
    outline_match = re.search(r'<outline>(.*?)</outline>', content, re.DOTALL)
    if outline_match:
        outline_content = outline_match.group(1)
        direction_match = re.search(r'<div\s+slot="direction">(.*?)</div>', outline_content, re.DOTALL)
        keypoint_match = re.search(r'<div\s+slot="keypoint">(.*?)</div>', outline_content, re.DOTALL)
        object_match = re.search(r'<div\s+slot="object">(.*?)</div>', outline_content, re.DOTALL)
        level_match = re.search(r'<div\s+slot="level">(.*?)</div>', outline_content, re.DOTALL)
        background_match = re.search(r'<div\s+slot="background">(.*?)</div>', outline_content, re.DOTALL)
        knowledge_match = re.search(r'<div\s+slot="knowledge">(.*?)</div>', outline_content, re.DOTALL)
        confidence_match = re.search(r'<div\s+slot="confidence">(.*?)</div>', outline_content, re.DOTALL)
        gaps_match = re.search(r'<div\s+slot="gaps">(.*?)</div>', outline_content, re.DOTALL)
        example_domains_match = re.search(r'<div\s+slot="exampleDomains">(.*?)</div>', outline_content, re.DOTALL)
        example_limit_match = re.search(r'<div\s+slot="personalExampleLimit">(.*?)</div>', outline_content, re.DOTALL)

        confidence = None
        if confidence_match:
            try:
                confidence = max(0.0, min(1.0, float(confidence_match.group(1).strip())))
            except ValueError:
                confidence = None
        example_limit = 1
        if example_limit_match:
            try:
                example_limit = max(0, min(3, int(example_limit_match.group(1).strip())))
            except ValueError:
                example_limit = 1

        def _split_slot(value: str) -> list[str]:
            return [
                re.sub(r'^(?:已掌握|可能缺口)\s*\d+\s*[:：]\s*', '', item.strip())
                for item in value.split('；')
                if item.strip()
            ]

        result["outline"] = {
            "learningDirection": direction_match.group(1).strip() if direction_match else "",
            "learningKeypoint": keypoint_match.group(1).strip() if keypoint_match else "",
            "learningGoal": object_match.group(1).strip() if object_match else "",
            "estimatedLevel": normalize_level(level_match.group(1) if level_match else ""),
            "backgroundSummary": background_match.group(1).strip() if background_match else None,
            "skipBasics": _split_slot(knowledge_match.group(1)) if knowledge_match else [],
            "likelyGaps": _split_slot(gaps_match.group(1)) if gaps_match else [],
            "levelConfidence": confidence,
            "preferredExampleDomains": _split_slot(example_domains_match.group(1)) if example_domains_match else [],
            "personalExampleLimit": example_limit,
        }
    
    return result


async def stream_blueprint_fields(blueprint: dict):
    """逐字段 yield blueprint SSE 事件"""
    yield {"type": "blueprint_start"}
    for field in ["learningDirection", "learningGoal", "learnerPositioning"]:
        if field in blueprint:
            yield {"type": "blueprint_field", "field": field, "value": blueprint[field]}


def make_initial_state(topic: str, user_profile: dict, planning_memory: dict) -> OutlineState:
    return {
        "session_id": "",
        "agent_type": "outline",
        "topic": topic,
        "user_profile": user_profile,
        "planning_memory": planning_memory,
        "messages": [],
        "llm_messages": [],  # MiniMax messages 数组，用于多轮对话
        "current_question": None,
        "question_count": 0,
        "questions_asked": [],
        "answers": [],
        "blueprint": None,
        "status": "initial",
        "needs_tools": False,
        "tool_results": [],
    }
