"""
TOC Agent 业务逻辑服务
负责课程目录生成
"""
import json
import re
from lib.minimax import MiniMaxClient, parse_json_response
from lib.constants import LEVEL_DESCRIPTIONS, LEARNING_STYLE_DESCRIPTIONS, TECHNICAL_LEVEL_DESCRIPTIONS
from prompts import build_prompt

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

    return build_prompt("toc",
        today=today,
        topic=topic,
        learning_plan=learning_plan,
        profile_section=profile_section,
        recent_section=recent_section,
    )


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
                      # 与最终解析同口径：容忍裸控制字符/未转义引号
                      nodes.append(parse_json_response(raw_object))
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
