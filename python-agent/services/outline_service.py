"""
Outline Agent 业务逻辑服务
负责 prompt 构建、流式调用、状态管理
"""
import json
from typing import AsyncGenerator
from lib.minimax import MiniMaxClient, parse_json_response
from agents.outline.state import OutlineState
from memory.session import get_session_store

BLUEPRINT_SCHEMA = """
{
  "learningDirection": "学习方向描述（1-2句话）",
  "learningGoal": "学习目标描述（1-2句话）",
  "learnerPositioning": {
    "estimatedLevel": "novice | beginner | intermediate | advanced 之一",
    "difficultySummary": "难度定位说明",
    "backgroundSummary": "背景知识说明",
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


def build_initial_prompt(topic: str, user_profile: dict, user_memory: dict) -> str:
    """构建初始 prompt"""
    sections = []
    
    # 用户画像
    if user_profile and user_profile.get('insights'):
        insights = user_profile['insights']
        insights_str = f"""知识背景：{', '.join(insights.get('knowledgeBackground', []))}
类比经历：{', '.join(insights.get('analogyExperiences', []))}
总结：{insights.get('summary', '')}"""
        sections.append(f"### 用户画像\n{insights_str}")
    
    # 其他信息
    if user_memory:
        memory_items = []
        if user_memory.get('careerGoal'):
            memory_items.append(f"求职目标：{user_memory['careerGoal']}")
        if user_memory.get('recentCourses'):
            courses = [f"{c.get('topic', '')}" for c in user_memory.get('recentCourses', [])]
            memory_items.append(f"近期相关课程：{', '.join(courses)}")
        if memory_items:
            sections.append(f"### 其他信息\n" + '\n'.join(memory_items))
    
    user_info_section = '\n\n'.join(sections) if sections else '无'
    
    return f"""你是一名专业的老师，擅长结合用户信息设计个性化学习计划。

## 用户学习诉求
{topic}

## 工作方式
结合 用户诉求 和 用户信息 设计学习计划
### 信息足够时
整理学习计划，严格按照约定的md格式输出
### 用户信息不够时
若该信息十分影响学习计划设计，你可以向用户提出至多 3 个单选题收集信息。提问时要在返回时严格按照对应 md 格式输出

## 学习计划结构
1. **学习方向（learningDirection）**：这门课要讲什么，定调。概括课程的核心内容和方向。
2. **学习目标（learningGoal）**：定义本节课要为用户达到什么目标，学完后能怎样。例如掌握 xx 知识、在 xx 方面应用 等。
3. **个人情况（learnerPositioning）**：用户在该学习方向上的情况
   - 当前水平（estimatedLevel）: （初级/中级/高级）
   - 相关背景（backgroundSummary）: 用户信息中与此课程有关，可以在设计具体课程时参考的内容（无内容时，不返回此字段）
   - 已掌握知识（skipBasics）: 该学习方向上用户已经掌握的知识点（无内容时，不返回此字段）

## 用户信息
{user_info_section}

## 输出格式
### 提问md
<quiz id="1">
<div slot="question">问题描述</div>
<div slot="option_A">选项 A 描述</div>
<div slot="option_B">选项 B 描述</div>
<div slot="option_C">选项 C 描述</div>
<div slot="option_D">选项 D 描述</div>
</quiz>

### 学习计划md（相关背景和已掌握知识如果没有，就不要输出这两行）
<outline>
<div slot="direction">学习方向</div>
<div slot="object">学习目标</div>
<div slot="level">初级/中级/高级</div>
<div slot="background">用户相关背景</div>
<div slot="knowledge">已掌握1：xxx；已掌握2：xxx</div>
</outline>

## 重要提示
- 严格按照输出格式返回内容，不要输出其他格式、不要添加额外说明。
- 需要提问时，每次仅提出1个问题。累计最多3个。

只输出上述格式的内容。"""


async def stream_llm_and_parse(messages: list[dict] | str, max_tokens: int = 1000):
    """流式调用 LLM，yield thinking + content_delta 事件
    messages: messages 数组，或单个 prompt 字符串（自动包装）
    """
    # 向后兼容：如果传入字符串，自动包装为 messages
    if isinstance(messages, str):
        messages = [{"role": "system", "content": ""}, {"role": "user", "content": messages}]

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
        object_match = re.search(r'<div\s+slot="object">(.*?)</div>', outline_content, re.DOTALL)
        level_match = re.search(r'<div\s+slot="level">(.*?)</div>', outline_content, re.DOTALL)
        background_match = re.search(r'<div\s+slot="background">(.*?)</div>', outline_content, re.DOTALL)
        knowledge_match = re.search(r'<div\s+slot="knowledge">(.*?)</div>', outline_content, re.DOTALL)
        
        result["outline"] = {
            "learningDirection": direction_match.group(1).strip() if direction_match else "",
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
