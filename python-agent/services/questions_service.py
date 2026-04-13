"""
Questions Agent 业务逻辑服务
负责节点练习题生成
"""
from lib.minimax import MiniMaxClient
from lib.constants import LEVEL_DESCRIPTIONS

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

    cards_section = '\n'.join([f"【卡片 {i+1}】{c.get('title', '')}\n{c.get('content', '')}" for i, c in enumerate(cards)])

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

    return f"""你是一名专业的 AI 老师，负责根据章节学习内容生成高质量的练习题。

# 参考信息

## 章节信息
课程名称：{course_name}
章节名称：{node_title}
章节目标：{teaching_goal}

## 章节学习内容
{cards_section}

## 用户情况
{user_section}

# 任务要求

根据学习内容，生成 3-5 道练习题。

## 题型分布
- 至少 1 道 single（单选题）
- 至少 1 道 multiple（多选题，至少 2 个正确选项）
- 可选 sorting（排序题，将条目按正确顺序排列）

## 出题维度
可参考以下 4 个维度：
- memory：记忆，考察概念、定义、事实的准确记忆
- understanding：理解，考察原理、因果关系的理解
- application：应用，考察在场景中运用知识的能力
- analysis：分析，考察拆解、对比、评估能力
同一维度不要超过 2 道，尽量覆盖多个维度。

## 出题难度梯度
- 1：基础识记，直接从内容中找到答案
- 2：需要理解和简单推理
- 3：需要综合分析和场景应用
根据用户水平调整难度分布：水平低则 1-2 居多，水平高则 2-3 居多。

## 题目质量
- 题干和选项使用自然语言，避免生硬术语
- 选项中不要包含"A、B、C"或"1、2、3"序号
- 干扰项要有迷惑性，不能一眼看出对错
- 排序题的 answer 为正确顺序的数组

## 输出格式
{{
  "questions": [{{
    "id": "q-1",
    "type": "single",
    "question": "题干",
    "options": ["选项A", "选项B", "选项C", "选项D"],
    "answer": "选项A"
  }}]
}}

只返回合法 JSON。"""


async def generate_questions(topic: str, cards: list, payload: dict) -> dict:
    """生成 Questions"""
    client = get_client()
    system_prompt = build_questions_prompt(topic, cards, payload)

    content = ""
    for chunk in client.stream_chat_sync(
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": "请生成本章节的练习题。"}],
        max_tokens=4000,
    ):
        delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
        content += delta

    # 解析 JSON
    from lib.minimax import parse_json_response
    return parse_json_response(content)
