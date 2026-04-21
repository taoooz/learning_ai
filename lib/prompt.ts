// lib/prompt.ts

import type {
  ClarificationAnswer,
  CourseBlueprintPromptPayload,
  NodeLessonPromptPayload,
  PlanningMemoryPayload,
  Question,
  TeachingMemoryPayload,
  UserMemory,
  UserProfile,
} from '../types/course';
import type { KnowledgeGap } from '../types/course';

interface NodeGenerationContext {
  difficultySummary?: string;
  previousNodeTitle?: string;
  nextNodeTitle?: string;
  currentNodeGoal?: string;
  courseOutline?: string[];
  prerequisiteTitles?: string[];
}

interface PersonalizationSignals {
  mustAddressGaps: KnowledgeGap[];
  reviewOnlyItems: string[];
  analogyOnlyItems: string[];
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim();
}

function tokenizeTopic(value: string): string[] {
  const normalized = normalizeForMatch(value);
  const chunks = normalized.split(/\s+/).filter(Boolean);
  const chineseChunks = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  return Array.from(new Set([...chunks, ...chineseChunks]));
}

function getTopicRelevanceScore(topic: string, candidate: string): number {
  const topicTokens = tokenizeTopic(topic);
  const candidateText = normalizeForMatch(candidate);
  if (!topicTokens.length || !candidateText) return 0;

  let score = 0;
  for (const token of topicTokens) {
    if (candidateText.includes(token)) {
      score = Math.max(score, token.length >= 4 ? 1 : 0.75);
    }
  }

  const coarseMappings: Array<{ matcher: RegExp; tokens: string[] }> = [
    { matcher: /(agent|工具调用|工作流|规划|执行|mcp|记忆)/i, tokens: ['react', '埋点', '实验', '状态', '前端'] },
    { matcher: /(英语|口语|发音|语法|单词)/i, tokens: ['播客', '写作', '翻译'] },
  ];

  for (const mapping of coarseMappings) {
    if (mapping.matcher.test(topic) && mapping.tokens.some((token) => candidateText.includes(token))) {
      score = Math.max(score, 0.45);
    }
  }

  return score;
}

export function selectPersonalizationSignals(topic: string, userMemory?: UserMemory | null): PersonalizationSignals {
  if (!userMemory) {
    return { mustAddressGaps: [], reviewOnlyItems: [], analogyOnlyItems: [] };
  }

  const mustAddressGaps = userMemory.extractedInsights.knowledgeGaps.filter((gap) => {
    const relevance = Math.max(
      getTopicRelevanceScore(topic, gap.topic),
      getTopicRelevanceScore(topic, gap.concept),
    );
    const confidence = gap.confidence || 0;
    return relevance >= 0.7 || (relevance >= 0.5 && gap.source === 'assessment' && confidence >= 0.8);
  });

  const reviewOnlyItems = userMemory.extractedInsights.conceptMastery
    .filter((item) => item.needsReview)
    .filter((item) => {
      const relevance = Math.max(
        getTopicRelevanceScore(topic, item.topic),
        getTopicRelevanceScore(topic, item.concept),
      );
      return relevance >= 0.7 || (relevance >= 0.5 && item.source === 'assessment' && (item.confidence || 0) >= 0.85);
    })
    .map((item) => `${item.concept}（${item.source === 'assessment' ? '高置信度测验信号' : '复习提醒'}）`);

  const analogyCandidates = [
    ...(userMemory.profile.insights?.workSummary || []),
    ...(userMemory.profile.insights?.educationSummary || []),
    ...(userMemory.profile.insights?.analogyExperiences || []),
  ];

  const analogyOnlyItems = analogyCandidates.filter((item) => {
    const relevance = getTopicRelevanceScore(topic, item);
    return relevance >= 0.35 && relevance < 0.7;
  });

  return {
    mustAddressGaps: mustAddressGaps.slice(0, 4),
    reviewOnlyItems: reviewOnlyItems.slice(0, 4),
    analogyOnlyItems: analogyOnlyItems.slice(0, 4),
  };
}

function buildMemorySection(topic: string, userMemory?: UserMemory | null): string {
  if (!userMemory) return '';

  const signals = selectPersonalizationSignals(topic, userMemory);

  const relatedRecords = userMemory.learningHistory
    .filter((record) => record.topic === topic || record.courseId === topic)
    .slice(-3)
    .map((record) => `- ${record.topic}：已完成 ${record.nodesCompleted}/${record.totalNodes} 节`);

  const masteredConcepts = userMemory.extractedInsights.conceptMastery
    .filter((item) => item.topic === topic && item.accuracy >= 0.75)
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 5)
    .map((item) => `- ${item.concept}（正确率 ${Math.round(item.accuracy * 100)}%）`);

  const weakConcepts = [
    ...signals.mustAddressGaps
      .map((gap) => `- ${gap.concept}（${gap.source === 'assessment' ? '高相关高置信度，必须补' : gap.severity}）`),
    ...signals.reviewOnlyItems.map((item) => `- ${item}`),
  ].slice(0, 6);

  const questionPatterns = userMemory.extractedInsights.questionPatterns
    .filter((item) => item.topic === topic)
    .slice(-5)
    .map((item) => `- ${item.question}`);

  const analogyHints = signals.analogyOnlyItems.map((item) => `- ${item}`);

  return `
## 用户学习记忆

相关学习记录：
${relatedRecords.length ? relatedRecords.join('\n') : '暂无'}

已掌握基础：
${masteredConcepts.length ? masteredConcepts.join('\n') : '暂无明确已掌握项'}

待补薄弱点：
${weakConcepts.length ? weakConcepts.join('\n') : '暂无明确薄弱点'}

近期高频问题：
${questionPatterns.length ? questionPatterns.join('\n') : '暂无'}

只可用于类比的弱相关背景：
${analogyHints.length ? analogyHints.join('\n') : '暂无'}
`;
}

function buildPlanningMemorySection(payload?: PlanningMemoryPayload | null): string {
  if (!payload) return '';

  return `
## 课程规划输入

用户起点判断：
- estimatedLevel: ${payload.learnerSnapshot.estimatedLevel}
- confidence: ${payload.learnerSnapshot.confidence}
- targetGoal: ${payload.learnerSnapshot.targetGoal || '未提供'}

必须补上的概念：
${payload.mustCoverConcepts.length ? payload.mustCoverConcepts.map((item) => `- ${item}`).join('\n') : '暂无'}

可快速跳过或压缩为回顾的内容：
${payload.skippableBasics.length ? payload.skippableBasics.map((item) => `- ${item}`).join('\n') : '暂无'}

可迁移背景：
${payload.transferableBackground.length ? payload.transferableBackground.map((item) => `- ${item}`).join('\n') : '暂无'}

高风险误区：
${payload.riskConcepts.length ? payload.riskConcepts.map((item) => `- ${item}`).join('\n') : '暂无'}

最近相关学习摘要：
${payload.recentRelevantCourses.length ? payload.recentRelevantCourses.map((item) => `- ${item.summary}`).join('\n') : '暂无'}
${payload.learningSummary ? `\n学习旅程洞察：\n- 旅程：${payload.learningSummary.journey}\n- 重点：${payload.learningSummary.currentFocus}\n- 特点：${payload.learningSummary.learnerInsights.join('、')}\n- 需关注：${payload.learningSummary.areasToWatch.join('、')}` : ''}
`;
}

function buildTeachingMemorySection(payload?: TeachingMemoryPayload | null): string {
  if (!payload) return '';

  return `
## 节点教学输入

节点主题：${payload.nodeTopic}
当前节点：${payload.nodeTitle}

前置概念状态：
${payload.prerequisiteConceptStates.length
    ? payload.prerequisiteConceptStates.map((item) => `- ${item.concept}: ${item.status} (${item.masteryScore})`).join('\n')
    : '暂无'}

当前节点重点概念状态：
${payload.targetConceptStates.length
    ? payload.targetConceptStates.map((item) => `- ${item.concept}: ${item.status} (${item.masteryScore})${item.misconceptionHints.length ? `；误区：${item.misconceptionHints.join(' / ')}` : ''}`).join('\n')
    : '暂无'}

最近相关提问摘要：
${payload.recentQuestionSummaries.length ? payload.recentQuestionSummaries.map((item) => `- ${item}`).join('\n') : '暂无'}

可用类比：
${payload.analogyHints.length ? payload.analogyHints.map((item) => `- ${item}`).join('\n') : '暂无'}

偏好解释方式：
${payload.preferredExplanationStyles.length ? payload.preferredExplanationStyles.map((item) => `- ${item}`).join('\n') : '暂无'}
`;
}

export function buildCompactCourseBlueprintPrompt(topic: string, payload: CourseBlueprintPromptPayload): string {
  return `你需要生成一份课程目录大纲，只返回 JSON。

主题：${topic}
用户水平：${payload.learnerSnapshot.estimatedLevel}
用户目标：${payload.learnerSnapshot.targetGoal || '未提供'}

个性化要求：
- 必须覆盖：${payload.mustCoverConceptNames.join('、') || '无'}
- 高风险概念（需特别注意）：${payload.riskConceptNames.join('、') || '无'}
- 可快速跳过：${payload.skippableConceptIds.join(', ') || '无'}
- 用户背景类比：${payload.analogyFacts.map((item) => item.text).join('；') || '无'}
- 相关历史课程：${payload.recentEpisodes.map((item) => item.summary).join('；') || '无'}

生成建议：
- 根据主题复杂度生成 5~15 个节点
- 输出内容使用中文
- 课程名称建议在10字以内
- 每个节点标题建议在20字以内
- 简要整理 difficultySummary 和 courseGoal 内容
- 每个 teachingGoal 简要整理

输出格式：
{
  "courseName": "课程名称",
  "difficultySummary": "一句话描述",
  "courseGoal": "一句话描述",
  "nodes": [{
    "title": "具体标题",
    "teachingGoal": "一句话目标"
  }]
}

只返回 JSON。`;
}

export function buildNodeLessonPrompt(topic: string, payload: NodeLessonPromptPayload): string {
  const analogySection = payload.analogyFacts.length
    ? `## 可用类比\n${payload.analogyFacts.map((item) => `- ${item.text}`).join('\n')}\n\n`
    : '';
  const stylesSection = payload.preferredExplanationStyles.length
    ? `## 偏好解释方式\n${payload.preferredExplanationStyles.map((item) => `- ${item}`).join('\n')}\n\n`
    : '';
  const questionsSection = payload.recentRelevantQuestions.length
    ? `## 最近相关提问\n${payload.recentRelevantQuestions.map((item) => `- ${item}`).join('\n')}\n\n`
    : '';

  return `你是 AI 导师，请生成一节 NodeLesson。

主题：${topic}
当前节点：${payload.nodeTitle}
节点目标：${payload.teachingGoal}

${analogySection}${stylesSection}${questionsSection}## 内容要求
- 根据提供的课程、用户信息生成该节点课程内容
- 优先判断该节课需要的知识及问题卡片数量。知识建议在 5~8 条，问题 2~5 个。
- 知识卡片内容应循序渐进，尽量避免重复内容
- 每张知识卡片包含 title、content（Markdown，建议 150-400字）
- 知识卡片可根据需要添加 visualization 字段来辅助理解
- 问题必须基于前面知识卡片中的内容来出，确保与知识强相关
- 问题卡片间尽量避免重复内容
- 问题类型：single（单选）、multiple（多选）、fill_blank（填空）

## 可视化类型说明
- flowchart: 流程图，使用 Mermaid 语法，如 "graph TD; A-->B"
- timeline: 时间线，包含 events 数组，每项有 time/title/description
- comparison: 对比表，包含 columns（列标题）和 rows（行数据）

## 输出 JSON
{
  "courseId": "课程 ID",
  "nodeIndex": 0,
  "title": "${payload.nodeTitle}",
  "teachingGoal": "${payload.teachingGoal}",
  "cards": [{
    "id": "card-1",
    "title": "标题",
    "content": "Markdown 内容",
    "visualization": {
      "type": "flowchart|timeline|comparison",
      "title": "可选标题",
      "mermaidCode": "Mermaid 语法（flowchart 类型时）",
      "events": [{"time": "时间", "title": "事件", "description": "描述"}],
      "columns": ["列1", "列2"],
      "rows": [["行1列1", "行1列2"], ["行2列1", "行2列2"]]
    }
  }],
  "questions": [{
    "id": "q-1",
    "type": "single|multiple|fill_blank",
    "question": "题干",
    "options": ["A", "B"],
    "answer": "答案",
    "explanation": "解析"
  }]
}

只返回 JSON。`;
}

export function buildCourseTreePrompt(
  topic: string,
  userProfile?: UserProfile | null,
  clarificationAnswers?: ClarificationAnswer[],
  userMemory?: UserMemory | null,
  searchResults?: string,
  pageContents?: string,
  planningPayload?: PlanningMemoryPayload | null,
): string {
  let insightSection = '';
  let clarificationSection = '';
  const memorySection = planningPayload
    ? buildPlanningMemorySection(planningPayload)
    : buildMemorySection(topic, userMemory);

  if (userProfile?.insights) {
    const { workSummary, educationSummary, analogyExperiences } = userProfile.insights;
    const backgroundItems = [...(workSummary || []), ...(educationSummary || [])];
    insightSection = `
## 用户洞察

知识背景：
${backgroundItems.length ? backgroundItems.map((k: string) => `- ${k}`).join('\n') : '暂无相关背景'}

类比经历：
${analogyExperiences?.length ? analogyExperiences.map((a: string) => `- ${a}`).join('\n') : '暂无相关经历'}
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

  return `${insightSection}${memorySection}${clarificationSection}你是AI导师，创建个性化学习路径。

主题：${topic}

## 结构决策
- 节点数：5-15（取决于主题复杂度）
- 每节点卡片：8-12张
- 节点间有清晰逻辑顺序

## 质量标准
- 结构清晰：由浅入深，环环相扣
- 目标明确：每节点有清晰学习目标
- 可实践：能解决真实问题

## 个性化课程设计要求
- 先判断用户当前起点，再决定从哪里开始讲
- 先消化“课程规划输入”，再决定课程结构
- 避免完整重讲用户已经掌握的内容，可压缩为快速回顾
- 若存在薄弱点，必须显式安排补基础或纠正常见误解的节点
- 优先使用用户真实经历做类比，帮助抽象概念落地
- 若主题与用户目标岗位相关，节点命名和案例优先贴近该岗位真实任务
- difficultySummary 必须体现“为什么这门课是这个难度”和“课程针对哪类起点用户”
- 每个节点标题要体现阶段目标，避免空泛标题如“进阶篇”“补充内容”
- 先在内部判断：哪些内容可以跳过、哪些必须补上、哪些地方必须换成用户熟悉的类比
- 为每个节点确定：目标、前置依赖、与用户背景的连接点；再输出最终课程
- 至少 2 个节点明确写出将使用的用户经历类比，但不要把类比写进 JSON 字段，只体现在节点设计里
- 当前用户想学的主题始终是主轴，不要把课程改写成其他历史主题
- 与当前主题弱相关的 memory 只能用于类比或解释风格，不能据此新增不相关节点
- 与当前主题无关的 memory 直接忽略，不要强行建立牵强联系

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
  userMemory?: UserMemory | null,
  generationContext?: NodeGenerationContext,
  searchResults?: string,
  pageContents?: string,
  teachingPayload?: TeachingMemoryPayload | null,
): string {
  let insightSection = '';
  const memorySection = teachingPayload
    ? buildTeachingMemorySection(teachingPayload)
    : buildMemorySection(topic, userMemory);

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

  const contextSection = generationContext ? `
## 课程上下文

课程难度：${generationContext.difficultySummary || '未提供'}
整门课程结构：${generationContext.courseOutline?.length ? generationContext.courseOutline.join(' -> ') : '未提供'}
上一节：${generationContext.previousNodeTitle || '无'}
当前节点前置依赖：${generationContext.prerequisiteTitles?.length ? generationContext.prerequisiteTitles.join('、') : '无'}
当前目标：${generationContext.currentNodeGoal || `帮助用户掌握${nodeTitle}`}
下一节：${generationContext.nextNodeTitle || '无'}
` : '';

  return `${insightSection}${memorySection}${contextSection}你是AI导师，创建学习内容。

主题：${topic}
当前节点：${nodeTitle}

请生成${cardCount}张学习卡片和配套Quiz题目。

## 卡片质量标准
1. 场景引入：用具体场景吸引用户
2. 核心概念：简洁准确地定义
3. 避坑提示：指出常见错误
4. 一句话总结
5. 先消化“节点教学输入”，再决定解释顺序
6. 如果用户已掌握某概念，用 1 张卡片内快速唤醒；如果是薄弱点，要增加误区辨析和反例
7. 避免重复讲解上一节已经覆盖的定义和例子，本节应重点推进到新的理解层次
8. 若用户历史背景与本节仅弱相关，只能作为类比素材，不要让内容偏离当前节点主题

卡片格式：title、content（Markdown，150-400字）、imageUrl: null

## 题目设计原则
- 基于本节内容，考查核心概念的理解和应用
- 关注实际应用价值，避免考查人名、时间等琐碎信息
- 考察理解**和应用**，记忆其次
- 能筛选出真正掌握要点的学生
- 每道题必须标注 concept、dimension、difficulty，方便后续更新用户 mastery
- 如果存在用户薄弱点，至少 1 道题直接考查该薄弱点
- 优先把题目绑定到对应卡片，用 cardId 指向相关卡片
- 如果有前置依赖，本节开头先用 1 张卡片衔接，不要默认用户还记得上一节全部细节
- 如果某个 memory 只是弱相关背景，不要据此把题目改造成其他主题

题目类型：single（单选）、multiple（多选）、fill_blank（填空）
数量：3-5道，覆盖核心知识点

## 输出格式
{
  "cards": [{"id": "card-1", "title": "标题", "content": "Markdown内容", "imageUrl": null}],
  "questions": [{"id": "q-1", "type": "single|multiple|fill_blank", "question": "题目", "options": ["A", "B", "C", "D"], "answer": "答案(single:字符串, multiple:字符串数组, fill_blank:正确答案数组)", "explanation": "解析", "concept": "本题考查的核心概念", "dimension": "memory|understanding|application|analysis", "difficulty": 1, "cardId": "card-1"}]
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
