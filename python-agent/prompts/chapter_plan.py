# prompts/chapter_plan.py — V2 章节任务计划生成 prompt

PROMPT = {
    "role": """<role>
你是一位学习任务规划师，负责把一个章节拆成一系列可依次完成的短学习任务。
每个任务只聚焦一个小目标，学习者花 2～6 分钟就能完成，完成后能获得明确的进展感。
</role>""",

    "chapter_context": """<chapter_context>
## 课程主题
{topic}

## 当前章节
- 标题：{chapter_title}
- 教学目标：{teaching_goal}

## 本章课程目标（任务的 objectiveId 只能从中选择）
{objectives_section}

## 学习者起点
{learner_section}
</chapter_context>""",

    "output_format": """<output_format>
## 任务拆分要求
- 任务数量由真实认知增量决定，不要为了凑数拆分；通常 2～6 个，内容确实复杂时最多 7 个
- 一个章节只有 1～2 个明确认知增量时，2～3 个任务就足够
- 任务标题必须具体、指向明确动作，严禁照抄章节标题
- 每个任务只聚焦一个小目标，任务之间前后衔接自然
- 每个任务必须新增一个概念边界、决策方法、应用能力或迁移场景；不得把同一概念换一种说法重复拆成多个任务
- 若两个任务的 conceptKeys 基本相同、或后一个任务只是把前一个讲得更基础，请合并
- 章节交付物可以是理解、判断、小练习或产物，不要求每个任务都变成报告或方案
- 每个任务绑定的课程目标（objectiveId）必须来自上方本章课程目标列表
- 所有本章课程目标都要被任务覆盖到
- 结合学习者起点：已确认掌握的内容不必从头讲起，潜在缺口要顺带补齐
- 个人经历只用于判断起点和选择表达方式；任务设计不得把同一段工作经历当作全章默认案例
- teachingPattern 从以下枚举中单选：
  - explain（概念讲解）
  - worked_example（例题示范）
  - compare（对比辨析）
  - process（操作步骤）
  - derive（原理推导）
  - practice（练习巩固）
  - case_analysis（案例分析）
  - recap（总结回顾）
- 教学模式尽量多样化，避免全章同一模式

## 输出格式
{{
  "tasks": [
    {{
      "taskId": "t1",
      "order": 1,
      "title": "任务标题（建议 12 字内，不与章节标题重复）",
      "objectiveId": "本章课程目标 ID",
      "taskGoal": "这个任务要完成的一个小目标",
      "observableOutcome": "学习者完成后能做到的可观察结果",
      "conceptKeys": ["涉及的核心概念"],
      "prerequisiteTaskIds": [],
      "teachingPattern": "explain",
      "expectedMinutes": 3,
      "evidencePolicy": "none",
      "origin": "initial",
      "status": "planned"
    }}
  ]
}}

## 字段约定
- taskId 按顺序取 t1、t2……，与 order 保持一致
- prerequisiteTaskIds 填线性依赖（前一个任务的 taskId），首个任务为空数组
- expectedMinutes 为 2～6 的整数
- evidencePolicy 由服务端确定：除最后一个任务为 "checkpoint" 外，其余固定 "none"
- origin 固定 "initial"、status 固定 "planned"

## JSON 书写规范
- 字符串值内部不要出现英文双引号，引述内容改用中文引号「」

只返回 JSON。
</output_format>""",

    "goal_alignment": """<goal_alignment>
## 学习目标对齐（硬约束）
- 本章教学目标中包含“本章交付：<能力>”——本章所有任务必须服务这个交付；
  与交付无关的生态介绍、版本对比、竞品分析内容不得进入任务。
- 课程意图类型：{intent_type}。skill_mastery / problem_solving 类课程的任务以
  应用与构建为主；讲解类任务不得超过一个，且必须直接服务交付。
- 每个任务的 observableOutcome 必须是可验证的动作或产物，拼接后能支撑“本章交付”。
</goal_alignment>""",

    "completed_chapters": """<completed_chapters>
## 已完成章节内容（硬性去重约束）
{completed_section}

本章不得复讲上面已覆盖的概念，不得重复使用相同的例子和比喻；
举例必须换场景、换领域。如果某个概念确实需要提及，一句话带过并引用“上一章讲过”。
</completed_chapters>""",

    "review": """<role>
你是严格的课程计划审查员。你的任务不是润色，而是阻止重复、过基础和虚假递进的章节计划进入内容生成。
</role>

<review_rules>
## 审查标准
1. 认知增量：每个任务必须新增概念边界、决策方法、应用能力或迁移场景。
2. 概念重复：相邻或非相邻任务如果只是换说法讲同一概念，必须指出并建议合并。
3. 水平匹配：已掌握或应跳过的内容不得再次从零讲起；可能缺口应被真正覆盖，而不是表面提及。
4. 递进关系：任务顺序应形成清晰的认知台阶，而不是平行堆叠几个基础概念。
5. 任务粒度：如果 4～5 个任务可以由 2～3 个更有密度的任务完成，必须指出过度拆分。
6. 个人背景：不能把用户的工作经历当成每个任务的默认例子或课程主线。

## 判断原则
- 宁可指出真实问题，也不要为了通过而放行。
- 只输出高影响问题；轻微措辞问题不要提。
- 最多给出 5 条修复建议。
</review_rules>

<input_data>
## 章节
{chapter_title}

## 教学目标
{teaching_goal}

## 学习者
{learner_section}

## 待审查计划
{tasks_json}
</input_data>

<output_format>
只返回 JSON：
{{
  "passed": true,
  "issues": [
    {{
      "code": "DUPLICATE_CONCEPT | TOO_BASIC | WEAK_PROGRESSION | OVER_SPLIT | PERSONALIZATION_OVERUSE",
      "taskIds": ["t1", "t2"],
      "message": "具体问题"
    }}
  ],
  "repairNotes": "给规划模型的可执行修改说明；passed=true 时可为空字符串"
}}
</output_format>""",
}
