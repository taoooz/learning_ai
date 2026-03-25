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

  if (userProfile?.insights) {
    const { knowledgeBackground, analogyExperiences } = userProfile.insights;
    insightSection = `
## 用户洞察

知识背景：
${knowledgeBackground?.length ? knowledgeBackground.map(k => `- ${k}`).join('\n') : '暂无相关背景'}

类比经历：
${analogyExperiences?.length ? analogyExperiences.map(a => `- ${a}`).join('\n') : '暂无相关经历'}
`;
  }

  if (clarificationAnswers?.length) {
    clarificationSection = `
## 用户澄清回答

${clarificationAnswers.map(a => `问题：${a.question}\n回答：${a.answer}`).join('\n\n')}

请结合以上信息重新评估用户经验水平，直接生成课程。
`;
  }

  let searchSection = '';
  if (pageContents) {
    searchSection = buildPageFetchSection(pageContents);
  } else if (searchResults) {
    searchSection = buildSearchResultsSection(searchResults);
  } else {
    searchSection = buildSearchJudgmentSection();
  }

  return `${insightSection}${clarificationSection}你是AI导师，创建个性化学习路径。

主题：${topic}

## 结构决策
- 节点数：5-15（取决于主题复杂度）
- 每节点卡片：8-12张
- 节点间有清晰逻辑顺序

## 质量标准
- 结构清晰：由浅入深，环环相扣
- 目标明确：每节点有清晰学习目标
- 可实践：能解决真实问题

## 输出格式

可直接生成时输出：
{
  "courseId": "唯一ID",
  "topic": "${topic}",
  "difficultySummary": "难度描述（中文）",
  "totalNodes": 数字,
  "nodes": [{"index": 0, "title": "标题", "cardCount": 8-12, "status": "locked"}]
}

需要更多信息时输出：
{
  "questions": [{"id": "q1", "question": "问题（最多3个）", "type": "single|multiple", "options": ["A", "B", "C", "D"]}]
}

**澄清问题优先使用选择题，只在无法设计选项时用填空题。**

只返回JSON。
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
${insights.knowledgeBackground?.length ? insights.knowledgeBackground.map(k => `- ${k}`).join('\n') : '暂无相关背景'}

类比经历：
${insights.analogyExperiences?.length ? insights.analogyExperiences.map(a => `- ${a}`).join('\n') : '暂无相关经历'}
`;
  }

  let searchSection = '';
  if (pageContents) {
    searchSection = buildPageFetchSection(pageContents);
  } else if (searchResults) {
    searchSection = buildSearchResultsSection(searchResults);
  } else {
    searchSection = buildSearchJudgmentSection();
  }

  return `${insightSection}你是AI导师，创建学习内容。

主题：${topic}
当前节点：${nodeTitle}

请生成${cardCount}张学习卡片和配套Quiz题目。

## 卡片质量标准
1. 场景引入：用具体场景吸引用户
2. 核心概念：简洁准确地定义
3. 避坑提示：指出常见错误
4. 一句话总结

卡片格式：title、content（Markdown，150-400字）、imageUrl: null

## 题目设计原则
- 基于本节内容，考查核心概念的理解和应用
- 关注实际应用价值，避免考查人名、时间等琐碎信息
- 考察理解**和应用**，记忆其次
- 能筛选出真正掌握要点的学生

题目类型：single（单选）、multiple（多选）、sorting（排序）
数量：3-5道，覆盖核心知识点

## 输出格式
{
  "cards": [{"id": "card-1", "title": "标题", "content": "Markdown内容", "imageUrl": null}],
  "questions": [{"id": "q-1", "type": "single|multiple|sorting", "question": "题目", "options": ["A", "B", "C", "D"], "answer": "答案(single:字符串, multiple:字符串数组, sorting:排列后的数组)", "explanation": "解析"}]
}

## 可视化决策指南

内容适合可视化时选择：
- 流程/步骤 → \`flowchart\`，时间/顺序 → \`sequence\`/\`timeline\`
- 两种方案对比 → \`comparison\`，概念关系 → \`mindmap\`/\`class\`
- 状态变化 → \`state\`，实体关系 → \`er\`，项目规划 → \`gantt\`
- 参数/特性 → \`table\`，核心要点 → \`keyPoints\`，符号说明 → \`legend\`

示例：
| 场景 | 类型 |
|------|------|
| HTTP请求流程 | \`flowchart\` |
| React vs Vue对比 | \`comparison\` |
| HTTP状态码分类 | \`table\` |
| 闭包核心用途 | \`keyPoints\` |

避免过度可视化：少于3个节点、内容已很简单直观时不要用。

可视化格式（可选）：
{
  "cards": [...],
  "visualization": {"type": "类型", "title": "标题", "mermaidCode": "代码", "complex": true/false, "items": [], "rows": [], "columns": [], "events": []}
}

只返回JSON。
${searchSection}`;
}

export function buildProfileInsightPrompt(profile: UserProfile): string {
  return `你是学习规划专家，从用户信息中提取与课程相关的洞察。

要求：只提取事实不推测，清晰总结不遗漏关键信息，不延伸推理。

目标岗位：${profile.targetJob || '未填写'}

工作经历：
${profile.workExperience?.length ? profile.workExperience.map(w => `- ${w.company}，${w.position}${w.description ? '，内容：' + w.description : ''}`).join('\n') : '暂无'}

教育背景：
${profile.education?.length ? profile.education.map(e => `- ${e.school}，${e.major}`).join('\n') : '暂无'}

用中文总结：

1. knowledgeBackground：基于工作和教育背景的关键事实（做什么产品、有什么技能、什么领域），保持事实性不推理"是否有用"

2. analogyExperiences：用户真实经历（具体做过的事），不加引申

3. summary：一句话总结用户背景

输出JSON：
{
  "knowledgeBackground": ["总结1", "总结2"],
  "analogyExperiences": ["经历1", "经历2"],
  "summary": "一句话总结"
}`;
}

// 搜索判断
export function buildSearchJudgmentSection(): string {
  return `
## 搜索判断

判断是否需要搜索外部信息。如不需要直接返回内容；如需要返回：
{"needsSearch": true, "searchQueries": ["关键词1", "关键词2"]}

搜索词简洁准确，最多3个，优先核心概念和最新信息。
`;
}

// 搜索结果注入
export function buildSearchResultsSection(searchResults: string): string {
  return `
## 搜索结果

${searchResults}

基于搜索结果生成更准确的内容。如搜索结果足够返回最终JSON；如需页面详情返回：
{"needsPageFetch": true, "urls": ["url1", "url2", "url3"]}

最多3个URL，只请求确实需要的页面。
`;
}

// 页面抓取结果注入
export function buildPageFetchSection(pageContents: string): string {
  return `
## 页面详情

${pageContents}

基于页面详情补充或验证内容。如足够返回最终JSON；如仍需更多（最多额外1次）返回：
{"needsPageFetch": true, "urls": ["url1", "url2", "url3"]}

**超过最大调用次数后直接基于已有内容生成。**
`;
}