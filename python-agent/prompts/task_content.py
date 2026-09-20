# prompts/task_content.py — V2 任务内容生成 prompt（Content Recipe 配方版）

# 按 teachingPattern 定义的内容配方：块序列 + 内容量下限
# 循证依据：GarethManning/education-agent-skills（explicit-instruction 显性教学 + memory-learning-science 记忆科学）
CONTENT_RECIPES = {
    "explain": """1. **markdown 讲解正文**（200~300 字）：定义概念 → 给一个生活化类比 → 说明与任务目标的关联
2. `:::key_point` → `:::`
   第一行：标题：{核心概念名}
   之后 3~5 行，每行以 - 开头；首条为一句话精确定义
3. `:::example` → `:::`
   标题：xxx
   场景：xxx（一句话交代背景）
   内容：≥80 字的具体例子（有人物/对象/数字）
   要点：一句话总结该例子的教学意图
4. 结尾 > 引用块 takeaway（一句话）""",

    "worked_example": """1. **markdown 场景引入**（100~150 字）：交代问题背景，引出要解决的例题
2. `:::example` → `:::`
   标题：xxx
   场景：xxx
   内容：完整拆解过程，分步骤写出（每步说明做什么+为什么），≥120 字
   要点：一句话概括解法模式
3. `:::key_point` → `:::`
   第一行：标题：模式总结
   2~4 条要点，提炼可复用的思维模式
4. 结尾 > 引用块 takeaway""",

    "compare": """1. **markdown 引入**（80~120 字）：交代要对比的对象和维度
2. `:::comparison` → `:::`
   第一行：列：维度A | 维度B | 维度C
   之后 3~5 行数据，每行用 | 分隔（≥3 行 × ≥3 列）
3. **markdown 分析**（100~150 字）：解读表格中最容易混淆的 1~2 个差异点
4. 结尾 > 引用块 takeaway""",

    "process": """1. **markdown 引入**（80~120 字）：说明要完成什么操作，为什么重要
2. **markdown 有序步骤**（150~250 字）：用 1. 2. 3. 编号列表，每步包含「做什么 + 为什么这样做」
3. `:::key_point` → `:::`
   第一行：标题：易错点
   2~3 条要点，指出常见错误和避免方法
4. 结尾 > 引用块 takeaway""",

    "derive": """1. **markdown 推导正文**（250~350 字）：从已知出发，逐步推导到结论，中间逻辑链完整
2. `:::key_point` → `:::`
   第一行：标题：关键结论
   2~4 条要点，标出推导中的关键转折
3. 结尾 > 引用块 takeaway""",

    "practice": """1. **markdown 场景描述**（80~120 字）：给出一个要动手解决的问题
2. `:::example` → `:::`
   标题：示范
   场景：xxx
   内容：完整的示范解答（≥100 字）
   要点：一句话总结示范中的关键动作
3. **markdown 引导实践**（80~120 字）：给学习者一个类似的练习，提示从哪一步开始
4. 结尾 > 引用块 takeaway""",

    "case_analysis": """1. **markdown 案例背景**（100~150 字）：交代案例的情境和关键冲突
2. `:::example` → `:::`
   标题：案例分析
   场景：xxx
   内容：逐步分析案例（≥120 字），指出决策点和对错
   要点：一句话提炼案例启示
3. `:::key_point` → `:::`
   第一行：标题：启示
   2~3 条要点
4. 结尾 > 引用块 takeaway""",

    "recap": """1. **markdown 回顾正文**（100~200 字）：串联本章已完成任务的核心线索
2. `:::key_point` → `:::`
   第一行：标题：核心要点
   3~5 条要点，每条对应一个已学概念
3. 结尾 > 引用块 takeaway""",
}

# 兜底配方：未匹配的 teachingPattern 用最简结构
_FALLBACK_RECIPE = """1. **markdown 讲解正文**（200~300 字）
2. `:::key_point` → `:::`
   3~5 条要点
3. 结尾 > 引用块 takeaway"""

PROMPT = {
    "role": """<role>
你是一位中文学习内容作者，为自学者撰写单个学习任务的教学正文。
内容直接嵌入移动端学习流展示：标题由界面渲染，你只写正文。
</role>""",

    "task_context": """<task_context>
## 课程主题
{course_topic}

## 所属章节
- 章节标题：{chapter_title}
- 章节教学目标：{chapter_goal}

## 当前任务
- 任务标题：{task_title}
- 任务目标：{task_goal}
- 教学模式：{pattern_label}
- 可观察结果：{observable_outcome}

## 学习者起点
{learner_section}

## 本章已完成任务（内容不得与之重复）
{previous_section}
</task_context>""",

    "output_format": """<output_format>
## 输出格式

你的输出由多个内容块组成。普通 markdown 文字直接写；结构化块用 ::: 定界符包裹。

### 定界符规则
- 结构化块开始：单独一行 `:::类型名`
- 结构化块结束：单独一行 `:::`
- 开始和结束标记必须各自独占一行，不要嵌在段落中间

### 本任务的内容配方（教学模式：{pattern_label}）
严格按以下顺序和格式输出，不得跳过任何块：

{content_recipe}

### 通用规则
- 只输出内容本身：不要输出 JSON、不要用代码围栏包裹整篇、不要输出任务标题
- 语言口语化、直接面向学习者（用「你」），避免空泛套话
- 结合学习者起点：已掌握的内容一句话带过，潜在缺口要讲清楚
- 例子具体：有人物/对象/数字/真实场景，不要编空泛例子
- 块与块之间不得重复同一句话
- 最后以 > 引用块 takeaway 收尾（一句话概括本任务最核心结论）

### 示例结尾
> 好的指令一次只说一件事，说清输入、要求和输出格式。
</output_format>""",
}


def get_recipe(pattern: str) -> str:
    """获取指定教学模式的配方文本，未匹配时返回兜底"""
    return CONTENT_RECIPES.get(pattern, _FALLBACK_RECIPE)
