import test from 'node:test';
import assert from 'node:assert/strict';

let getCourseTreeLayout: typeof import('../lib/course-tree-layout').getCourseTreeLayout;
let getCourseTreeInitialScrollTop: typeof import('../lib/course-tree-layout').getCourseTreeInitialScrollTop;
let buildCourseTreePrompt: typeof import('../lib/prompt').buildCourseTreePrompt;
let buildNodeContentPrompt: typeof import('../lib/prompt').buildNodeContentPrompt;
let selectPersonalizationSignals: typeof import('../lib/prompt').selectPersonalizationSignals;
let buildChatContext: typeof import('../lib/chat-context').buildChatContext;
let compactChatHistoryMessages: typeof import('../hooks/useChatHistory').compactChatHistoryMessages;
let generateConversationSummary: typeof import('../hooks/useChatHistory').generateConversationSummary;
let createMemoryRepository: typeof import('../lib/memory/repository').createMemoryRepository;
let CHAT_CONCEPT_ALIASES: typeof import('../lib/memory/aggregator').CHAT_CONCEPT_ALIASES;
let appendChatSignalsInAggregator: typeof import('../lib/memory/aggregator').appendChatSignalsToMemoryStore;
let detectChatLearningPreferences: typeof import('../lib/memory/aggregator').detectChatLearningPreferences;
let detectExplicitMasteredConcept: typeof import('../lib/memory/aggregator').detectExplicitMasteredConcept;
let getChatPayloadFromAggregator: typeof import('../lib/memory/aggregator').getChatMemoryPayload;
let getPlanningPayloadFromAggregator: typeof import('../lib/memory/aggregator').getPlanningMemoryPayload;
let getTeachingPayloadFromAggregator: typeof import('../lib/memory/aggregator').getTeachingMemoryPayload;
let migrateToV2FromAggregator: typeof import('../lib/memory/aggregator').migrateUserMemoryToV2;
let normalizeConceptKeyFromAggregator: typeof import('../lib/memory/aggregator').normalizeConceptKey;
let appendChatSignalsToMemoryStore: typeof import('../hooks/useUserMemory').appendChatSignalsToMemoryStore;
let analyzeChatMessageForMemory: typeof import('../hooks/useUserMemory').analyzeChatMessageForMemory;
let createDefaultUserMemory: typeof import('../hooks/useUserMemory').createDefaultUserMemory;
let decayUserMemory: typeof import('../hooks/useUserMemory').decayUserMemory;
let getChatMemoryPayload: typeof import('../hooks/useUserMemory').getChatMemoryPayload;
let getPlanningMemoryPayload: typeof import('../hooks/useUserMemory').getPlanningMemoryPayload;
let getTeachingMemoryPayload: typeof import('../hooks/useUserMemory').getTeachingMemoryPayload;
let migrateUserMemoryToV2: typeof import('../hooks/useUserMemory').migrateUserMemoryToV2;
let normalizeConceptKey: typeof import('../hooks/useUserMemory').normalizeConceptKey;
let recordQuestionAttemptInMemory: typeof import('../hooks/useUserMemory').recordQuestionAttemptInMemory;
let recordChatInsightInMemory: typeof import('../hooks/useUserMemory').recordChatInsightInMemory;

test.before(async () => {
  const layoutModule = await import('../lib/course-tree-layout');
  getCourseTreeLayout = layoutModule.getCourseTreeLayout;
  getCourseTreeInitialScrollTop = layoutModule.getCourseTreeInitialScrollTop;

  const promptModule = await import('../lib/prompt');
  buildCourseTreePrompt = promptModule.buildCourseTreePrompt;
  buildNodeContentPrompt = promptModule.buildNodeContentPrompt;
  selectPersonalizationSignals = promptModule.selectPersonalizationSignals;

  const chatContextModule = await import('../lib/chat-context');
  buildChatContext = chatContextModule.buildChatContext;

  const chatHistoryModule = await import('../hooks/useChatHistory');
  compactChatHistoryMessages = chatHistoryModule.compactChatHistoryMessages;
  generateConversationSummary = chatHistoryModule.generateConversationSummary;

  const repositoryModule = await import('../lib/memory/repository');
  createMemoryRepository = repositoryModule.createMemoryRepository;

  const aggregatorModule = await import('../lib/memory/aggregator');
  CHAT_CONCEPT_ALIASES = aggregatorModule.CHAT_CONCEPT_ALIASES;
  appendChatSignalsInAggregator = aggregatorModule.appendChatSignalsToMemoryStore;
  detectChatLearningPreferences = aggregatorModule.detectChatLearningPreferences;
  detectExplicitMasteredConcept = aggregatorModule.detectExplicitMasteredConcept;
  getChatPayloadFromAggregator = aggregatorModule.getChatMemoryPayload;
  getPlanningPayloadFromAggregator = aggregatorModule.getPlanningMemoryPayload;
  getTeachingPayloadFromAggregator = aggregatorModule.getTeachingMemoryPayload;
  migrateToV2FromAggregator = aggregatorModule.migrateUserMemoryToV2;
  normalizeConceptKeyFromAggregator = aggregatorModule.normalizeConceptKey;

  const userMemoryModule = await import('../hooks/useUserMemory');
  appendChatSignalsToMemoryStore = userMemoryModule.appendChatSignalsToMemoryStore;
  analyzeChatMessageForMemory = userMemoryModule.analyzeChatMessageForMemory;
  createDefaultUserMemory = userMemoryModule.createDefaultUserMemory;
  decayUserMemory = userMemoryModule.decayUserMemory;
  getChatMemoryPayload = userMemoryModule.getChatMemoryPayload;
  getPlanningMemoryPayload = userMemoryModule.getPlanningMemoryPayload;
  getTeachingMemoryPayload = userMemoryModule.getTeachingMemoryPayload;
  migrateUserMemoryToV2 = userMemoryModule.migrateUserMemoryToV2;
  normalizeConceptKey = userMemoryModule.normalizeConceptKey;
  recordQuestionAttemptInMemory = userMemoryModule.recordQuestionAttemptInMemory;
  recordChatInsightInMemory = userMemoryModule.recordChatInsightInMemory;
});

test('getCourseTreeLayout returns left-biased staggered positions', () => {
  const layout = getCourseTreeLayout([0, 1, 2, 3]) as Array<{
    index: number;
    top: number;
    offset: number;
  }>;

  assert.equal(layout.length, 4);
  assert.deepEqual(
    layout.map((item) => ({ index: item.index, top: item.top, offset: item.offset })),
    [
      { index: 0, top: 18, offset: 0 },
      { index: 1, top: 126, offset: 14 },
      { index: 2, top: 234, offset: -8 },
      { index: 3, top: 342, offset: 12 },
    ],
  );
});

test('getCourseTreeLayout adds extra vertical space for a tall current node card', () => {
  const layout = getCourseTreeLayout([
    {
      index: 0,
      title: '什么是强化学习（RL）——概念、历史、应用概览，以及为什么它会成为现代智能决策系统的重要基础',
      status: 'available',
    },
    {
      index: 1,
      title: '强化学习的核心要素：Agent、Environment、State、Action、Reward',
      status: 'locked',
    },
    {
      index: 2,
      title: '奖励设计：业务目标如何映射为奖励函数',
      status: 'locked',
    },
  ]) as Array<{
    index: number;
    top: number;
    offset: number;
  }>;

  assert.equal(layout[0]?.top, 18);
  assert.ok(layout[1]?.top > 126);
  assert.ok(layout[2]?.top - layout[1]?.top > 108);
});

test('getCourseTreeInitialScrollTop keeps the current node near upper-middle viewport', () => {
  const scrollTop = getCourseTreeInitialScrollTop({
    nodeTop: 640,
    viewportHeight: 900,
    offsetRatio: 0.26,
  });

  assert.equal(scrollTop, 406);
});

test('getCourseTreeInitialScrollTop clamps to zero near the top', () => {
  const scrollTop = getCourseTreeInitialScrollTop({
    nodeTop: 120,
    viewportHeight: 900,
    offsetRatio: 0.26,
  });

  assert.equal(scrollTop, 0);
});

test('buildCourseTreePrompt injects profile and memory based personalization rules', () => {
  const memory = createDefaultUserMemory({
    name: '小王',
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      knowledgeBackground: ['做过 React 后台项目'],
      analogyExperiences: ['负责过埋点分析和 A/B 实验'],
      summary: '有前端和数据分析经验',
    },
  });

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-1',
    topic: 'Agent',
    concept: '工具调用',
    question: '为什么 Agent 需要工具调用？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'understanding',
  });

  const prompt = buildCourseTreePrompt('Agent', memory.profile, undefined, memory);

  assert.match(prompt, /个性化课程设计要求/);
  assert.match(prompt, /已掌握基础/);
  assert.match(prompt, /待补薄弱点/);
  assert.match(prompt, /避免完整重讲用户已经掌握的内容/);
  assert.match(prompt, /工具调用/);
  assert.match(prompt, /先在内部判断：哪些内容可以跳过、哪些必须补上/);
  assert.match(prompt, /为每个节点确定：目标、前置依赖、与用户背景的连接点/);
  assert.match(prompt, /至少 2 个节点明确写出将使用的用户经历类比/);
});

test('buildNodeContentPrompt asks for course context and mastery aware question metadata', () => {
  const memory = createDefaultUserMemory({
    targetJob: '前端工程师',
    workExperience: [],
    education: [],
    insights: {
      knowledgeBackground: ['熟悉 React 组件开发'],
      analogyExperiences: ['做过复杂表单和状态管理'],
      summary: '有前端开发经验',
    },
  });

  const prompt = buildNodeContentPrompt(
    'Agent',
    '规划与执行',
    8,
    memory.profile.insights,
    memory,
    {
      difficultySummary: '适合有 React 基础、第一次系统学习 Agent 的用户',
      previousNodeTitle: '什么是 Agent',
      nextNodeTitle: '工具调用',
      currentNodeGoal: '理解规划与执行如何协同工作',
      courseOutline: ['什么是 Agent', '规划与执行', '工具调用', '记忆系统'],
      prerequisiteTitles: ['什么是 Agent'],
    },
  );

  assert.match(prompt, /课程上下文/);
  assert.match(prompt, /上一节：什么是 Agent/);
  assert.match(prompt, /下一节：工具调用/);
  assert.match(prompt, /整门课程结构：/);
  assert.match(prompt, /当前节点前置依赖：什么是 Agent/);
  assert.match(prompt, /避免重复讲解上一节已经覆盖的定义和例子/);
  assert.match(prompt, /"concept": "本题考查的核心概念"/);
  assert.match(prompt, /如果用户已掌握某概念，用 1 张卡片内快速唤醒/);
});

test('recordQuestionAttemptInMemory updates mastery and escalates repeated gaps', () => {
  const memory = createDefaultUserMemory();

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-2',
    topic: 'React',
    concept: '闭包',
    question: '为什么这里会拿到旧 state？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'application',
  });

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-2',
    topic: 'React',
    concept: '闭包',
    question: '闭包和 useEffect 依赖有什么关系？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'application',
  });

  const mastery = memory.extractedInsights.conceptMastery[0];
  const gap = memory.extractedInsights.knowledgeGaps[0];

  assert.equal(mastery.concept, '闭包');
  assert.equal(mastery.totalAttempts, 2);
  assert.equal(mastery.correctAttempts, 0);
  assert.equal(mastery.needsReview, true);
  assert.equal(gap.severity, 'medium');
  assert.equal(gap.evidence.length, 2);
});

test('analyzeChatMessageForMemory ignores normal questions without confusion signals', () => {
  const result = analyzeChatMessageForMemory('React 和 Vue 的状态管理思路有什么区别？');

  assert.equal(result.shouldAddKnowledgeGap, false);
  assert.equal(result.extractedConcept, null);
});

test('analyzeChatMessageForMemory extracts concept when user explicitly says they are confused', () => {
  const result = analyzeChatMessageForMemory('我还是没懂工具调用和工作流编排的区别，能再举个例子吗？');

  assert.equal(result.shouldAddKnowledgeGap, true);
  assert.equal(result.extractedConcept, '工具调用和工作流编排的区别');
});

test('recordChatInsightInMemory stores confidence and assessment upgrades stay incremental', () => {
  const memory = createDefaultUserMemory();

  recordChatInsightInMemory(memory, {
    topic: 'Agent',
    concept: '工具调用',
    evidence: '我还是没懂工具调用和工作流编排的区别',
    confidence: 0.62,
  });

  const firstGap = memory.extractedInsights.knowledgeGaps[0];
  assert.equal(firstGap.source, 'chat');
  assert.equal(firstGap.confidence, 0.62);
  assert.equal(firstGap.severity, 'low');

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-3',
    topic: 'Agent',
    concept: '工具调用',
    question: '哪种情况应该调用外部工具？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'application',
  });

  const upgradedGap = memory.extractedInsights.knowledgeGaps[0];
  assert.equal(upgradedGap.source, 'assessment');
  assert.equal((upgradedGap.confidence || 0) < 0.85, true);
  assert.equal(upgradedGap.severity, 'low');
});

test('recordQuestionAttemptInMemory avoids locking mastery after a single wrong answer', () => {
  const memory = createDefaultUserMemory();

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-4',
    topic: 'Agent',
    concept: '工具调用',
    question: '什么时候必须调用工具？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'application',
  });

  const mastery = memory.extractedInsights.conceptMastery[0]!;
  const gap = memory.extractedInsights.knowledgeGaps[0]!;

  assert.equal((mastery.confidence || 0) < 0.8, true);
  assert.equal((gap.confidence || 0) < 0.8, true);
  assert.equal(gap.severity, 'low');
});

test('recordQuestionAttemptInMemory lets sustained correct answers repair earlier misunderstanding', () => {
  const memory = createDefaultUserMemory();

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-5',
    topic: 'Agent',
    concept: '工具调用',
    question: '什么时候必须调用工具？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'application',
  });

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-5',
    topic: 'Agent',
    concept: '工具调用',
    question: '工具调用和直接回答有什么区别？',
    isCorrect: true,
    difficulty: 2,
    dimension: 'understanding',
  });

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-5',
    topic: 'Agent',
    concept: '工具调用',
    question: '什么场景下不需要工具调用？',
    isCorrect: true,
    difficulty: 2,
    dimension: 'understanding',
  });

  const mastery = memory.extractedInsights.conceptMastery[0]!;
  const gap = memory.extractedInsights.knowledgeGaps[0]!;

  assert.equal(mastery.accuracy > 0.6, true);
  assert.equal(mastery.needsReview, false);
  assert.equal(gap.severity, 'low');
  assert.equal((gap.confidence || 0) < 0.6, true);
});

test('decayUserMemory lowers stale chat-derived weights but keeps recent assessment signals', () => {
  const memory = createDefaultUserMemory();
  const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;

  memory.extractedInsights.interests.push({
    topic: 'Agent',
    weight: 5,
    source: 'chat',
    lastInteraction: fortyDaysAgo,
  });

  memory.extractedInsights.questionPatterns.push({
    topic: 'Agent',
    question: '工具调用和 MCP 有什么区别？',
    timestamp: fortyDaysAgo,
    confidence: 0.7,
    source: 'chat',
  });

  memory.extractedInsights.knowledgeGaps.push({
    topic: 'Agent',
    concept: '工作流编排',
    evidence: ['我还是没懂工作流编排'],
    severity: 'medium',
    confidence: 0.68,
    source: 'chat',
    lastUpdated: fortyDaysAgo,
  });

  memory.extractedInsights.conceptMastery.push({
    topic: 'Agent',
    concept: '工具调用',
    totalAttempts: 3,
    correctAttempts: 1,
    accuracy: 0.33,
    lastReviewedAt: Date.now(),
    lastOutcome: 'incorrect',
    needsReview: true,
    confidence: 0.95,
    source: 'assessment',
  });

  decayUserMemory(memory, Date.now());

  const interest = memory.extractedInsights.interests[0]!;
  const questionPattern = memory.extractedInsights.questionPatterns[0]!;
  const knowledgeGap = memory.extractedInsights.knowledgeGaps[0]!;
  const conceptMastery = memory.extractedInsights.conceptMastery[0]!;

  assert.equal(interest.weight < 5, true);
  assert.equal((questionPattern.confidence || 0) < 0.7, true);
  assert.equal((knowledgeGap.confidence || 0) < 0.68, true);
  assert.equal(conceptMastery.confidence, 0.95);
});

test('selectPersonalizationSignals keeps only directly relevant mastery signals for structural changes', () => {
  const memory = createDefaultUserMemory();

  memory.extractedInsights.knowledgeGaps.push({
    topic: 'Agent',
    concept: '工具调用',
    evidence: ['哪种场景必须调用外部工具？'],
    severity: 'medium',
    confidence: 0.86,
    source: 'assessment',
    lastUpdated: Date.now(),
  });

  memory.extractedInsights.knowledgeGaps.push({
    topic: '英语口语',
    concept: '发音',
    evidence: ['总是分不清发音规则'],
    severity: 'high',
    confidence: 0.9,
    source: 'assessment',
    lastUpdated: Date.now(),
  });

  memory.profile.insights = {
    knowledgeBackground: ['做过 React 后台项目', '自己做过播客剪辑'],
    analogyExperiences: ['做过埋点分析', '录过播客并剪辑音频'],
    summary: '前端和内容创作背景',
  };

  const signals = selectPersonalizationSignals('Agent 工具调用', memory);

  assert.equal(signals.mustAddressGaps.some((item) => item.concept === '工具调用'), true);
  assert.equal(signals.mustAddressGaps.some((item) => item.concept === '发音'), false);
  assert.equal(signals.analogyOnlyItems.some((item) => item.includes('播客')), false);
});

test('selectPersonalizationSignals keeps weakly related background only for analogy', () => {
  const memory = createDefaultUserMemory({
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      knowledgeBackground: ['做过 React 后台项目'],
      analogyExperiences: ['负责过埋点分析和实验设计'],
      summary: '有前端和数据分析经验',
    },
  });

  memory.extractedInsights.knowledgeGaps.push({
    topic: '前端工程',
    concept: '状态管理',
    evidence: ['还是分不清全局状态和局部状态'],
    severity: 'medium',
    confidence: 0.66,
    source: 'chat',
    lastUpdated: Date.now(),
  });

  const signals = selectPersonalizationSignals('Agent 规划机制', memory);

  assert.equal(signals.mustAddressGaps.length, 0);
  assert.equal(signals.analogyOnlyItems.some((item) => item.includes('埋点分析')), true);
});

test('migrateUserMemoryToV2 preserves stable profile facts and derives topic state', () => {
  const memory = createDefaultUserMemory({
    name: '小王',
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      knowledgeBackground: ['做过 React 后台项目'],
      analogyExperiences: ['负责过埋点分析和实验设计'],
      summary: '前端和数据分析经验',
    },
  });

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-agent',
    topic: 'Agent',
    concept: '工具调用',
    question: '什么时候必须调用工具？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'application',
  });

  const migrated = migrateUserMemoryToV2(memory);

  assert.equal(migrated.version, 2);
  assert.equal(migrated.profile.stableFacts.some((item) => item.text.includes('React 后台项目')), true);
  assert.equal(migrated.profile.stableFacts.some((item) => item.text.includes('埋点分析')), true);
  assert.equal(migrated.states.topicStates.some((item) => item.topic === 'Agent'), true);
  assert.equal(migrated.states.conceptStates.some((item) => item.concept === '工具调用'), true);
});

// ============ 以下测试使用废弃的 V1/V2 API，已跳过 ============
// 新的 V3 + Memory Agent 测试在 course-blueprint-memory-v3.test.ts

test.skip('getPlanningMemoryPayload keeps high-signal topic guidance and drops unrelated chat noise', () => {
  const memory = createDefaultUserMemory({
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      knowledgeBackground: ['做过 React 后台项目'],
      analogyExperiences: ['负责过埋点分析和实验设计', '录过英语播客'],
      summary: '前端和内容创作经验',
    },
  });

  memory.learningHistory.push({
    courseId: 'course-agent',
    topic: 'Agent',
    nodesCompleted: 3,
    totalNodes: 6,
    completedAt: Date.now(),
  });

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-agent',
    topic: 'Agent',
    concept: '工具调用',
    question: '什么时候必须调用外部工具？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'application',
  });

  recordChatInsightInMemory(memory, {
    topic: '英语口语',
    concept: '发音',
    evidence: '总是搞不懂这个发音规则',
    confidence: 0.82,
  });

  const payload = getPlanningMemoryPayload('Agent 工具调用', memory);

  assert.equal(payload.mustCoverConcepts.includes('工具调用'), true);
  assert.equal(payload.riskConcepts.includes('工具调用'), true);
  assert.equal(payload.transferableBackground.some((item) => item.includes('埋点分析')), true);
  assert.equal(payload.transferableBackground.some((item) => item.includes('播客')), false);
  assert.equal(payload.recentRelevantCourses.some((item) => item.topic === 'Agent'), true);
});

test.skip('getTeachingMemoryPayload focuses on node concepts and prerequisite mastery', () => {
  const memory = createDefaultUserMemory({
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      knowledgeBackground: ['做过 React 后台项目'],
      analogyExperiences: ['负责过埋点分析和实验设计'],
      summary: '前端和数据分析经验',
    },
  });

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-agent',
    topic: 'Agent',
    concept: 'Agent 基本定义',
    question: 'Agent 的核心特征是什么？',
    isCorrect: true,
    difficulty: 1,
    dimension: 'understanding',
  });

  recordQuestionAttemptInMemory(memory, {
    courseId: 'course-agent',
    topic: 'Agent',
    concept: '工具调用',
    question: '什么时候必须调用外部工具？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'application',
  });

  memory.extractedInsights.questionPatterns.push({
    topic: 'Agent',
    question: '工具调用和工作流编排有什么区别？',
    timestamp: Date.now(),
    confidence: 0.7,
    source: 'chat',
  });

  const payload = getTeachingMemoryPayload({
    topic: 'Agent',
    nodeTitle: '工具调用',
    nodeConcepts: ['工具调用', '工具选择时机'],
    prerequisiteConcepts: ['Agent 基本定义'],
    userMemory: memory,
  });

  assert.equal(payload.targetConceptStates.some((item) => item.concept === '工具调用'), true);
  assert.equal(payload.prerequisiteConceptStates.some((item) => item.concept === 'Agent 基本定义'), true);
  assert.equal(payload.recentQuestionSummaries.some((item) => item.includes('工具调用和工作流编排')), true);
  assert.equal(payload.analogyHints.some((item) => item.includes('埋点分析')), true);
});

test('detectChatLearningPreferences extracts explanation style preferences from user wording', () => {
  const preferences = detectChatLearningPreferences('还是有点懵，能不能一步一步讲，再举个例子对比一下？');

  assert.equal(preferences.some((item) => item.value === '分步拆解'), true);
  assert.equal(preferences.some((item) => item.value === '例子驱动'), true);
  assert.equal(preferences.some((item) => item.value === '对比讲解'), true);
});

test('detectExplicitMasteredConcept captures explicit understanding statements', () => {
  const mastered = detectExplicitMasteredConcept('工具调用我已经明白了，不过工作流编排还是有点混淆');

  assert.equal(mastered?.concept, '工具调用');
  assert.equal((mastered?.confidence || 0) >= 0.65, true);
});

test('buildCourseTreePrompt supports structured planning payload injection', () => {
  const prompt = buildCourseTreePrompt(
    'Agent',
    null,
    undefined,
    null,
    undefined,
    undefined,
    {
      learnerSnapshot: {
        targetGoal: '希望课程服务于 AI 产品经理相关成长',
        estimatedLevel: 'beginner',
        confidence: 0.82,
      },
      transferableBackground: ['负责过埋点分析和实验设计'],
      mustCoverConcepts: ['工具调用'],
      skippableBasics: ['基础前端组件概念'],
      riskConcepts: ['工具调用'],
      recentRelevantCourses: [{ topic: 'Agent', summary: 'Agent 已完成 3/6 节' }],
    },
  );

  assert.match(prompt, /课程规划输入/);
  assert.match(prompt, /必须补上的概念/);
  assert.match(prompt, /Agent 已完成 3\/6 节/);
});

test('buildNodeContentPrompt supports structured teaching payload injection', () => {
  const prompt = buildNodeContentPrompt(
    'Agent',
    '工具调用',
    8,
    null,
    null,
    {
      difficultySummary: '适合初学者',
      previousNodeTitle: '什么是 Agent',
      nextNodeTitle: '工作流编排',
      currentNodeGoal: '理解工具调用的必要性',
      courseOutline: ['什么是 Agent', '工具调用', '工作流编排'],
      prerequisiteTitles: ['什么是 Agent'],
    },
    undefined,
    undefined,
    {
      nodeTopic: 'Agent',
      nodeTitle: '工具调用',
      prerequisiteConceptStates: [{ concept: 'Agent 基本定义', status: 'mastered', masteryScore: 0.84 }],
      targetConceptStates: [{ concept: '工具调用', status: 'learning', masteryScore: 0.42, misconceptionHints: ['容易和工作流编排混淆'] }],
      recentQuestionSummaries: ['工具调用和工作流编排有什么区别？'],
      analogyHints: ['负责过埋点分析和实验设计'],
      preferredExplanationStyles: ['分步拆解', '例子驱动'],
    },
  );

  assert.match(prompt, /节点教学输入/);
  assert.match(prompt, /当前节点重点概念状态/);
  assert.match(prompt, /容易和工作流编排混淆/);
  assert.match(prompt, /偏好解释方式/);
});

test('normalizeConceptKey collapses close variants into one canonical concept', () => {
  assert.equal(normalizeConceptKey('外部工具调用'), normalizeConceptKey('工具调用'));
  assert.equal(normalizeConceptKey('工作流编排'), normalizeConceptKey('workflow 编排'));
});

test('appendChatSignalsToMemoryStore writes v2 chat signals that feed teaching payload', () => {
  const legacyMemory = createDefaultUserMemory({
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      knowledgeBackground: ['做过 React 后台项目'],
      analogyExperiences: ['负责过埋点分析和实验设计'],
      summary: '前端和数据分析经验',
    },
  });

  const store = migrateUserMemoryToV2(legacyMemory);
  const updated = appendChatSignalsToMemoryStore(store, {
    topic: 'Agent',
    question: '外部工具调用和工作流编排有什么区别？',
    confusionConcept: '外部工具调用',
    confusionEvidence: '我还是没懂外部工具调用和工作流编排有什么区别',
    confidence: 0.74,
  });

  const payload = getTeachingMemoryPayload({
    topic: 'Agent',
    nodeTitle: '工具调用',
    nodeConcepts: ['工具调用'],
    prerequisiteConcepts: [],
    userMemory: updated,
  });

  assert.equal(updated.signals.some((item) => item.type === 'chat_question'), true);
  assert.equal(updated.signals.some((item) => item.type === 'chat_confusion'), true);
  assert.equal(payload.targetConceptStates.some((item) => item.concept === '工具调用'), true);
  assert.equal(payload.recentQuestionSummaries.some((item) => item.includes('外部工具调用和工作流编排')), true);
});

test.skip('getChatMemoryPayload keeps chat context focused on current topic and node risk concepts', () => {
  const legacyMemory = createDefaultUserMemory({
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      knowledgeBackground: ['做过 React 后台项目'],
      analogyExperiences: ['负责过埋点分析和实验设计'],
      summary: '前端和数据分析经验',
    },
  });

  recordQuestionAttemptInMemory(legacyMemory, {
    courseId: 'course-agent',
    topic: 'Agent',
    concept: '工具调用',
    question: '什么时候必须调用外部工具？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'application',
  });

  const store = appendChatSignalsToMemoryStore(migrateUserMemoryToV2(legacyMemory), {
    topic: 'Agent',
    question: '工具调用和工作流编排有什么区别？',
    confusionConcept: '工具调用',
    confusionEvidence: '我还是没懂工具调用和工作流编排有什么区别',
    confidence: 0.74,
  });

  const payload = getChatMemoryPayload({
    topic: 'Agent',
    currentNodeTitle: '工具调用',
    currentQuestion: '什么时候必须调用工具？',
    userMemory: store,
  });

  assert.equal(payload.focusConceptStates.some((item) => item.concept === '工具调用'), true);
  assert.equal(payload.riskConcepts.includes('工具调用'), true);
  assert.equal(payload.recentQuestionSummaries.some((item) => item.includes('工具调用和工作流编排')), true);
  assert.equal(payload.analogyHints.some((item) => item.includes('埋点分析')), true);
});

test('buildChatContext prefers structured v2 payload over legacy chat memory noise', () => {
  const context = buildChatContext(
    {
      courseId: 'course-agent',
      topic: 'Agent',
      courseGoal: '学习 Agent 开发',
      difficultySummary: '适合初学者',
      totalNodes: 3,
      nodes: [
        { index: 0, title: '什么是 Agent', status: 'completed' },
        { index: 1, title: '工具调用', status: 'available' },
        { index: 2, title: '工作流编排', status: 'locked' },
      ],
    },
    [{ id: 'msg-1', role: 'user', content: '工具调用到底什么时候需要？', timestamp: Date.now() }],
    {
      currentNodeTitle: '工具调用',
      currentNodeGoal: '理解工具调用时机',
    },
    undefined,
    {
      topic: 'Agent',
      focusConceptStates: [
        {
          concept: '工具调用',
          status: 'learning',
          masteryScore: 0.42,
          misconceptionHints: ['容易和工作流编排混淆'],
        },
      ],
      riskConcepts: ['工具调用'],
      recentQuestionSummaries: ['工具调用和工作流编排有什么区别？'],
      analogyHints: ['负责过埋点分析和实验设计'],
      preferredExplanationStyles: ['分步拆解'],
      topicSummary: 'Agent 当前最需要补的是 工具调用',
    },
  );

  assert.match(context, /用户记忆重点/);
  assert.match(context, /工具调用/);
  assert.match(context, /容易和工作流编排混淆/);
  assert.match(context, /偏好解释方式：分步拆解/);
  assert.doesNotMatch(context, /薄弱点：暂无记录/);
});

test('generateConversationSummary preserves questions confusion styles and follow-up', () => {
  const summary = generateConversationSummary([
    { id: '1', role: 'user', content: '工具调用和工作流编排有什么区别？能不能一步一步讲？', timestamp: 1 },
    { id: '2', role: 'assistant', content: '第一步先看目标，第二步看是否需要外部信息。比如查天气就要工具调用。', timestamp: 2 },
    { id: '3', role: 'user', content: '明白工具调用了，但工作流编排还是有点懵，能再举个例子吗？', timestamp: 3 },
  ]);

  assert.equal(summary.mainQuestions?.some((item) => item.includes('工具调用和工作流编排')), true);
  assert.equal(summary.unresolvedConcepts?.some((item) => item.includes('工作流编排')), true);
  assert.equal(summary.preferredExplanationStyles?.includes('分步拆解'), true);
  assert.equal(summary.preferredExplanationStyles?.includes('例子驱动'), true);
  assert.equal(summary.explanationPath, '分步拆解');
  assert.equal(summary.resolutionStatus, 'open');
  assert.equal(summary.followUp?.includes('工作流编排'), true);
});

test('compactChatHistoryMessages summarizes truncated history instead of silently dropping it', () => {
  const longMessages = [
    { id: '1', role: 'user' as const, content: '工具调用和工作流编排到底有什么区别？', timestamp: 1 },
    { id: '2', role: 'assistant' as const, content: '先看是否需要外部信息，再看是否需要多步编排。', timestamp: 2 },
    { id: '3', role: 'user' as const, content: '那 ReAct 和工作流编排又是什么关系？', timestamp: 3 },
    { id: '4', role: 'assistant' as const, content: 'ReAct 更偏单轮推理加动作，工作流是更显式的步骤设计。', timestamp: 4 },
    { id: '5', role: 'user' as const, content: '能不能一步一步再讲一次工具调用？', timestamp: 5 },
    { id: '6', role: 'assistant' as const, content: '第一步判断是否缺少外部信息，第二步再决定是否调用工具。', timestamp: 6 },
  ];

  const result = compactChatHistoryMessages(longMessages, 2, 200);

  assert.equal(result.messages.length, 4);
  assert.equal(result.messages[0].id, '3');
  assert.equal(result.droppedSummary?.summary.includes('工具调用和工作流编排'), true);
});

test.skip('positive chat memory flows into teaching and chat payloads', () => {
  const memory = createDefaultUserMemory();

  memory.extractedInsights.learningPreferences.push({
    kind: 'explanation_style',
    value: '分步拆解',
    confidence: 0.72,
    evidence: '用户说想一步一步讲',
    updatedAt: Date.now(),
  });

  memory.extractedInsights.masteredConcepts.push({
    topic: 'Agent',
    concept: '工具调用',
    evidence: '用户说工具调用已经明白了',
    confidence: 0.68,
    updatedAt: Date.now(),
  });

  const teachingPayload = getTeachingMemoryPayload({
    topic: 'Agent',
    nodeTitle: '工具调用',
    nodeConcepts: ['工具调用'],
    userMemory: memory,
  });
  const chatPayload = getChatMemoryPayload({
    topic: 'Agent',
    currentNodeTitle: '工具调用',
    userMemory: memory,
  });

  assert.equal(teachingPayload.preferredExplanationStyles.includes('分步拆解'), true);
  assert.equal(chatPayload.preferredExplanationStyles.includes('分步拆解'), true);
  assert.equal(chatPayload.focusConceptStates.some((item) => item.concept === '工具调用'), true);
});

test.skip('memory repository reads and writes v2 snapshots without leaking storage details', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };

  const repository = createMemoryRepository({
    storage,
    getProfile: () => ({
      targetJob: 'AI 产品经理',
      workExperience: [],
      education: [],
      insights: {
        knowledgeBackground: ['做过 React 后台项目'],
        analogyExperiences: ['负责过埋点分析和实验设计'],
        summary: '前端和数据分析经验',
      },
    }),
  });

  const storeV2 = repository.getMemoryStore();
  const updated = appendChatSignalsToMemoryStore(storeV2, {
    topic: 'Agent',
    question: '工具调用和工作流编排有什么区别？',
    confusionConcept: '工具调用',
    confusionEvidence: '我还是没懂工具调用和工作流编排有什么区别',
    confidence: 0.74,
  });
  repository.saveMemoryStore(updated);

  const planningPayload = repository.getPlanningPayload('Agent');
  const chatPayload = repository.getChatPayload({
    topic: 'Agent',
    currentNodeTitle: '工具调用',
  });

  assert.equal(repository.getMemoryStore().signals.length >= 2, true);
  assert.equal(planningPayload.transferableBackground.some((item) => item.includes('埋点分析')), true);
  assert.equal(chatPayload.focusConceptStates.some((item) => item.concept === '工具调用'), true);
});

test.skip('aggregator exports stay consistent with hook-facing memory helpers', () => {
  const legacyMemory = createDefaultUserMemory({
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      knowledgeBackground: ['做过 React 后台项目'],
      analogyExperiences: ['负责过埋点分析和实验设计'],
      summary: '前端和数据分析经验',
    },
  });

  const storeFromHook = appendChatSignalsToMemoryStore(migrateUserMemoryToV2(legacyMemory), {
    topic: 'Agent',
    question: '工具调用和工作流编排有什么区别？',
    confusionConcept: '外部工具调用',
    confusionEvidence: '我还是没懂外部工具调用和工作流编排有什么区别',
    confidence: 0.74,
  });
  const storeFromAggregator = appendChatSignalsInAggregator(migrateToV2FromAggregator(legacyMemory), {
    topic: 'Agent',
    question: '工具调用和工作流编排有什么区别？',
    confusionConcept: '外部工具调用',
    confusionEvidence: '我还是没懂外部工具调用和工作流编排有什么区别',
    confidence: 0.74,
  });

  assert.deepEqual(getPlanningMemoryPayload('Agent', storeFromHook), getPlanningPayloadFromAggregator('Agent', storeFromAggregator));
  assert.deepEqual(getTeachingMemoryPayload({
    topic: 'Agent',
    nodeTitle: '工具调用',
    nodeConcepts: ['工具调用'],
    userMemory: storeFromHook,
  }), getTeachingPayloadFromAggregator({
    topic: 'Agent',
    nodeTitle: '工具调用',
    nodeConcepts: ['工具调用'],
    userMemory: storeFromAggregator,
  }));
  assert.deepEqual(getChatMemoryPayload({
    topic: 'Agent',
    currentNodeTitle: '工具调用',
    userMemory: storeFromHook,
  }), getChatPayloadFromAggregator({
    topic: 'Agent',
    currentNodeTitle: '工具调用',
    userMemory: storeFromAggregator,
  }));
});

test('concept alias dictionary covers extendable variants beyond hard-coded regexes', () => {
  assert.equal(Array.isArray(CHAT_CONCEPT_ALIASES['工具调用']), true);
  assert.equal(CHAT_CONCEPT_ALIASES['工具调用'].includes('tool call'), true);
  assert.equal(normalizeConceptKeyFromAggregator('Tool Call'), '工具调用');
  assert.equal(normalizeConceptKeyFromAggregator('调用工具时机'), '工具选择时机');
});

test.skip('memory repository can build payloads from injected server-side memory without localStorage', () => {
  const legacyMemory = createDefaultUserMemory({
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      knowledgeBackground: ['做过 React 后台项目'],
      analogyExperiences: ['负责过埋点分析和实验设计'],
      summary: '前端和数据分析经验',
    },
  });

  recordQuestionAttemptInMemory(legacyMemory, {
    courseId: 'course-agent',
    topic: 'Agent',
    concept: '工具调用',
    question: '什么时候必须调用工具？',
    isCorrect: false,
    difficulty: 2,
    dimension: 'application',
  });

  const repository = createMemoryRepository({
    initialMemory: migrateUserMemoryToV2(legacyMemory),
    getProfile: () => legacyMemory.profile,
  });

  assert.equal(repository.getPlanningPayload('Agent').mustCoverConcepts.includes('工具调用'), true);
  assert.equal(repository.getTeachingPayload({
    topic: 'Agent',
    nodeTitle: '工具调用',
    nodeConcepts: ['工具调用'],
  }).targetConceptStates.some((item) => item.concept === '工具调用'), true);
  assert.equal(repository.getChatPayload({
    topic: 'Agent',
    currentNodeTitle: '工具调用',
  }).focusConceptStates.some((item) => item.concept === '工具调用'), true);
});
