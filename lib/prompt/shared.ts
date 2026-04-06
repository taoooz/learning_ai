import type {
  KnowledgeGap,
  PlanningMemoryPayload,
  TeachingMemoryPayload,
  UserMemory,
  UserProfile,
} from '../../types/course';

export interface NodeGenerationContext {
  difficultySummary?: string;
  previousNodeTitle?: string;
  nextNodeTitle?: string;
  currentNodeGoal?: string;
  courseOutline?: string[];
  prerequisiteTitles?: string[];
}

export interface PersonalizationSignals {
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
    ...(userMemory.profile.insights?.knowledgeBackground || []),
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

export function buildMemorySection(topic: string, userMemory?: UserMemory | null): string {
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

export function buildPlanningMemorySection(payload?: PlanningMemoryPayload | null): string {
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
`;
}

export function buildTeachingMemorySection(payload?: TeachingMemoryPayload | null): string {
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

export function buildSearchJudgmentSection(): string {
  return `
## 搜索判断

判断是否需要搜索外部信息。如不需要直接返回内容；如需要返回：
{"needsSearch": true, "searchQueries": ["关键词1", "关键词2"]}

搜索词简洁准确，最多3个，优先核心概念和最新信息。
`;
}

export function buildSearchResultsSection(searchResults: string): string {
  return `
## 搜索结果

${searchResults}

基于搜索结果生成更准确的内容。如搜索结果足够返回最终JSON；如需页面详情返回：
{"needsPageFetch": true, "urls": ["url1", "url2", "url3"]}

最多3个URL，只请求确实需要的页面。
`;
}

export function buildPageFetchSection(pageContents: string): string {
  return `
## 页面详情

${pageContents}

基于页面详情补充或验证内容。如足够返回最终JSON；如仍需更多（最多额外1次）返回：
{"needsPageFetch": true, "urls": ["url1", "url2", "url3"]}

**超过最大调用次数后直接基于已有内容生成。**
`;
}

export function buildProfileSection(userProfile: UserProfile | null): string {
  if (!userProfile) return '';

  const { insights, targetJob, workExperience, education } = userProfile;

  let insightSection = '';
  if (insights) {
    const { knowledgeBackground, analogyExperiences, summary } = insights;
    insightSection = `
用户背景总结：${summary || '暂无'}

知识背景：
${knowledgeBackground?.length ? knowledgeBackground.map(k => `- ${k}`).join('\n') : '暂无相关背景'}

类比经历：
${analogyExperiences?.length ? analogyExperiences.map(a => `- ${a}`).join('\n') : '暂无相关经历'}
`;
  }

  let targetSection = '';
  if (targetJob) {
    targetSection = `\n目标岗位：${targetJob}\n`;
  }

  let experienceSection = '';
  if (workExperience?.length) {
    experienceSection = `
工作经历：
${workExperience.map(w => `- ${w.company}，${w.position}${w.description ? '，' + w.description : ''}`).join('\n')}
`;
  }

  let educationSection = '';
  if (education?.length) {
    educationSection = `
教育背景：
${education.map(e => `- ${e.school}，${e.major}`).join('\n')}
`;
  }

  if (!insightSection && !targetSection && !experienceSection && !educationSection) {
    return '';
  }

  return `
## 用户画像

${insightSection}${targetSection}${experienceSection}${educationSection}`;
}
