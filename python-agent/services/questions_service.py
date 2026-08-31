"""
Questions Agent 业务逻辑服务
负责节点练习题生成
"""
from lib.minimax import MiniMaxClient
from lib.constants import LEVEL_DESCRIPTIONS
from prompts import get_prompt

_client: MiniMaxClient | None = None

def get_client() -> MiniMaxClient:
    global _client
    if _client is None:
        _client = MiniMaxClient()
    return _client


def build_questions_prompt(topic: str, cards: list, payload: dict) -> str:
    """构建 system prompt（角色 + 指令 + 章节信息 + 用户情况 + 格式约束）"""
    course_name = payload.get('courseName', topic)
    node_title = payload.get('nodeTitle', '')
    teaching_goal = payload.get('teachingGoal', '')
    estimated_level = payload.get('estimatedLevel', 'beginner')
    skip_basics = payload.get('skipBasics', []) or []
    work_background = payload.get('workBackground', '')
    education_background = payload.get('educationBackground', '')

    # 卡片标题带上真实 id，供模型把题目绑定到来源卡片（cardId 字段）
    cards_section = '\n'.join([
        f"【卡片 {c.get('id') or f'card-{i+1}'}】{c.get('title', '')}\n{c.get('content', '')}"
        for i, c in enumerate(cards)
    ])

    level_description = LEVEL_DESCRIPTIONS.get(estimated_level, LEVEL_DESCRIPTIONS['beginner'])
    skip_basics_text = '、'.join(skip_basics) if skip_basics else '暂无'

    # 用户情况段落
    user_lines = [f"- 当前水平：{level_description}"]
    user_lines.append(f"- 已掌握知识：{skip_basics_text}")
    if work_background:
        user_lines.append(f"- 工作背景：{work_background}")
    if education_background:
        user_lines.append(f"- 教育背景：{education_background}")
    user_section = '\n'.join(user_lines)

    return get_prompt("questions", "system",
        course_name=course_name,
        node_title=node_title,
        teaching_goal=teaching_goal,
        cards_section=cards_section,
        user_section=user_section,
    )


async def generate_questions(topic: str, cards: list, payload: dict) -> dict:
    """生成 Questions"""
    client = get_client()
    system_prompt = build_questions_prompt(topic, cards, payload)

    content = ""
    for chunk in client.stream_chat_sync(
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": "请生成本章节的练习题。"}],
        max_tokens=8000,
    ):
        delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
        content += delta

    # 解析 JSON
    from lib.minimax import parse_json_response
    return parse_json_response(content)
