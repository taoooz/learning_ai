# 课程内容质量优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过优化 Prompt 提升课程内容信息密度，减少空泛描述和车轱辘话

**Architecture:** 纯 Prompt 层面优化，不涉及数据流或前端改动。三个 Python Agent 文件各自修改 prompt 构建逻辑，用 XML 标签分层、加写作标准、搜索从可选改为建议强制。

**Tech Stack:** Python (Python Agent), MiniMax M2.7 API

---

### Task 1: 重构 Cards Prompt（`cards_service.py`）

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/services/cards_service.py:27-126`（`build_cards_prompt` 函数）

- [ ] **Step 1: 替换 `build_cards_prompt` 函数的 return 语句**

将 `cards_service.py:27-126` 的 `build_cards_prompt` 函数中的 `return f"""..."""` 整体替换为以下内容。保留函数签名和变量提取逻辑（第 27-55 行），只替换 `return` 语句部分（第 57-126 行）：

```python
    # 搜索指令
    _tools_line = ""
    if enable_tools:
        _tools_line = "- 建议至少搜索 1 次以获取领域真实知识，搜索 3 次后必须基于已有信息生成内容"

    return f"""你是一名专业的 AI 老师。基于章节信息和用户情况，设计该章节的教学内容。

<critical_rules>
## 写作标准

你的读者是有经验的职场人，来这里是学"他自己查不到的东西"。
如果你写的内容在 Google 搜索结果摘要里就能看到，就不要写。

### 写法要求
- 开篇直接给结论，不要铺垫
- 用列表/对比表/决策树代替段落叙述
- 给具体数字和范围（"延迟增加 2-3 倍" > "延迟显著增加"）
- 说清边界条件（"数据量 < 10万用 FAISS，超过考虑 Milvus"）
- 一个卡片只讲透一个知识点
- 去掉任何一句删掉后读者没有损失的话
</critical_rules>

<chapter_info>
章节名称：{node_title}
章节目标：{teaching_goal}
内容组织方式：{node_frame_description}
课程名称：{course_name}
课程描述：{course_description}
前一章节（避免重复）：{prev_section}
后一章节（避免重复）：{next_section}
</chapter_info>

<user_context>
- 当前水平：{level_text}
- 课程相关背景：{background_summary}
- 已掌握知识：{skip_basics_text}
- 学习风格：{LEARNING_STYLE_DESCRIPTIONS.get(learning_style, '未提供')}
- 技术接受度：{TECHNICAL_LEVEL_DESCRIPTIONS.get(technical_level, '未提供')}
- 价值关注点：{', '.join(value_priorities) if value_priorities else '未提供'}
- 个人信息：{user_insights}
</user_context>

<output_format>
生成 5-8 个学习卡片，按照"内容组织方式"组织卡片顺序和逻辑。
每张卡片 content 建议 200 字以内，每张卡片独立完整。
举例优先围绕用户的价值关注点。{_tools_line}
在"确实能帮助理解"时可使用可视化组件，可用类型：
- flowchart: {{"type": "flowchart", "title": "", "mermaidCode": "Mermaid 代码"}}
- timeline: {{"type": "timeline", "title": "", "events": [{{"time": "", "title": "", "description": ""}}]}}
- comparison: {{"type": "comparison", "title": "", "columns": ["列1", "列2", "列3"], "rows": [["值1", "值2", "值3"]]}}
- table: {{"type": "table", "title": "", "columns": ["列1", "列2", "列3"], "rows": [["值1", "值2", "值3"]]}}
- keyPoints: {{"type": "keyPoints", "title": "", "items": ["要点1", "要点2", "要点3"]}}

可视化必须挂在 card 内部的 "visualization" 字段，不要在 JSON 顶层输出，不要输出上述 5 种之外的类型。

输出 JSON 格式：
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

只返回合法 JSON，不要解释。
</output_format>"""
```

关键变化：
- 删除旧的 `_tools_line` 赋值（第 50-52 行），替换为新的搜索指令
- Prompt 从扁平 4 段改为 XML 标签分层：`<critical_rules>` / `<chapter_info>` / `<user_context>` / `<output_format>`
- `<critical_rules>` 包含精简写作标准（6 行写法要求）
- 搜索从"可主动调用"改为"建议至少搜索 1 次"
- 用户画像移到 `<user_context>` 参考区域

- [ ] **Step 2: Commit**

```bash
cd /Users/admin/Documents/OpenCode/Learning\ AI/.worktrees/agent-feature
git add python-agent/services/cards_service.py
git commit -m "refactor(cards): 重构 prompt，XML 分层 + 写作标准 + 搜索强制化"
```

---

### Task 2: TOC Prompt 加章节描述质量标准（`toc_service.py`）

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/services/toc_service.py:143-161`（`build_toc_prompt` 中的"设计原则"段落）

- [ ] **Step 1: 在"设计原则"的"## 章节"段落末尾追加质量要求**

在 `toc_service.py` 第 161 行（`- 学习计划中标记为已掌握的知识点，不需要单独成章，可作为复习提及`）之后、第 163 行（`# 输出格式`）之前，插入以下内容：

```python
- 章节描述建议包含至少 2 个具体知识点或技能
- 章节描述建议说明读者学完后能做的一件具体的事
- 建议避免"深入了解""掌握核心""全面了解"等空泛表述
```

插入后的完整"## 章节"段落应为：

```python
## 章节
- 每个章节有明确的定位
- 章节间有清晰的逻辑衔接
- 尽量避免与用户近期学习的课程重复
- 课程设计结合用户个人情况，避免泛泛而谈
- 学习计划中标记为已掌握的知识点，不需要单独成章，可作为复习提及
- 章节描述建议包含至少 2 个具体知识点或技能
- 章节描述建议说明读者学完后能做的一件具体的事
- 建议避免"深入了解""掌握核心""全面了解"等空泛表述
```

- [ ] **Step 2: Commit**

```bash
cd /Users/admin/Documents/OpenCode/Learning\ AI/.worktrees/agent-feature
git add python-agent/services/toc_service.py
git commit -m "refactor(toc): prompt 加章节描述质量标准"
```

---

### Task 3: TOC Agent 搜索建议强制化（`toc_agent.py`）

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/services/toc_agent.py:36-39`（user message）

- [ ] **Step 1: 修改 user message**

将 `toc_agent.py` 第 38 行：

```python
{"role": "user", "content": "请生成课程目录。"},
```

替换为：

```python
{"role": "user", "content": "请生成课程目录。建议先使用 search_info 搜索该领域的最新知识和常见课程结构，确保目录内容准确且不过时。"},
```

- [ ] **Step 2: Commit**

```bash
cd /Users/admin/Documents/OpenCode/Learning\ AI/.worktrees/agent-feature
git add python-agent/services/toc_agent.py
git commit -m "refactor(toc-agent): user message 改为建议先搜索领域知识"
```

---

### Task 4: 手动验证

- [ ] **Step 1: 启动 Python Agent 并测试**

```bash
cd /Users/admin/Documents/OpenCode/Learning\ AI/.worktrees/agent-feature/python-agent
venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

- [ ] **Step 2: 测试 Cards 生成**

通过前端生成一个课程，进入第一章观察 Cards 内容：
- 内容是否包含具体的概念名称、数字、方法？
- 是否还有"XX是...""XX至关重要"等空泛句子？
- 对比优化前的生成时间，确认没有显著增加

- [ ] **Step 3: 测试 TOC 生成**

生成一个新课程 TOC：
- 章节描述是否包含具体知识点？
- 是否还有"深入了解""掌握核心"等空泛表述？
- TOC Agent 是否实际调用了搜索？
