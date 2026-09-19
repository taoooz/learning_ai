# prompts/checkpoint.py — P3 结构化 Checkpoint 生成 prompt
# 产出 JSON 格式的 scenario_choice 或 sequence 题目（程序判分，无开放式评估）

from prompts import build_prompt

PROMPT = {
    "role": """<role>
你是一位中文学习测评设计专家，为学习者当前已完成的任务生成一道结构化理解检查题。
题目目的是检验学习者是否真正理解了当前任务的核心概念，而非术语回忆。
</role>""",

    "checkpoint_context": """<checkpoint_context>
## 课程主题
{course_topic}

## 本章标题
{chapter_title}

## 本章教学目标
{teaching_goal}

## 当前任务标题
{task_title}

## 任务目标
{task_goal}

## 任务已展示内容摘要
{task_content_summary}
</checkpoint_context>""",

    "output_format": """<output_format>
## 输出要求
输出一个 JSON 对象（不要用代码围栏包裹，不要输出其他文字），字段如下：

scenario_choice 类型（单选题，4 个选项，只有 1 个正确）：
{{
  "kind": "scenario_choice",
  "prompt": "一个具体场景描述，问学习者在这个场景下应该怎么做/怎么理解",
  "options": [
    {{"id": "a", "text": "选项文字"}},
    {{"id": "b", "text": "选项文字"}},
    {{"id": "c", "text": "选项文字"}},
    {{"id": "d", "text": "选项文字"}}
  ],
  "correctAnswer": "正确选项的 id（如 \"b\"）",
  "remediationHint": "回答错误时的一句话补救提示"
}}

sequence 类型（排序题，3～4 步，打乱顺序让学习者排序）：
{{
  "kind": "sequence",
  "prompt": "要求学习者将以下步骤按正确顺序排列",
  "sequenceItems": [
    {{"id": "s1", "text": "步骤描述"}},
    {{"id": "s2", "text": "步骤描述"}},
    {{"id": "s3", "text": "步骤描述"}}
  ],
  "correctAnswer": ["s1", "s2", "s3"],
  "remediationHint": "回答错误时的一句话补救提示"
}}

## 质量要求
- 题目考查理解与应用（边界、迁移），不直接重复正文原句
- scenario_choice 的干扰项应有合理性（常见误解），不能一眼排除
- sequence 的步骤应有明确的先后逻辑关系
- 中文输出，prompt 简洁（不超过 100 字）
- estimatedSeconds 固定为 45
</output_format>""",
}


def build_checkpoint_prompt(
    course_topic: str,
    chapter_title: str,
    teaching_goal: str,
    task_title: str,
    task_goal: str,
    task_content_summary: str,
) -> str:
    """构建 Checkpoint 生成 prompt"""
    return build_prompt(
        "checkpoint",
        course_topic=course_topic,
        chapter_title=chapter_title,
        teaching_goal=teaching_goal,
        task_title=task_title,
        task_goal=task_goal,
        task_content_summary=task_content_summary,
    )

REMEDIATION_PROMPT = {
    "role": """<role>
你是一位中文学习辅导专家。学习者在理解检查中答错了，你需要：
1. 用不同于首次讲解的方式重新解释核心概念（补救内容）
2. 出一道新的等价检查题（考查同一概念，但场景/表述不同）
</role>""",

    "remediation_context": """<remediation_context>
## 课程主题
{course_topic}

## 本章标题
{chapter_title}

## 任务标题
{task_title}

## 任务目标
{task_goal}

## 原题目
{original_prompt}

## 学习者的错误答案
{user_answer}

## 正确答案
{correct_answer}

## 原补救提示
{original_hint}

## 原题已展示内容摘要
{task_content_summary}
</remediation_context>""",

    "output_format": """<output_format>
输出一个 JSON 对象（不要用代码围栏包裹，不要输出其他文字）：

{{
  "remediationContent": "补救解释的 markdown 文本（80~150 字），用不同于原讲解的比喻/角度重新解释核心概念，针对学习者的错误指出关键误解",
  "newCheckpoint": {{
    "kind": "scenario_choice 或 sequence（与原题同类型或不同类型均可）",
    "prompt": "新的检查题（考查同一概念，但换一个场景或角度）",
    "options": [...],
    "sequenceItems": [...],
    "correctAnswer": "...",
    "remediationHint": "新题的错误提示"
  }}
}}

## 质量要求
- remediationContent 必须与原任务内容的讲解方式不同（换比喻、换角度）
- newCheckpoint 考查同一概念但绝不重复原题的场景和选项
- 中文输出
</output_format>""",
}
