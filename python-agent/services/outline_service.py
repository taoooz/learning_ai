"""
Outline Agent 业务逻辑服务
负责 prompt 构建、输出解析与状态管理
"""
from typing import TypedDict, Optional
from prompts import build_prompt
from lib.tools.memory_tools import MEMORY_SEARCH_POLICY
from services.memory_context_v4 import wrap_untrusted_context


class OutlineState(TypedDict):
    """Outline Agent 状态"""
    session_id: str
    agent_type: str
    topic: str
    user_profile: dict
    planning_memory: dict
    current_question: Optional[dict]
    question_count: int
    questions_asked: list[str]
    answers: list[str]
    blueprint: Optional[dict]
    status: str

# prompt 约定模型输出中文水平词，但前端展示与下游消费均以英文键为准，
# 统一在解析层归一化，避免各消费方各自踩空
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


def build_initial_messages(
    topic: str,
    user_profile: dict,
    planning_memory: dict,
    needs_calibration: bool = False,
    allow_memory_search: bool = False,
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
    if allow_memory_search:
        system_prompt += "\n\n" + MEMORY_SEARCH_POLICY
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


def make_initial_state(topic: str, user_profile: dict, planning_memory: dict) -> OutlineState:
    return {
        "session_id": "",
        "agent_type": "outline",
        "topic": topic,
        "user_profile": user_profile,
        "planning_memory": planning_memory,
        "llm_messages": [],  # 多轮对话 messages 数组
        "current_question": None,
        "question_count": 0,
        "questions_asked": [],
        "answers": [],
        "blueprint": None,
        "status": "initial",
    }
