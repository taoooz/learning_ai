import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStreamContent } from '../app/generate/chat/utils/contentParser';
import { parseSSELine } from '../app/generate/chat/utils/sseParser';
import { normalizeVisualization } from '../lib/visualization';

let getCourseTreeLayout: typeof import('../lib/course-tree-layout').getCourseTreeLayout;
let getCourseTreeInitialScrollTop: typeof import('../lib/course-tree-layout').getCourseTreeInitialScrollTop;
let buildChatContext: typeof import('../lib/chat-context').buildChatContext;
let compactChatHistoryMessages: typeof import('../hooks/useChatHistory').compactChatHistoryMessages;
let generateConversationSummary: typeof import('../hooks/useChatHistory').generateConversationSummary;
let createMemoryRepository: typeof import('../lib/memory/repository').createMemoryRepository;
let CHAT_CONCEPT_ALIASES: typeof import('../lib/memory/aggregator').CHAT_CONCEPT_ALIASES;
let detectChatLearningPreferences: typeof import('../lib/memory/aggregator').detectChatLearningPreferences;
let detectExplicitMasteredConcept: typeof import('../lib/memory/aggregator').detectExplicitMasteredConcept;
let normalizeConceptKeyFromAggregator: typeof import('../lib/memory/aggregator').normalizeConceptKey;
let analyzeChatMessageForMemory: typeof import('../hooks/useUserMemory').analyzeChatMessageForMemory;
let getChatMemoryPayload: typeof import('../hooks/useUserMemory').getChatMemoryPayload;
let getPlanningMemoryPayload: typeof import('../hooks/useUserMemory').getPlanningMemoryPayload;
let getTeachingMemoryPayload: typeof import('../hooks/useUserMemory').getTeachingMemoryPayload;
let normalizeConceptKey: typeof import('../hooks/useUserMemory').normalizeConceptKey;
let shouldEnterLearningPhase: typeof import('../contexts/CourseContext').shouldEnterLearningPhase;
let hasResolvedQuestions: typeof import('../contexts/CourseContext').hasResolvedQuestions;
let buildNodeContentPatch: typeof import('../contexts/CourseContext').buildNodeContentPatch;
let buildNodeInfoPayload: typeof import('../contexts/CourseContext').buildNodeInfoPayload;
let buildLearningSteps: typeof import('../contexts/CourseContext').buildLearningSteps;
let getPendingNextNodeIndex: typeof import('../contexts/CourseContext').getPendingNextNodeIndex;

test.before(async () => {
  const layoutModule = await import('../lib/course-tree-layout');
  getCourseTreeLayout = layoutModule.getCourseTreeLayout;
  getCourseTreeInitialScrollTop = layoutModule.getCourseTreeInitialScrollTop;

  const chatContextModule = await import('../lib/chat-context');
  buildChatContext = chatContextModule.buildChatContext;

  const chatHistoryModule = await import('../hooks/useChatHistory');
  compactChatHistoryMessages = chatHistoryModule.compactChatHistoryMessages;
  generateConversationSummary = chatHistoryModule.generateConversationSummary;

  const repositoryModule = await import('../lib/memory/repository');
  createMemoryRepository = repositoryModule.createMemoryRepository;

  const courseContextModule = await import('../contexts/CourseContext');
  shouldEnterLearningPhase = courseContextModule.shouldEnterLearningPhase;
  hasResolvedQuestions = courseContextModule.hasResolvedQuestions;
  buildNodeContentPatch = courseContextModule.buildNodeContentPatch;
  buildNodeInfoPayload = courseContextModule.buildNodeInfoPayload;
  buildLearningSteps = courseContextModule.buildLearningSteps;
  getPendingNextNodeIndex = courseContextModule.getPendingNextNodeIndex;

  const aggregatorModule = await import('../lib/memory/aggregator');
  CHAT_CONCEPT_ALIASES = aggregatorModule.CHAT_CONCEPT_ALIASES;
  detectChatLearningPreferences = aggregatorModule.detectChatLearningPreferences;
  detectExplicitMasteredConcept = aggregatorModule.detectExplicitMasteredConcept;
  normalizeConceptKeyFromAggregator = aggregatorModule.normalizeConceptKey;

  const userMemoryModule = await import('../hooks/useUserMemory');
  analyzeChatMessageForMemory = userMemoryModule.analyzeChatMessageForMemory;
  getChatMemoryPayload = userMemoryModule.getChatMemoryPayload;
  getPlanningMemoryPayload = userMemoryModule.getPlanningMemoryPayload;
  getTeachingMemoryPayload = userMemoryModule.getTeachingMemoryPayload;
  normalizeConceptKey = userMemoryModule.normalizeConceptKey;
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

test('parseStreamContent keeps text, quiz, and outline blocks in original order', () => {
  const blocks = parseStreamContent([
    '先确认一下你的目标。',
    '<quiz id="1">',
    '<div slot="question">你更想先学原理还是实战？</div>',
    '<div slot="option_A">先学原理</div>',
    '<div slot="option_B">先做项目</div>',
    '</quiz>',
    '好的，我会按这个方向继续。',
    '<outline>',
    '<div slot="direction">Agent 入门路径</div>',
    '<div slot="object">两周内建立完整认知</div>',
    '<div slot="level">初级</div>',
    '</outline>',
  ].join(''));

  assert.deepEqual(
    blocks.map((block) => block.type),
    ['text', 'question', 'text', 'outline'],
  );

  assert.equal(blocks[0]?.type, 'text');
  assert.equal(blocks[0]?.type === 'text' ? blocks[0].content : '', '先确认一下你的目标。');

  assert.equal(blocks[1]?.type, 'question');
  if (blocks[1]?.type === 'question') {
    assert.equal(blocks[1].question, '你更想先学原理还是实战？');
    assert.deepEqual(blocks[1].options, {
      A: '先学原理',
      B: '先做项目',
    });
    assert.equal(blocks[1].complete, true);
  }

  assert.equal(blocks[2]?.type, 'text');
  assert.equal(blocks[2]?.type === 'text' ? blocks[2].content : '', '好的，我会按这个方向继续。');

  assert.equal(blocks[3]?.type, 'outline');
  if (blocks[3]?.type === 'outline') {
    assert.equal(blocks[3].learningDirection, 'Agent 入门路径');
    assert.equal(blocks[3].learningGoal, '两周内建立完整认知');
    assert.equal(blocks[3].estimatedLevel, 'beginner');
    assert.equal(blocks[3].complete, true);
  }
});

test('parseStreamContent yields incomplete quiz block as soon as opening tag appears', () => {
  const blocks = parseStreamContent([
    '我先问你一个问题：',
    '<quiz id="2">',
    '<div slot="question">你现在最卡的是',
    '</div>',
    '<div slot="option_A">概念太多记不住</div>',
    '<div slot="option_B">知道概念但不会用',
  ].join(''));

  assert.deepEqual(
    blocks.map((block) => block.type),
    ['text', 'question'],
  );

  assert.equal(blocks[1]?.type, 'question');
  if (blocks[1]?.type === 'question') {
    assert.equal(blocks[1].question, '你现在最卡的是');
    assert.deepEqual(blocks[1].options, {
      A: '概念太多记不住',
      B: '知道概念但不会用',
    });
    assert.equal(blocks[1].complete, false);
  }
});

test('parseSSELine ignores done sentinel without warning noise', () => {
  assert.equal(parseSSELine('data: [DONE]'), null);
  assert.equal(parseSSELine('[DONE]'), null);
});

test('shouldEnterLearningPhase starts once cards are ready even if questions are still empty', () => {
  assert.equal(shouldEnterLearningPhase({ cards: [{ id: 'card-1', title: '标题', content: '内容', coveredConceptIds: [] }], questions: [] }), true);
  assert.equal(shouldEnterLearningPhase({ cards: [{ id: 'card-1', title: '标题', content: '内容', coveredConceptIds: [] }] }), true);
  assert.equal(shouldEnterLearningPhase({ cards: [], questions: [] }), false);
  assert.equal(shouldEnterLearningPhase({ questions: [] }), false);
});

test('hasResolvedQuestions treats an existing questions array as resolved even when empty', () => {
  assert.equal(hasResolvedQuestions({ questions: [] }), true);
  assert.equal(hasResolvedQuestions({ questions: [{ id: 'q-1', type: 'single', question: '问题', options: ['A. 选项'], answer: 'A', explanation: '解释', difficulty: 1, dimension: 'understanding', targetConceptId: 'concept-1' }] }), true);
  assert.equal(hasResolvedQuestions({}), false);
});

test('buildLearningSteps allows learning with cards before questions are generated', () => {
  const steps = buildLearningSteps(
    [{ id: 'card-1', title: '标题', content: '内容' }],
    undefined,
  );

  assert.equal(steps.length, 1);
  assert.equal(steps[0]?.type, 'card');
});

test('getPendingNextNodeIndex only targets the immediate next node instead of skipping ahead', () => {
  assert.equal(
    getPendingNextNodeIndex(
      [
        { cards: [{ id: 'card-0' }] },
        { cards: [{ id: 'card-1' }] },
        {},
      ],
      0,
    ),
    null,
  );

  assert.equal(
    getPendingNextNodeIndex(
      [
        { cards: [{ id: 'card-0' }] },
        {},
        {},
      ],
      0,
    ),
    1,
  );
});

test('buildNodeContentPatch preserves cards and falls back to empty questions when generation fails', () => {
  const patch = buildNodeContentPatch({
    courseId: 'course-1',
    nodeIndex: 2,
    cards: [{ id: 'card-1', title: '什么是 Agent', content: 'Agent 是围绕目标行动的系统。', coveredConceptIds: [] }],
  });

  assert.equal(patch.courseId, 'course-1');
  assert.equal(patch.nodeIndex, 2);
  assert.equal(patch.cards.length, 1);
  assert.deepEqual(patch.questions, []);
});

test('buildNodeInfoPayload includes course and adjacent node context for generation', () => {
  const payload = buildNodeInfoPayload({
    blueprint: {
      courseId: 'course-1',
      topic: 'Agent 入门课',
      learnerPositioning: {
        estimatedLevel: 'beginner',
      },
      courseGoal: '理解 Agent 的基本结构',
      globalConcepts: [],
      nodes: [
        {
          index: 0,
          title: '什么是 Agent',
          teachingGoal: '建立整体概念',
          teachConceptIds: ['agent'],
          prerequisiteConceptIds: [],
          bridgeFromPreviousNode: '',
          status: 'available',
        },
        {
          index: 1,
          title: '工具调用',
          teachingGoal: '理解工具调用边界',
          teachConceptIds: ['tool-calling'],
          prerequisiteConceptIds: ['agent'],
          bridgeFromPreviousNode: '',
          status: 'locked',
        },
        {
          index: 2,
          title: '工作流编排',
          teachingGoal: '理解工作流的多步性',
          teachConceptIds: ['workflow'],
          prerequisiteConceptIds: ['tool-calling'],
          bridgeFromPreviousNode: '',
          status: 'locked',
        },
      ],
    },
    treeView: {} as never,
    lessons: {},
  }, 1);

  assert.equal(payload.courseName, 'Agent 入门课');
  assert.equal(payload.courseDescription, '理解 Agent 的基本结构');
  assert.equal(payload.backgroundSummary, undefined);
  assert.equal(payload.prevNode?.title, '什么是 Agent');
  assert.equal(payload.nextNode?.title, '工作流编排');
});

test('normalizeVisualization supports legacy aliases and nested data payload', () => {
  const visualization = normalizeVisualization({
    type: 'key_points',
    data: {
      title: '核心要点',
      points: ['先判断目标', '再决定是否调用工具'],
    },
  });

  assert.equal(visualization?.type, 'keyPoints');
  assert.equal(visualization?.title, '核心要点');
  assert.deepEqual(visualization?.items, ['先判断目标', '再决定是否调用工具']);
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

// V1/V2 API 相关测试已移除，新的 V3 + Memory Agent 测试在 course-blueprint-memory-v3.test.ts

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

test('normalizeConceptKey collapses close variants into one canonical concept', () => {
  assert.equal(normalizeConceptKey('外部工具调用'), normalizeConceptKey('工具调用'));
  assert.equal(normalizeConceptKey('工作流编排'), normalizeConceptKey('workflow 编排'));
});

test('buildChatContext prefers structured v2 payload over legacy chat memory noise', () => {
  const context = buildChatContext(
    {
      topic: 'Agent',
      difficultySummary: '适合初学者',
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

test('concept alias dictionary covers extendable variants beyond hard-coded regexes', () => {
  assert.equal(Array.isArray(CHAT_CONCEPT_ALIASES['工具调用']), true);
  assert.equal(CHAT_CONCEPT_ALIASES['工具调用'].includes('tool call'), true);
  assert.equal(normalizeConceptKeyFromAggregator('Tool Call'), '工具调用');
  assert.equal(normalizeConceptKeyFromAggregator('调用工具时机'), '工具选择时机');
});

