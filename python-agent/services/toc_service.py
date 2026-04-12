"""
TOC Agent 业务逻辑服务
负责课程目录生成
"""
import json
import re
from lib.minimax import MiniMaxClient
from lib.constants import LEVEL_DESCRIPTIONS, LEARNING_STYLE_DESCRIPTIONS, TECHNICAL_LEVEL_DESCRIPTIONS

_client: MiniMaxClient | None = None

def get_client() -> MiniMaxClient:
    global _client
    if _client is None:
        _client = MiniMaxClient()
    return _client


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
        level_desc = LEVEL_DESCRIPTIONS.get(level, '')
        if level_desc:
            parts.append(f"当前水平：{level_desc}")
    if positioning.get('backgroundSummary'):
        parts.append(f"相关背景：{positioning['backgroundSummary']}")
    skip = positioning.get('skipBasics', [])
    if skip:
        parts.append(f"已掌握知识：{', '.join(skip)}")

    return '\n'.join(parts)


def _format_user_profile(user_profile: dict) -> str:
    """将用户画像 JSON 格式化为可读文本"""
    sections = []

    target_job = user_profile.get('targetJob')
    if target_job:
        sections.append(f"目标岗位：{target_job}")

    insights = user_profile.get('insights')
    if insights:
        work_items = insights.get('workSummary', [])
        if work_items:
            sections.append("工作背景：\n" + '\n'.join(f"- {item}" for item in work_items))

        edu_items = insights.get('educationSummary', [])
        if edu_items:
            sections.append("教育背景：\n" + '\n'.join(f"- {item}" for item in edu_items))

        analogy_items = insights.get('analogyExperiences', [])
        if analogy_items:
            sections.append("类比经历：\n" + '\n'.join(f"- {item}" for item in analogy_items))

        learning_style = insights.get('learningStyle')
        if learning_style:
            desc = LEARNING_STYLE_DESCRIPTIONS.get(learning_style, learning_style)
            sections.append(f"学习风格：{desc}")

        tech_level = insights.get('technicalLevel')
        if tech_level:
            desc = TECHNICAL_LEVEL_DESCRIPTIONS.get(tech_level, tech_level)
            sections.append(f"技术接受度：{desc}")

        value_priorities = insights.get('valuePriorities', [])
        if value_priorities:
            sections.append(f"价值关注点：{', '.join(value_priorities)}，举例时优先围绕这些方向")

        summary = insights.get('summary')
        if summary:
            sections.append(f"背景总结：{summary}")

    return '\n\n'.join(sections) if sections else '暂无'


def _format_recent_courses(planning_payload: dict) -> str:
    """从 planning_payload 中提取近期相关课程"""
    recent = planning_payload.get('recentRelevantCourses', [])
    if not recent:
        return ''
    courses = [f"- {c.get('topic', '')}：{c.get('summary', '')}" for c in recent]
    return '\n'.join(courses)


def build_toc_prompt(blueprint: dict, planning_payload: dict = None, user_profile: dict = None) -> str:
    """构建 system prompt（角色 + 指令 + 用户数据 + 格式约束）"""
    topic = blueprint.get('topic', blueprint.get('learningDirection', ''))
    learning_plan = _format_learning_plan(blueprint)
    profile_section = _format_user_profile(user_profile) if user_profile else '暂无'

    recent_section = ''
    if planning_payload:
        recent_text = _format_recent_courses(planning_payload)
        if recent_text:
            recent_section = f"\n\n{recent_text}"

    from datetime import date
    today = date.today().isoformat()

    return f"""<critical_rules>
当前日期：{today}

你是一名专业的 AI 老师，擅长根据学习计划与用户学习记忆生成个性化课程章节结构，用于指导后续章节内容创作。

## 任务要求

基于基础信息，完成以下两步后按格式输出。

### 第一步：分析

#### 1.1 课程内容框架（单选）
- progressive（渐进深入）：从基础概念逐步深入到核心原理和高级应用，形成入门到精通的完整章节
- problem_driven（问题驱动）：以核心问题为主线，按问题定义→拆解归因→解决方案→落地执行→避坑排布章节
- systematic（系统拆解）：总-分-总结构，将复杂领域拆分为平行模块，逐模块深入后综合串联
- comparative（对比辨析）：以统一维度对比多方案/概念，章节围绕差异、优劣势、选型逻辑展开
- evolutionary（演进历程）：按时间线梳理主题的诞生、发展、迭代与未来趋势
- case_based（案例驱动）：以真实案例为主线，在案例拆解分析中串联知识点与方法论
- theory_to_practice（理论实践）：每个知识点配套独立练习，各模块相对独立
- project_based（项目实战）：所有知识点服务于一个完整项目，章节间有前后依赖

### 第二步：生成课程目录

根据基础信息和第一步结果，整理课程目录。结构如下：
1. 课程标题（建议 15 字内，参考学习计划中的课程定位）
2. 课程描述（建议 40 字内，概述课程内容及目标）
3. 课程章节详情
   - 章节标题：避免过度概括，建议 25 字内
   - 章节描述：讲述该章节的学习内容与目标，内容清晰、干练，可用于指导后续内容生成
   - 章节框架（frame，单选）：
     a. what_why_how（是什么-为什么-怎么做）：围绕定义、价值、应用三个维度组织内容
     b. total_split_total（结构化讲解）：快速抓住核心→拆解细节→形成结构化记忆
     c. step_by_step（实操落地）：围绕目标→步骤→验证→避坑组织内容，聚焦纯操作流程
     d. case_review（案例拆解）：围绕案例背景→执行过程→关键决策→方法论沉淀组织内容
     e. problem_solution（问题解决）：围绕问题定义→根源拆解→方案设计→落地验证组织内容
     f. comparative_analysis（对比辨析）：围绕统一评判维度→核心差异→优劣势→适用边界组织内容
     g. timeline_evolution（脉络演进）：围绕发展阶段→关键节点→驱动因素→未来趋势组织内容
     h. exploration_deduction（探究发现）：围绕核心疑问→假设推导→规律总结→延伸探索组织内容

## 目录设计原则
- 每个章节有明确的定位
- 章节间有清晰的逻辑衔接（递进、并列或对比关系由课程框架决定）
- 尽量避免与用户近期学习的课程重复
- 课程设计结合用户个人情况，避免泛泛而谈
- 学习计划中标记为已掌握的知识点，不需要单独成章，可作为复习提及

## 章节描述质量要求
- 建议包含至少 2 个具体知识点或技能
- 建议说明读者学完后能做的一件具体的事
- 建议避免"深入了解""掌握核心""全面了解"等空泛表述
</critical_rules>

<user_context>
## 1. 用户学习诉求
{topic}

## 2. 用户画像
{profile_section}{recent_section}
</user_context>

<learning_plan>
## 3. 学习计划
{learning_plan}
</learning_plan>

<output_format>
{{
  "courseName": "课程名称",
  "courseDescription": "课程描述",
  "nodes": [{{"index": 1, "title": "章节标题", "description": "章节描述", "frame": "what_why_how"}}]
}}

只返回 JSON。
</output_format>"""


async def generate_toc(blueprint: dict, planning_payload: dict = None, user_profile: dict = None) -> dict:
    """生成 TOC"""
    client = get_client()
    system_prompt = build_toc_prompt(blueprint, planning_payload, user_profile)

    content = ""
    for chunk in client.stream_chat_sync(
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": "请生成课程目录。"}],
        max_tokens=2000,
    ):
        delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
        content += delta

    # 解析 JSON
    from lib.minimax import parse_json_response
    return parse_json_response(content)


def _extract_json_string_field(content: str, field_name: str) -> str | None:
    pattern = rf'"{field_name}"\s*:\s*"((?:\\.|[^"\\])*)"'
    match = re.search(pattern, content)
    if not match:
        return None

    try:
        return json.loads(f'"{match.group(1)}"')
    except Exception:
        return match.group(1)


def _extract_complete_node_objects(content: str) -> list[dict]:
    nodes_match = re.search(r'"nodes"\s*:\s*\[', content)
    if not nodes_match:
        return []

    cursor = nodes_match.end()
    nodes: list[dict] = []
    depth = 0
    in_string = False
    escape = False
    object_start = -1

    while cursor < len(content):
      char = content[cursor]

      if in_string:
          if escape:
              escape = False
          elif char == '\\':
              escape = True
          elif char == '"':
              in_string = False
      else:
          if char == '"':
              in_string = True
          elif char == '{':
              if depth == 0:
                  object_start = cursor
              depth += 1
          elif char == '}':
              depth -= 1
              if depth == 0 and object_start >= 0:
                  raw_object = content[object_start:cursor + 1]
                  try:
                      nodes.append(json.loads(raw_object))
                  except Exception:
                      pass
                  object_start = -1
          elif char == ']' and depth == 0:
              break

      cursor += 1

    return nodes


async def stream_toc_events(blueprint: dict, planning_payload: dict = None, user_profile: dict = None):
    client = get_client()
    system_prompt = build_toc_prompt(blueprint, planning_payload, user_profile)

    content = ""
    emitted_course_name = None
    emitted_course_description = None
    emitted_node_count = 0

    for chunk in client.stream_chat_sync(
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": "请生成课程目录。"}],
        max_tokens=2000,
    ):
        delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
        if not delta:
            continue

        content += delta

        course_name = _extract_json_string_field(content, "courseName")
        if course_name and course_name != emitted_course_name:
            emitted_course_name = course_name
            yield {"type": "course_name", "value": course_name}

        course_description = _extract_json_string_field(content, "courseDescription")
        if course_description and course_description != emitted_course_description:
            emitted_course_description = course_description
            yield {"type": "course_description", "value": course_description}

        nodes = _extract_complete_node_objects(content)
        while emitted_node_count < len(nodes):
            node = nodes[emitted_node_count]
            if isinstance(node, dict) and all(key in node for key in ("index", "title", "description")):
                yield {
                    "type": "node",
                    "node": {
                        "index": node["index"],
                        "title": node["title"],
                        "description": node["description"],
                        "frame": node.get("frame", "total_split_total"),
                    },
                }
            emitted_node_count += 1

    from lib.minimax import parse_json_response
    result = parse_json_response(content)
    yield {"type": "complete", "result": result}
