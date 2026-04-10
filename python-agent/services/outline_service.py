"""
Outline Agent 业务逻辑服务
负责 prompt 构建、流式调用、状态管理
"""
import json
from typing import TypedDict, Optional, AsyncGenerator
from lib.minimax import MiniMaxClient, parse_json_response
from lib.constants import LEVEL_DESCRIPTIONS, LEARNING_STYLE_DESCRIPTIONS, TECHNICAL_LEVEL_DESCRIPTIONS
from memory.session import get_session_store


class OutlineState(TypedDict):
    """Outline Agent 状态"""
    session_id: str
    agent_type: str
    topic: str
    user_profile: dict
    user_memory: dict
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


def _format_recent_courses(user_memory: dict) -> str:
    """从 user_memory 中提取近期相关课程"""
    recent = user_memory.get('recentRelevantCourses', [])
    if not recent:
        return ''
    courses = [f"- {c.get('topic', '')}：{c.get('summary', '')}" for c in recent]
    return '\n'.join(courses)


def build_initial_prompt(topic: str, user_profile: dict, user_memory: dict) -> str:
    """构建 system prompt（角色 + 指令 + 用户数据 + 格式约束）"""
    # 用户画像
    profile_section = _format_user_profile(user_profile) if user_profile else '暂无'

    # 近期相关课程（无数据时不输出此模块）
    recent_section = ''
    if user_memory:
        recent_text = _format_recent_courses(user_memory)
        if recent_text:
            recent_section = f"\n\n## 近期相关课程\n{recent_text}"

    return f"""你是一名专业的老师，擅长根据基础信息，为用户设计个性化学习计划。

# 基础信息

## 1. 用户学习诉求
{topic}

## 2. 用户画像
{profile_section}{recent_section}

# 任务要求

结合 用户学习诉求 和 基础信息，完成以下两步后按格式输出。

## 第一步：分析

### 1.1 判断实际需求
透过用户诉求看本质，思考用户潜在的实际学习需求是什么。

### 1.2 确定课程设计重点
基于实际需求，从以下维度中选择 2-5 个作为课程讲解重点：
- 概念解析：重点讲解定义、术语、分类和基本框架
- 原理机制：重点讲解底层逻辑、因果关系和运作方式
- 实践应用：重点讲解操作步骤、工具使用、实际案例和解决的问题
- 商业价值：重点讲解市场机会、盈利模式、竞争格局和投资回报
- 发展趋势：重点讲解演进方向、行业变化和前沿动态
- 成本效益：重点讲解投入产出、资源消耗和 ROI 分析
- 对比辨析：重点讲解优劣对比、适用边界和选择标准
- 决策策略：重点讲解评估方法、权衡思路和决策框架

## 第二步：生成学习计划

### 信息足够时
直接输出学习计划。结构如下：
- **课程定位**（direction）：参考实际需求，概括这门课的范围（建议 30 字内）
- **课程重点**（keypoint）：基于选定的设计重点维度，总结课程内容重心（建议 40 字内）
- **学习目标**（object）：学完后用户能达到什么效果，具体不务虚（建议 50 字内）
- **个人情况**（learnerPositioning）：
  - 当前水平（level）：用户在该方向上的知识水平，单选 初级/中级/高级
  - 相关背景（background）：用户信息中与该课程相关的经历（无内容时不输出）
  - 已掌握知识（knowledge）：该方向上用户已掌握的知识点（无内容时不输出）

### 当前信息不足以生成可靠的学习计划时
你可以向用户提出至多 3 个单选题收集相关信息，每次提 1 个。

# 输出格式

## 需提问时
<quiz id="1">
<div slot="question">问题描述</div>
<div slot="option_A">选项 A 描述</div>
<div slot="option_B">选项 B 描述</div>
<div slot="option_C">选项 C 描述</div>
<div slot="option_D">选项 D 描述</div>
</quiz>

## 无需提问时（相关背景和已掌握知识如果没有，就不要输出这两行）
<outline>
<div slot="direction">课程定位</div>
<div slot="keypoint">课程重点</div>
<div slot="object">学习目标</div>
<div slot="level">初级/中级/高级</div>
<div slot="background">用户相关背景</div>
<div slot="knowledge">已掌握1：xxx；已掌握2：xxx</div>
</outline>

# 重要提示
- 第一步的分析结论要在第二步的 direction、keypoint、object 中体现，不要单独输出分析过程
- 严格按照输出格式返回内容，不要输出其他格式、不要添加额外说明
- 需要提问时，每次仅提出 1 个问题，累计最多 3 个"""


async def stream_llm_and_parse(messages: list[dict] | str, max_tokens: int = 1000):
    """流式调用 LLM，yield thinking + content_delta 事件
    messages: messages 数组，或 system prompt 字符串（自动包装）
    """
    # 向后兼容：如果传入字符串，自动包装为 messages
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

        result["outline"] = {
            "learningDirection": direction_match.group(1).strip() if direction_match else "",
            "learningKeypoint": keypoint_match.group(1).strip() if keypoint_match else "",
            "learningGoal": object_match.group(1).strip() if object_match else "",
            "estimatedLevel": level_match.group(1).strip() if level_match else "",
            "backgroundSummary": background_match.group(1).strip() if background_match else None,
            "skipBasics": knowledge_match.group(1).strip().split('；') if knowledge_match else None,
        }
    
    return result


async def stream_blueprint_fields(blueprint: dict):
    """逐字段 yield blueprint SSE 事件"""
    yield {"type": "blueprint_start"}
    for field in ["learningDirection", "learningGoal", "learnerPositioning"]:
        if field in blueprint:
            yield {"type": "blueprint_field", "field": field, "value": blueprint[field]}


def make_initial_state(topic: str, user_profile: dict, user_memory: dict) -> OutlineState:
    return {
        "session_id": "",
        "agent_type": "outline",
        "topic": topic,
        "user_profile": user_profile,
        "user_memory": user_memory,
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
