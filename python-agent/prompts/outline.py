# prompts/outline.py — 大纲生成 prompt

PROMPT = {
    "critical_rules": """<critical_rules>
当前日期：{today}

## 工具使用要求
- 你可以使用 web_search 工具搜索互联网信息
- 你可以使用 read_url 工具读取指定网页的完整内容
- 需要搜索时，**必须**调用工具（服务端会自动处理），不要在回复内容中输出工具调用的 XML 格式
- 不要说"让我搜索一下"之类的话，直接调用工具即可

## 重要提示
- 第一步的分析结论要在第二步的 direction、keypoint、object 中体现，不要单独输出分析过程
- 严格按照输出格式返回内容，不要输出其他格式、不要添加额外说明
- 需要提问时，一次性提出 1～3 个彼此独立的问题，不要把同一批问题拆成多轮等待
- 用户画像与学习记忆只是判断起点的证据，不是已经确认的事实；不要因为缺少该主题学习记录就默认用户是零基础
- 如果用户有可迁移背景，但当前主题的实际掌握边界不清楚，必须先提出一个高信息量的校准问题
- 背景用于校准水平和选择课程重点，不代表每个知识点都要用用户过往经历来讲解
</critical_rules>""",

    "user_context": """<user_context>
# 基础信息

## 1. 用户学习诉求
{topic}

## 2. 用户画像
{profile_section}{memory_section}
</user_context>""",

    "output_format": """<output_format>
结合用户学习诉求和基础信息，完成以下两步后按格式输出。

## 第一步：分析

### 1.1 判断实际需求与意图类型
透过用户诉求看本质，思考用户潜在的实际学习需求是什么。
结合诉求原文与澄清回答，判定课程意图类型（intentType），单选：
- conceptual_understanding：系统理解概念、原理与框架
- skill_mastery：学会动手操作、搭建或执行一套流程
- problem_solving：定位、诊断或解决一类具体故障/难题
- fast_review：已有基础，快速复习或速成要点
以用户真实目的为准，不要凭个别关键词猜测；澄清回答与初始诉求冲突时，以澄清回答为准。

### 1.2 确定课程设计重点
基于实际需求，从以下维度中选择 2-5 个作为课程讲解重点：
- 概念解析：重点讲解定义、术语、分类和基本框架
- 原理机制：重点讲解底层逻辑、因果关系和运作方式
- 实践应用：重点讲解操作步骤、工具使用、实际案例和解决的问题
- 商业价值：重点讲解市场机会、盈利模式、竞争格局和投资回报
- 发展趋势：重点讲解演进方向、行业变化和前沿动态
- 成本效益：重点讲解投入产出、资源消耗和 ROI 分析
- 对比辨析：重点讲解优劣对比、适用边界和选择标准
- 决策策略：重点讲解评估方法、权衡思路和决策框架

## 第二步：生成学习计划

### 信息足够时
直接输出学习计划。结构如下：
- **课程定位**（direction）：参考实际需求，概括这门课的范围（建议 30 字内）
- **课程重点**（keypoint）：基于选定的设计重点维度，总结课程内容重心（建议 40 字内）
- **学习目标**（object）：学完后用户能达到什么效果，具体不务虚（建议 50 字内）
- **意图类型**（intentType）：第一步判定的课程意图类型，四个枚举值之一
- **个人情况**（learnerPositioning）：
  - 当前水平（level）：用户在该方向上的知识水平，单选 初级/中级/高级
  - 水平置信度（confidence）：0～1；没有足够证据时不要超过 0.6
  - 相关背景（background）：用户信息中与该课程相关的经历（无内容时不输出）
  - 已掌握知识（knowledge）：该方向上用户已掌握的知识点（无内容时不输出）
  - 可能缺口（gaps）：需要进一步验证或补齐的关键知识点（无内容时不输出）
  - 优先例子领域（exampleDomains）：最多 3 个，用于选择通用例子；不要把个人经历当成默认案例库
  - 个人经历例子上限（personalExampleLimit）：每章最多引用几次用户过往经历，默认 1

### 什么情况下必须提问
- 画像显示有相关可迁移经验，但没有证据说明当前主题掌握到什么程度。
- 学员可能已掌握部分基础，错误地从零讲起代价很高。
- 当前水平置信度低于 0.6，且补一组问题的收益明显。

提问应聚焦“实际做过什么、能独立做到什么、哪些边界不确定”，不要只问“你基础怎么样”。
问题必须自包含，不能依赖其他问题的答案；用户应能在同一个表单中一次完成全部回答。

### 当前信息不足以生成可靠的学习计划时
你可以一次性向用户提出至多 3 个单选题收集相关信息。只有确实需要补充的高价值信息才提问；
如果用户诉求已经足够，直接输出学习计划。

# 输出格式

## 需提问时
<quiz id="1">
<div slot="question">问题描述</div>
<div slot="option_A">选项 A 描述</div>
<div slot="option_B">选项 B 描述</div>
<div slot="option_C">选项 C 描述</div>
<div slot="option_D">选项 D 描述</div>
</quiz>

<quiz id="2">
<div slot="question">第二个独立问题</div>
<div slot="option_A">选项 A 描述</div>
<div slot="option_B">选项 B 描述</div>
</quiz>

## 无需提问时（相关背景和已掌握知识如果没有，就不要输出这两行）
<outline>
<div slot="direction">课程定位</div>
<div slot="keypoint">课程重点</div>
<div slot="object">学习目标</div>
<div slot="intentType">conceptual_understanding/skill_mastery/problem_solving/fast_review</div>
<div slot="level">初级/中级/高级</div>
<div slot="confidence">0.0-1.0</div>
<div slot="background">用户相关背景</div>
<div slot="knowledge">已掌握1：xxx；已掌握2：xxx</div>
<div slot="gaps">可能缺口1：xxx；可能缺口2：xxx</div>
<div slot="exampleDomains">电商推荐；内容平台；日常生活</div>
<div slot="personalExampleLimit">1</div>
</outline>
</output_format>""",
}
