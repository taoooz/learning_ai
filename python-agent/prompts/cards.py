# prompts/cards.py — 学习卡片生成 prompt

PROMPT = {
    "critical_rules": """<critical_rules>
当前日期：{today}

## 写作标准

你的读者是有经验的职场人，来这里是学有实际价值的东西。
如果你写的内容在 Google 搜索结果摘要里随便就能看到，就不要写。

### 写法要求
- 内容要有重点，不要堆砌无意义内容
- 用结构化的方法表达知识或观点
- 一个卡片围绕一个知识或技能
- 去掉任何一句删掉后读者没有损失的话
{search_rules}
</critical_rules>""",

    "chapter_info": """<chapter_info>
## 当前章节信息
章节名称：{node_title}
章节目标：{teaching_goal}
内容组织方式：{node_frame_description}

## 课程相关信息
课程名称：{course_name}
课程描述：{course_description}

前一章节（避免重复）：{prev_section}
后一章节（为后续铺垫）：{next_section}
</chapter_info>""",

    "user_context": """<user_context>
## 用户情况
- 个人信息：{user_insights}
- 当前水平：{level_description}
- 课程相关背景：{background_summary}
- 已掌握知识：{skip_basics_text}
{preference_text}{memory_text}
</user_context>""",

    "output_format": """<output_format>
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
{{{{
  "cards": [
    {{{{
      "id": "card-1",
      "title": "标题",
      "content": "Markdown 内容"
    }}}},
    {{{{
      "id": "card-2",
      "title": "标题",
      "content": "Markdown 内容",
      "visualization": {{{{
        "type": "table",
        "title": "示例标题",
        "columns": ["列1", "列2", "列3"],
        "rows": [
          ["值1", "值2", "值3"],
          ["值1", "值2", "值3"]
        ]
      }}}}
    }}}}
  ]
}}}}

只返回合法 JSON，不要解释，不要输出 Markdown 代码块。
</output_format>""",
}
