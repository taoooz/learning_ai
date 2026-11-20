import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStreamContent } from '../app/generate/chat/utils/contentParser';
import { parseSSELine } from '../app/generate/chat/utils/sseParser';

let getCourseTreeLayout: typeof import('../lib/course-tree-layout').getCourseTreeLayout;
let getCourseTreeInitialScrollTop: typeof import('../lib/course-tree-layout').getCourseTreeInitialScrollTop;
let compactChatHistoryMessages: typeof import('../hooks/useChatHistory').compactChatHistoryMessages;
let generateConversationSummary: typeof import('../hooks/useChatHistory').generateConversationSummary;

test.before(async () => {
  const layoutModule = await import('../lib/course-tree-layout');
  getCourseTreeLayout = layoutModule.getCourseTreeLayout;
  getCourseTreeInitialScrollTop = layoutModule.getCourseTreeInitialScrollTop;

  const chatHistoryModule = await import('../hooks/useChatHistory');
  compactChatHistoryMessages = chatHistoryModule.compactChatHistoryMessages;
  generateConversationSummary = chatHistoryModule.generateConversationSummary;

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
