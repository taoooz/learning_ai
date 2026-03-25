// lib/prompt.ts

import { UserProfile, ClarificationAnswer } from '@/types/course';

export function buildCourseTreePrompt(
  topic: string,
  userProfile?: UserProfile | null,
  clarificationAnswers?: ClarificationAnswer[],
  searchResults?: string,
  pageContents?: string
): string {
  let insightSection = '';
  let clarificationSection = '';

  // 用户洞察 section
  if (userProfile?.insights) {
    const { knowledgeBackground, analogyExperiences } = userProfile.insights;
    insightSection = `
## 用户洞察

知识背景：
${knowledgeBackground && knowledgeBackground.length > 0
  ? knowledgeBackground.map(k => `- ${k}`).join('\n')
  : '暂无相关背景'}

类比经历：
${analogyExperiences && analogyExperiences.length > 0
  ? analogyExperiences.map(a => `- ${a}`).join('\n')
  : '暂无相关经历'}
`;
  }

  // 用户澄清回答 section（第二次调用时）
  if (clarificationAnswers && clarificationAnswers.length > 0) {
    clarificationSection = `
## 用户澄清回答

${clarificationAnswers.map(a => `问题：${a.question}\n回答：${a.answer}`).join('\n\n')}

请结合以上回答和原始用户洞察，重新评估：
1. 用户对主题的实际经验水平
2. 课程应有的难度和结构

直接生成课程，不需要再返回问题。
`;
  }

  // 搜索相关 section
  let searchSection = '';
  if (pageContents) {
    searchSection = buildPageFetchSection(pageContents);
  } else if (searchResults) {
    searchSection = buildSearchResultsSection(searchResults);
  } else {
    searchSection = buildSearchJudgmentSection();
  }

  return `${insightSection}${clarificationSection}你是一位专业的 AI 导师，为用户创建个性化的学习路径。

主题：${topic}

## 课程结构决策指南

**节点数量：**
- 参考范围：5-15 个
- 决策因素：主题本身的复杂度
- 原则：节点之间有清晰的逻辑顺序

**卡片数量：**
- 参考范围：每节点 8-12 张
- 决策因素：内容深度（核心原理需要更多展开）
- 原则：避免单张卡片内容过多

## 质量标准

一个好的学习课程应该：
- **结构清晰**：知识点由浅入深，环环相扣
- **目标明确**：每个节点都有清晰的学习目标
- **可实践**：内容能帮助用户解决真实问题

## 输出格式

如果可以直接生成课程（洞察足够或已有澄清回答），请输出：
{
  "courseId": "唯一ID",
  "topic": "${topic}",
  "difficultySummary": "简要的难度描述（基于用户背景与主题的关联度分析，用中文描述）",
  "totalNodes": 节点数量,
  "nodes": [
    {
      "index": 0,
      "title": "节点标题",
      "cardCount": 数字 (8-12),
      "status": "locked"
    }
  ]
}

如果需要更多信息才能生成课程，请输出：
{
  "questions": [
    {
      "id": "q1",
      "question": "问题文本（必须是与课程设计直接相关的具体问题，最多3个）",
      "type": "single|multiple|fill",
      "options": ["选项A", "选项B", "选项C", "选项D"]
    }
  ]
}

**澄清问题格式规则：**
- **优先使用选择题**：\`type\` 为 \`single\`（单选）或 \`multiple\`（多选）
- \`options\` 字段用于选择题，填入各选项内容
- **仅在无法设计选项时使用填空题**：当问题需要开放式回答或选项无意义时，\`type\` 为 \`fill\`，\`options\` 可省略
- 每个问题必须有明确的 \`type\`

只返回 JSON 对象，不要有其他文本。
${searchSection}`;
}

export function buildNodeContentPrompt(
  topic: string,
  nodeTitle: string,
  cardCount: number,
  insights?: { knowledgeBackground?: string[]; analogyExperiences?: string[] } | null,
  searchResults?: string,
  pageContents?: string
): string {
  let insightSection = '';

  if (insights) {
    insightSection = `
## 用户洞察

知识背景：
${insights.knowledgeBackground && insights.knowledgeBackground.length > 0
  ? insights.knowledgeBackground.map(k => `- ${k}`).join('\n')
  : '暂无相关背景'}

类比经历：
${insights.analogyExperiences && insights.analogyExperiences.length > 0
  ? insights.analogyExperiences.map(a => `- ${a}`).join('\n')
  : '暂无相关经历'}
`;
  }

  // 搜索相关 section
  let searchSection = '';
  if (pageContents) {
    searchSection = buildPageFetchSection(pageContents);
  } else if (searchResults) {
    searchSection = buildSearchResultsSection(searchResults);
  } else {
    searchSection = buildSearchJudgmentSection();
  }

  return `${insightSection}你是一位专业的 AI 导师，为用户创建学习内容。

主题：${topic}
当前学习节点：${nodeTitle}

请为这个节点生成 ${cardCount} 张学习卡片和配套的 Quiz 题目。

## 好卡片质量标准

每张卡片必须满足以下标准：
1. 场景引入：用具体场景吸引用户
2. 核心概念：简洁准确地定义
3. 避坑提示：指出常见错误
4. 一句话总结

每张卡片包含：
- title：简短的标题
- content：简洁的 Markdown 内容（每张卡片 2-3 段，字数控制在 150-400 字）
- imageUrl：null

## 练习题目设计指南

**设计原则：**
- 题目基于本节课程内容，考查对核心概念的理解和应用
- 关注知识的实际应用价值，避免考查人名、时间等琐碎信息
- 考察维度重点在**理解**和**应用**，记忆其次
- 题目应能筛选出真正掌握要点的学生

**题目类型：**
- \`single\`：单选题
- \`multiple\`：多选题
- \`sorting\`：排序题（将选项按正确顺序排列）

**题目数量参考：** 3-5 道，覆盖本节核心知识点

## 输出格式

输出 JSON 对象，结构如下：
{
  "cards": [
    {
      "id": "card-1",
      "title": "卡片标题",
      "content": "简洁的 Markdown 内容，避免使用过多特殊字符",
      "imageUrl": null
    }
  ],
  "questions": [
    {
      "id": "q-1",
      "type": "single|multiple|sorting",
      "question": "题目文本",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "正确答案（single: 字符串，multiple: 字符串数组，sorting: 排列后的数组）",
      "explanation": "答错时的解析"
    }
  ]
}

## 可视化决策指南

当内容适合可视化时，选择合适的呈现方式：

**图表类型（Mermaid）：
- 流程/步骤类 → \`flowchart\`
- 时间/顺序类 → \`sequence\` 或 \`timeline\`
- 两种方案对比 → \`comparison\`
- 概念关系/分类 → \`mindmap\` 或 \`class\`
- 状态变化 → \`state\`
- 实体关系/数据结构 → \`er\`
- 项目规划/甘特 → \`gantt\`

**辅助元素（原生组件）：
- 需要快速参考的参数/特性 → \`table\`
- 强化记忆的核心要点 → \`keyPoints\`
- 解释符号/颜色/形状含义 → \`legend\`

**示例判断：**
| 内容场景 | 选择类型 |
|----------|----------|
| "HTTP 请求流程：请求→处理→响应" | \`flowchart\` |
| "React vs Vue 对比：优缺点" | \`comparison\` |
| "HTTP 状态码分类（2xx/4xx/5xx）" | \`table\` |
| "闭包的 3 个核心用途" | \`keyPoints\` |
| "Redis 发展历程：2019-2024" | \`timeline\` |
| "图中颜色说明：蓝色=同步，绿色=异步" | \`legend\` |

**避免过度可视化：**
- 少于 3 个节点的简单关系
- 内容已经很简单直观时
- 强行拆分会破坏理解时

**输出格式：**
{
  "cards": [...],
  "visualization": {
    "type": "flowchart|sequence|comparison|table|timeline|legend|keyPoints|...",
    "title": "可选标题",
    "mermaidCode": "Mermaid 语法（图表类型时）",
    "complex": true|false,
    "items": ["项1", "项2"],
    "rows": [["A", "B"], ["C", "D"]],
    "columns": ["列1", "列2"],
    "events": [{"time": "2020", "title": "事件"}]
  }
}

Note: visualization field is optional, only add when content truly benefits from visualization.

只返回 JSON 对象，不要有其他文本。
${searchSection}`;
}

export function buildProfileInsightPrompt(profile: UserProfile): string {
  return `你是一个学习规划专家。请从以下用户信息中提取与学习课程相关的洞察。

要求：
- 只提取事实，不要推测
- 用更清晰的语言总结，不遗漏关键信息
- 不要延伸推理（如"用过 docker"不推导"有容器化基础"，只说"在项目中使用过 Docker"）

目标岗位：${profile.targetJob || '未填写'}

工作经历：
${profile.workExperience && profile.workExperience.length > 0
  ? profile.workExperience.map(w => `- ${w.company}，${w.position}${w.description ? '，工作内容：' + w.description : ''}`).join('\n')
  : '暂无'}

教育背景：
${profile.education && profile.education.length > 0
  ? profile.education.map(e => `- ${e.school}，${e.major}`).join('\n')
  : '暂无'}

请总结以下信息（用中文回答）：

1. knowledgeBackground：基于工作经历和教育背景总结的关键事实
   - 每份工作的实质内容（做什么产品、有什么技能、什么领域）
   - 教育背景中的专业方向
   - 关键信息不遗漏、不延伸
   - 保持事实性，不推理"是否有用"

2. analogyExperiences：用户的真实经历，可作为课程案例素材
   - 描述用户实际做过的具体事情
   - 不加引申

3. summary：一句话总结用户背景特点

输出 JSON 格式：
{
  "knowledgeBackground": ["总结1", "总结2"],
  "analogyExperiences": ["经历1", "经历2"],
  "summary": "一句话总结"
}`;
}

// 搜索判断 prompt 片段 - 追加到原始 prompt 后面
export function buildSearchJudgmentSection(): string {
  return `
## 搜索判断

请判断是否需要搜索外部信息来生成更好的内容。

如果不需要搜索，请直接返回课程内容。
如果需要搜索，请返回：
{
  "needsSearch": true,
  "searchQueries": ["关键词1", "关键词2"]
}

注意：
- 搜索关键词应该简洁、准确
- 最多返回3个搜索关键词
- 优先搜索核心概念和最新信息
`;
}

// 搜索结果注入 prompt 片段
export function buildSearchResultsSection(searchResults: string): string {
  return `
## 搜索结果

${searchResults}

请基于以上搜索结果，生成更准确、更丰富的内容。
如果搜索结果足够，返回最终内容 JSON。
如果需要查看页面详情来补充内容，请返回：
{
  "needsPageFetch": true,
  "urls": ["url1", "url2", "url3"]
}

注意：
- 最多返回3个URL
- 只请求确实需要详情的页面
`;
}

// 页面抓取结果注入 prompt 片段
export function buildPageFetchSection(pageContents: string): string {
  return `
## 页面详情

${pageContents}

请基于以上页面详情，补充或验证之前的内容。
如果页面详情足够，返回最终内容 JSON。
如果仍需要更多页面详情（最多额外请求1次），返回：
{
  "needsPageFetch": true,
  "urls": ["url1", "url2", "url3"]
}

**超过最大调用次数后，不再接受页面请求，直接基于已有内容生成。**
`;
}