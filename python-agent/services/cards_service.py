"""
Cards Agent 业务逻辑服务
负责节点学习卡片生成
"""
from lib.minimax import MiniMaxClient
from lib.constants import LEVEL_DESCRIPTIONS, FRAME_DESCRIPTIONS, LEARNING_STYLE_DESCRIPTIONS, TECHNICAL_LEVEL_DESCRIPTIONS
from prompts import get_prompt

_client: MiniMaxClient | None = None

def get_client() -> MiniMaxClient:
    global _client
    if _client is None:
        _client = MiniMaxClient()
    return _client


def _get_frame_description(frame: str) -> str:
    """获取章节框架描述，未知框架返回默认"""
    return FRAME_DESCRIPTIONS.get(frame, FRAME_DESCRIPTIONS['total_split_total'])


def _get_level_description(level: str) -> str:
    """获取水平描述，未知水平返回默认"""
    return LEVEL_DESCRIPTIONS.get(level, LEVEL_DESCRIPTIONS['beginner'])


def _format_teaching_memory(teaching_memory: dict) -> str:
    """将 teachingMemory 格式化为可读文本"""
    if not teaching_memory:
        return ''

    parts = []

    # 前置概念状态
    prereq_states = teaching_memory.get('prerequisiteConceptStates', [])
    if prereq_states:
        concepts = [f"{s['concept']}（掌握度 {s.get('masteryScore', 0):.0%}，{s.get('status', 'unknown')}）" for s in prereq_states]
        parts.append(f"前置概念：{', '.join(concepts)}")

    # 目标概念状态
    target_states = teaching_memory.get('targetConceptStates', [])
    if target_states:
        concepts = []
        for s in target_states:
            hint = ''
            if s.get('misconceptionHints'):
                hint = f"，易混淆：{', '.join(s['misconceptionHints'][:2])}"
            concepts.append(f"{s['concept']}（掌握度 {s.get('masteryScore', 0):.0%}{hint}）")
        parts.append(f"目标概念：{', '.join(concepts)}")

    # 最近问题
    recent_questions = teaching_memory.get('recentQuestionSummaries', [])
    if recent_questions:
        parts.append(f"最近提问：{'; '.join(recent_questions[:3])}")

    # 类比提示
    analogy_hints = teaching_memory.get('analogyHints', [])
    if analogy_hints:
        parts.append(f"可用类比：{', '.join(analogy_hints[:3])}")

    # 解释风格偏好
    styles = teaching_memory.get('preferredExplanationStyles', [])
    if styles:
        parts.append(f"偏好风格：{', '.join(styles)}")

    return '\n'.join(parts)


def build_cards_prompt(topic: str, payload: dict, enable_search: bool = True) -> str:
    """构建 system prompt（角色 + 指令 + 章节信息 + 用户情况 + 格式约束）"""
    node_title = payload.get('nodeTitle', '')
    teaching_goal = payload.get('teachingGoal', '')
    course_name = payload.get('courseName', topic)
    course_description = payload.get('courseDescription', '')
    user_insights = payload.get('userInsights', '暂无')
    estimated_level = payload.get('estimatedLevel', 'beginner')
    background_summary = payload.get('backgroundSummary', '暂无')
    skip_basics = payload.get('skipBasics', []) or []
    frame = payload.get('frame', 'total_split_total')
    teaching_memory = payload.get('teachingMemory') or {}
    learning_style = payload.get('learningStyle', '')
    technical_level = payload.get('technicalLevel', '')
    value_priorities = payload.get('valuePriorities', []) or []

    prev_node = payload.get('prevNode')
    next_node = payload.get('nextNode')

    prev_section = f"{prev_node['title']}：{prev_node['concepts']}" if prev_node else "无"
    next_section = f"{next_node['title']}：{next_node['concepts']}" if next_node else "无"
    skip_basics_text = '、'.join(skip_basics) if skip_basics else '暂无'

    # 注入章节框架描述和水平描述
    node_frame_description = _get_frame_description(frame)
    level_description = _get_level_description(estimated_level)

    # 格式化教学记忆
    memory_section = _format_teaching_memory(teaching_memory)
    memory_text = f"\n\n## 教学记忆\n{memory_section}" if memory_section else ''

    # 用户偏好标签（使用转换后的描述文案）
    preference_tags = []
    if learning_style:
        desc = LEARNING_STYLE_DESCRIPTIONS.get(learning_style, learning_style)
        preference_tags.append(f"学习风格：{desc}")
    if technical_level:
        desc = TECHNICAL_LEVEL_DESCRIPTIONS.get(technical_level, technical_level)
        preference_tags.append(f"技术接受度：{desc}")
    if value_priorities:
        preference_tags.append(f"价值关注点：{', '.join(value_priorities)}，举例时优先围绕这些方向")
    preference_text = '\n'.join(f"- {t}" for t in preference_tags)

    from datetime import date
    today = date.today().isoformat()

    search_rules = "\n### 搜索行为要求\n- 控制搜索次数，信息够了就不要过度搜索\n- 避免让用户等待过长时间\n- 优先使用已有知识，仅在必要时搜索" if enable_search else ""

    return "\n\n".join([
        get_prompt("cards", "critical_rules", today=today, search_rules=search_rules),
        get_prompt("cards", "chapter_info",
            node_title=node_title, teaching_goal=teaching_goal,
            node_frame_description=node_frame_description,
            course_name=course_name, course_description=course_description,
            prev_section=prev_section, next_section=next_section),
        get_prompt("cards", "user_context",
            user_insights=user_insights, level_description=level_description,
            background_summary=background_summary, skip_basics_text=skip_basics_text,
            preference_text=preference_text, memory_text=memory_text),
        get_prompt("cards", "output_format"),
    ])


async def generate_cards(topic: str, payload: dict) -> dict:
    """生成 Cards"""
    client = get_client()
    system_prompt = build_cards_prompt(topic, payload, enable_search=False)

    content = ""
    for chunk in client.stream_chat_sync(
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": "请生成本章节的学习卡片。"}],
        max_tokens=6000,
    ):
        delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
        content += delta

    # 解析 JSON
    from lib.minimax import parse_json_response
    return parse_json_response(content)
