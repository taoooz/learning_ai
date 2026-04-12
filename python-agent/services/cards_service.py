"""
Cards Agent 业务逻辑服务
负责节点学习卡片生成
"""
from lib.minimax import MiniMaxClient
from lib.constants import LEVEL_DESCRIPTIONS, FRAME_DESCRIPTIONS, LEARNING_STYLE_DESCRIPTIONS, TECHNICAL_LEVEL_DESCRIPTIONS

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


def build_cards_prompt(topic: str, payload: dict) -> str:
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

    return f"""<critical_rules>
当前日期：{today}

## 写作标准

你的读者是有经验的职场人，来这里是学有实际价值的东西。
如果你写的内容在 Google 搜索结果摘要里随便就能看到，就不要写。

### 写法要求
- 内容要有重点，不要堆砌无意义内容
- 用结构化的方法表达知识或观点
- 一个卡片围绕一个知识或技能
- 去掉任何一句删掉后读者没有损失的话

### 搜索行为要求
- 控制搜索次数，信息够了就不要过度搜索
- 避免让用户等待过长时间
- 优先使用已有知识，仅在必要时搜索
</critical_rules>

<chapter_info>
## 当前章节信息
章节名称：{node_title}
章节目标：{teaching_goal}
内容组织方式：{node_frame_description}

## 课程相关信息
课程名称：{course_name}
课程描述：{course_description}

前一章节（避免重复）：{prev_section}
后一章节（为后续铺垫）：{next_section}
</chapter_info>

<user_context>
## 用户情况
- 个人信息：{user_insights}
- 当前水平：{level_description}
- 课程相关背景：{background_summary}
- 已掌握知识：{skip_basics_text}
{preference_text}{memory_text}
</user_context>

<output_format>
## 章节内容要求
- 生成 5-8 个学习卡片
- 每张卡片 content 建议 200 字以内
- 按照上方"内容组织方式"组织卡片顺序和逻辑
- 每张卡片独立完整，用户单独阅读也能理解
- 举例优先使用用户熟悉的背景
- 教学语言清晰、准确、自然，不传播错误或不确定信息
- 将内容恰当使用 Markdown 格式传递给用户（标题、加粗、列表等）
- 可适当分点，但不要机械堆砌

## 可视化规则
仅在"确实能帮助理解"时才输出可视化。
如果不确定结构是否正确，就不要输出可视化。

可用类型只有以下 5 种：

1. flowchart
- 适用于步骤、流程、判断路径
- 必备字段：
  - "type": "flowchart"
  - "title": "标题"
  - "mermaidCode": "Mermaid flowchart 代码"

2. timeline
- 适用于时间顺序、阶段演进
- 必备字段：
  - "type": "timeline"
  - "title": "标题"
  - "events": [{{"time": "...", "title": "...", "description": "..."}}]

3. comparison
- 适用于两种或多种方案对比
- 必备字段：
  - "type": "comparison"
  - "title": "标题"
  - "columns": ["列1", "列2", "列3"]
  - "rows": [["值1", "值2", "值3"], ["值1", "值2", "值3"]]

4. table
- 适用于分类整理、参数汇总
- 必备字段：
  - "type": "table"
  - "title": "标题"
  - "columns": ["列1", "列2", "列3"]
  - "rows": [["值1", "值2", "值3"], ["值1", "值2", "值3"]]

5. keyPoints
- 适用于核心结论、判断原则、记忆要点
- 必备字段：
  - "type": "keyPoints"
  - "title": "标题"
  - "items": ["要点1", "要点2", "要点3"]

## 重要约束
- 可视化必须挂在某一张 card 内部，字段名固定为 "visualization"
- 不要在 JSON 顶层输出 visualization
- 不要输出上述 5 种之外的可视化类型
- 不要输出未定义字段名或额外包裹层
- 如果某张卡片不需要可视化，直接省略 visualization 字段

## 输出格式
{{
  "cards": [
    {{
      "id": "card-1",
      "title": "标题",
      "content": "Markdown 内容"
    }},
    {{
      "id": "card-2",
      "title": "标题",
      "content": "Markdown 内容",
      "visualization": {{
        "type": "table",
        "title": "示例标题",
        "columns": ["列1", "列2", "列3"],
        "rows": [
          ["值1", "值2", "值3"],
          ["值1", "值2", "值3"]
        ]
      }}
    }}
  ]
}}

只返回合法 JSON，不要解释，不要输出 Markdown 代码块。
</output_format>"""


async def generate_cards(topic: str, payload: dict) -> dict:
    """生成 Cards"""
    client = get_client()
    system_prompt = build_cards_prompt(topic, payload)

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
