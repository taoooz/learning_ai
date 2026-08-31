// tests/learning-v2-tutor-protocol.test.ts
// V2 流内答疑（Tutor）协议测试：幂等键、事件类型、问题/回答归约与版本守卫（P2 Task 1/Task 2）
// Task 4：Next 薄透传路由的鉴权与必填字段校验
// Task 6：双流编排（编排层纯决策 + 最小 harness 锁定行为契约）
// Task 7：UI 文案辅助函数（占位文案区分流中排队与边界提问）

import test from 'node:test';
import assert from 'node:assert/strict';

import { POST } from '../app/api/learning/v2/tutor/stream/route';
import { tutorPlaceholder } from '../components/learning-v2/InlineTutorInput';
import { tutorQueuedHint } from '../components/learning-v2/LearningStreamV2';
import { createChapterLearningHarness } from './helpers/tutor-harness';
import {
  canRetryTutorQuestion,
  decideTutorSubmission,
  pickAutoTutorQuestion,
} from '../lib/learning-v2/tutor-orchestration';
import {
  buildTutorQuestionIdempotencyKey,
  buildTutorRequestIdempotencyKey,
} from '../lib/learning-v2/idempotency';
import {
  createInitialNodeLessonV2,
  applyLearningSseEvent,
  applyTutorSseEvent,
  appendUserQuestion,
  userQuestionItemId,
  tutorAnswerItemId,
} from '../lib/learning-v2/reducers';
import type { LearningSseEvent } from '../types/learning-v2/events';
import type {
  ChapterPlan,
  GenerationMeta,
  NodeLessonV2,
  TutorAnswerItem,
  UserQuestionItem,
} from '../types/learning-v2';

// ---- 测试基座 ----

const META: GenerationMeta = { promptVersion: 'p1', modelVersion: 'm1', generatedAt: 1000 };

const QUESTION_INPUT = {
  taskId: 'task-1',
  questionId: 'q-1',
  text: '为什么这里要用 ETag？',
};

function makePlan(): ChapterPlan {
  return {
    chapterId: 'ch-1',
    planId: 'plan-1',
    // 计划版本固定为 2：planVersion 1 的事件在守卫测试中作为过期版本
    planVersion: 2,
    objectiveIds: ['obj-1'],
    tasks: [
      {
        taskId: 'task-1',
        order: 0,
        title: '认识缓存',
        objectiveId: 'obj-1',
        taskGoal: '理解 ETag 协商缓存',
        observableOutcome: '能解释 ETag 的校验原理',
        conceptKeys: ['ETag'],
        prerequisiteTaskIds: [],
        teachingPattern: 'explain',
        expectedMinutes: 5,
        evidencePolicy: 'none',
        origin: 'initial',
        status: 'planned',
      },
    ],
    status: 'active',
    createdAt: 1000,
    updatedAt: 1000,
    generationMeta: META,
  };
}

const baseLesson: NodeLessonV2 = createInitialNodeLessonV2('ch-1', makePlan(), 1000);

const baseWithQuestion: NodeLessonV2 = appendUserQuestion(baseLesson, QUESTION_INPUT, 1001);

function makeTutorEvent(overrides: Partial<LearningSseEvent>): LearningSseEvent {
  return {
    eventId: 'evt-tutor',
    requestId: 'req-tutor-1',
    type: 'tutor_started',
    courseId: 'course-1',
    chapterId: 'ch-1',
    taskId: 'task-1',
    questionId: 'q-1',
    planVersion: 2,
    sequence: 1,
    timestamp: 2000,
    payload: {},
    ...overrides,
  };
}

const tutorStartedEvent = makeTutorEvent({
  eventId: 'evt-tutor-started',
  type: 'tutor_started',
  payload: { questionId: 'q-1' },
});

let deltaEventCounter = 0;

function tutorDeltaEvent(delta: string, overrides: Partial<LearningSseEvent> = {}): LearningSseEvent {
  deltaEventCounter += 1;
  return makeTutorEvent({
    eventId: `evt-tutor-delta-${deltaEventCounter}`,
    type: 'tutor_block_delta',
    sequence: 2,
    timestamp: 2100,
    payload: { blockId: 'tb-1', delta },
    ...overrides,
  });
}

const tutorBlockStartedEvent = makeTutorEvent({
  eventId: 'evt-tutor-block-started',
  type: 'tutor_block_started',
  sequence: 2,
  timestamp: 2050,
  payload: { blockId: 'tb-1' },
});

const tutorBlockCompletedEvent = makeTutorEvent({
  eventId: 'evt-tutor-block-completed',
  type: 'tutor_block_completed',
  sequence: 4,
  timestamp: 2200,
  payload: { block: { type: 'markdown', blockId: 'tb-1', markdown: '定稿的块内容' } },
});

const tutorCompletedEvent = makeTutorEvent({
  eventId: 'evt-tutor-completed',
  type: 'tutor_completed',
  sequence: 5,
  timestamp: 2300,
  payload: {
    questionId: 'q-1',
    blocks: [{ type: 'markdown', blockId: 'tb-1', markdown: '定稿的完整回答' }],
  },
});

const tutorErrorEvent = makeTutorEvent({
  eventId: 'evt-tutor-error',
  type: 'request_error',
  sequence: 9,
  timestamp: 3000,
  payload: { code: 'E_LLM', message: '回答生成失败，请稍后重试', retryable: true },
});

function findQuestion(lesson: NodeLessonV2): UserQuestionItem | undefined {
  return lesson.streamItems.find((item) => item.type === 'user_question');
}

function findAnswer(lesson: NodeLessonV2): TutorAnswerItem | undefined {
  return lesson.streamItems.find((item) => item.type === 'tutor_answer');
}

// ---- Task 1：幂等键与事件类型 ----

test('问题和回答使用稳定且不同的幂等键', () => {
  assert.equal(buildTutorQuestionIdempotencyKey('ch-1', 'task-1', 'q-1'), 'uq:ch-1:task-1:q-1');
  assert.equal(buildTutorRequestIdempotencyKey('ch-1', 2, 'task-1', 'q-1'), 'tutor:ch-1:v2:task-1:q-1');
  assert.notEqual(
    buildTutorQuestionIdempotencyKey('ch-1', 'task-1', 'q-1'),
    buildTutorRequestIdempotencyKey('ch-1', 2, 'task-1', 'q-1'),
  );
});

test('Tutor 事件类型覆盖开始、块增量、完成和通用错误', () => {
  const event: LearningSseEvent = {
    eventId: 'evt-1', requestId: 'req-1', type: 'tutor_block_delta',
    courseId: 'course-1', chapterId: 'ch-1', taskId: 'task-1', questionId: 'q-1',
    planVersion: 2, sequence: 3, timestamp: 1,
    payload: { blockId: 'block-1', delta: '缓存命中' },
  };
  assert.equal(event.type, 'tutor_block_delta');
});

// ---- Task 2：简报规定测试 ----

test('问题提交立即入流且重复 questionId 不重复', () => {
  const first = appendUserQuestion(baseLesson, {
    taskId: 'task-1', questionId: 'q-1', text: '为什么这里要用 ETag？',
  }, 10);
  const second = appendUserQuestion(first, {
    taskId: 'task-1', questionId: 'q-1', text: '为什么这里要用 ETag？',
  }, 11);
  assert.equal(first.streamItems.filter(i => i.type === 'user_question').length, 1);
  assert.deepEqual(second, first);
});

test('Tutor delta 只写入匹配版本和请求的问题', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const delta = applyTutorSseEvent(started, tutorDeltaEvent('命中缓存'));
  const stale = applyTutorSseEvent(delta, { ...tutorDeltaEvent('旧回答'), planVersion: 1 });
  const answer = stale.streamItems.find(i => i.type === 'tutor_answer');
  assert.equal(answer?.type, 'tutor_answer');
  assert.equal(answer?.blocks[0]?.markdown, '命中缓存');
});

test('重复 Tutor 完成事件不漂移 sequence，错误保留问题', () => {
  const failed = applyTutorSseEvent(baseWithQuestion, tutorErrorEvent);
  const repeated = applyTutorSseEvent(failed, tutorErrorEvent);
  assert.equal(repeated.streamItems.length, failed.streamItems.length);
  assert.equal(repeated.streamItems.some(i => i.type === 'user_question'), true);
  assert.equal(repeated.streamItems.some(i => i.type === 'system_notice'), true);
});

// ---- Task 2：问题入流 ----

test('问题入流分配下一个 sequence 并更新滚动锚点与活跃时间', () => {
  const lesson = appendUserQuestion(baseLesson, QUESTION_INPUT, 1500);
  const question = findQuestion(lesson);
  assert.ok(question, '问题条目应立即入流');
  assert.equal(question.itemId, userQuestionItemId('q-1'));
  assert.equal(question.sequence, baseLesson.runtime.latestSequence + 1);
  assert.equal(question.status, 'pending');
  assert.equal(question.planVersion, 2);
  assert.equal(lesson.runtime.latestSequence, question.sequence);
  assert.equal(lesson.runtime.scrollAnchorItemId, userQuestionItemId('q-1'));
  assert.equal(lesson.runtime.lastActiveAt, 1500);
  assert.equal(lesson.updatedAt, 1500);
});

// ---- Task 2：守卫 ----

test('版本、章节、任务、问题不匹配的 Tutor 事件一律拒写', () => {
  assert.equal(applyTutorSseEvent(baseWithQuestion, { ...tutorStartedEvent, planVersion: 1 }), baseWithQuestion);
  assert.equal(applyTutorSseEvent(baseWithQuestion, { ...tutorStartedEvent, chapterId: 'ch-other' }), baseWithQuestion);
  assert.equal(applyTutorSseEvent(baseWithQuestion, { ...tutorStartedEvent, taskId: 'task-2' }), baseWithQuestion);
  assert.equal(applyTutorSseEvent(baseWithQuestion, { ...tutorStartedEvent, questionId: 'q-unknown' }), baseWithQuestion);
  assert.equal(applyTutorSseEvent(baseWithQuestion, { ...tutorStartedEvent, questionId: undefined }), baseWithQuestion);
  assert.equal(applyTutorSseEvent(baseWithQuestion, { ...tutorStartedEvent, taskId: undefined }), baseWithQuestion);
});

test('tutor_started 的载荷 questionId 与外壳不一致时拒写', () => {
  const forged = makeTutorEvent({
    eventId: 'evt-tutor-started-forged',
    type: 'tutor_started',
    payload: { questionId: 'q-other' },
  });
  assert.equal(applyTutorSseEvent(baseWithQuestion, forged), baseWithQuestion);
});

test('进行中的 Tutor 请求在位时，过期 requestId 的事件拒写', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  assert.equal(started.runtime.pendingRequest?.requestId, 'req-tutor-1');
  const staleDelta = tutorDeltaEvent('过期增量', { requestId: 'req-stale' });
  assert.equal(applyTutorSseEvent(started, staleDelta), started);
});

test('在途同 requestId 的 tutor_started 重投幂等，不清空已累积块', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const withBlock = applyTutorSseEvent(started, tutorBlockStartedEvent);
  const partial = applyTutorSseEvent(withBlock, tutorDeltaEvent('已累积内容'));
  assert.equal(findAnswer(partial)?.blocks[0]?.markdown, '已累积内容');

  // 同一事件重投：重复应用必须得到相同状态，不得清空在途内容
  const replayed = applyTutorSseEvent(partial, tutorStartedEvent);
  const answer = findAnswer(replayed);
  assert.ok(answer);
  assert.equal(answer.status, 'streaming');
  assert.equal(answer.blocks[0]?.markdown, '已累积内容', '重投不得清空已累积块');
  assert.equal(replayed.runtime.pendingRequest?.requestId, 'req-tutor-1');
  assert.equal(replayed.runtime.pendingRequest?.attempt, started.runtime.pendingRequest?.attempt, '重投不得增加 attempt');
  assert.deepEqual(replayed, partial);
});

test('旧 requestId 迟到的 tutor_started 拒写，不劫持在途新请求', () => {
  const newStarted = applyTutorSseEvent(
    baseWithQuestion,
    makeTutorEvent({
      eventId: 'evt-tutor-started-new',
      requestId: 'req-new',
      type: 'tutor_started',
      sequence: 20,
      timestamp: 5000,
      payload: { questionId: 'q-1' },
    }),
  );
  const partial = applyTutorSseEvent(
    newStarted,
    tutorDeltaEvent('新回答进行中', { requestId: 'req-new', sequence: 21 }),
  );
  assert.equal(findAnswer(partial)?.blocks[0]?.markdown, '新回答进行中');

  // 旧请求迟到的 started：拒写，不得清空在途内容、不得劫持 pendingRequest
  const staleStarted = makeTutorEvent({
    eventId: 'evt-tutor-started-stale',
    requestId: 'req-old',
    type: 'tutor_started',
    sequence: 22,
    timestamp: 5100,
    payload: { questionId: 'q-1' },
  });
  const afterStale = applyTutorSseEvent(partial, staleStarted);
  assert.equal(afterStale, partial, '旧 requestId 迟到的 started 应拒写');
  assert.equal(afterStale.runtime.pendingRequest?.requestId, 'req-new', 'pendingRequest 不得被劫持');
  assert.equal(afterStale.runtime.pendingRequest?.attempt, newStarted.runtime.pendingRequest?.attempt);
  assert.equal(findAnswer(afterStale)?.blocks[0]?.markdown, '新回答进行中', '不得清空在途回答内容');

  // 劫持被拒后，新请求的合法 delta 仍可正常写入
  const continued = applyTutorSseEvent(
    afterStale,
    tutorDeltaEvent('继续', { requestId: 'req-new', sequence: 23 }),
  );
  assert.equal(findAnswer(continued)?.blocks[0]?.markdown, '新回答进行中继续');
});

// ---- Task 2：回答流 ----

test('tutor_started 创建流式回答并记录 tutor pendingRequest', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const answer = findAnswer(started);
  assert.ok(answer, '回答条目应随 tutor_started 创建');
  assert.equal(answer.itemId, tutorAnswerItemId('q-1'));
  assert.equal(answer.status, 'streaming');
  assert.deepEqual(answer.blocks, []);
  // 回答排序必须晚于问题（sequence 锚定客户端最新序号，避免服务端按请求重新计数造成乱序）
  const question = findQuestion(started);
  assert.ok(question && answer.sequence > question.sequence);
  assert.equal(started.runtime.pendingRequest?.kind, 'tutor');
  assert.equal(started.runtime.pendingRequest?.requestId, 'req-tutor-1');
  assert.equal(started.runtime.pendingRequest?.status, 'streaming');
});

test('tutor_block_started 创建占位块且重复事件幂等', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const once = applyTutorSseEvent(started, tutorBlockStartedEvent);
  const twice = applyTutorSseEvent(once, tutorBlockStartedEvent);
  const answer = findAnswer(twice);
  assert.ok(answer);
  assert.equal(answer.blocks.length, 1);
  assert.equal(answer.blocks[0].blockId, 'tb-1');
  assert.equal(answer.blocks[0].markdown, '');
});

test('Tutor delta 按 blockId 累积，已有块后不匹配的游离块丢弃', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const withBlock = applyTutorSseEvent(started, tutorBlockStartedEvent);
  const first = applyTutorSseEvent(withBlock, tutorDeltaEvent('你好，'));
  const second = applyTutorSseEvent(first, tutorDeltaEvent('世界'));
  const answer = findAnswer(second);
  assert.ok(answer);
  assert.equal(answer.blocks[0].markdown, '你好，世界');

  // 已有块确定后，指向未知 blockId 的增量丢弃，不产生游离块
  const stray = applyTutorSseEvent(
    second,
    tutorDeltaEvent('游离增量', { sequence: 8, payload: { blockId: 'tb-2', delta: '游离增量' } }),
  );
  const strayAnswer = findAnswer(stray);
  assert.ok(strayAnswer);
  assert.equal(strayAnswer.blocks.length, 1, '不得创建不匹配的游离块');
  assert.equal(strayAnswer.blocks[0].markdown, '你好，世界');
});

test('Tutor delta 中文任意切分不乱码（代理对跨增量边界）', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const emoji = '💡';
  const firstHalf = emoji.slice(0, 1); // 高代理位
  const secondHalf = emoji.slice(1); // 低代理位
  const part1 = applyTutorSseEvent(started, tutorDeltaEvent(`缓存${firstHalf}`));
  const part2 = applyTutorSseEvent(part1, tutorDeltaEvent(`${secondHalf}命中`));
  const answer = findAnswer(part2);
  assert.ok(answer);
  assert.equal(answer.blocks[0].markdown, '缓存💡命中');
});

test('tutor_block_completed 用定稿块替换占位块', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const withBlock = applyTutorSseEvent(started, tutorBlockStartedEvent);
  const partial = applyTutorSseEvent(withBlock, tutorDeltaEvent('半截'));
  const completed = applyTutorSseEvent(partial, tutorBlockCompletedEvent);
  const answer = findAnswer(completed);
  assert.ok(answer);
  assert.equal(answer.blocks.length, 1);
  assert.equal(answer.blocks[0].markdown, '定稿的块内容');
});

test('tutor_completed 定稿回答、完成问题，重复应用不漂移', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const once = applyTutorSseEvent(started, tutorCompletedEvent);

  const answer = findAnswer(once);
  const question = findQuestion(once);
  assert.ok(answer && question);
  assert.equal(answer.status, 'complete');
  assert.equal(answer.blocks[0].markdown, '定稿的完整回答');
  assert.equal(question.status, 'complete');
  assert.equal(once.runtime.pendingRequest, undefined, '完成后应清理对应请求记录');

  const twice = applyTutorSseEvent(once, tutorCompletedEvent);
  assert.equal(twice.runtime.latestSequence, once.runtime.latestSequence, 'sequence 不得漂移');
  assert.equal(twice.streamItems.length, once.streamItems.length, '不得产生重复条目');
  assert.deepEqual(twice, once);
});

// ---- Task 2：错误路径 ----

test('request_error 将回答标记失败并保留问题与已流式内容', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const partial = applyTutorSseEvent(started, tutorDeltaEvent('半截内容'));
  const failed = applyTutorSseEvent(partial, tutorErrorEvent);

  const answer = findAnswer(failed);
  const question = findQuestion(failed);
  assert.ok(answer && question);
  assert.equal(answer.status, 'failed');
  assert.equal(answer.errorMessage, '回答生成失败，请稍后重试');
  assert.equal(answer.blocks[0].markdown, '半截内容', '失败时保留已流式内容');
  assert.equal(question.status, 'failed');
  assert.equal(failed.runtime.currentTaskStatus, baseWithQuestion.runtime.currentTaskStatus, 'Tutor 失败不影响主线任务状态');

  const notice = failed.streamItems.find((item) => item.type === 'system_notice');
  assert.ok(notice && notice.type === 'system_notice');
  assert.equal(notice.tone, 'error');
  assert.equal(notice.code, 'E_LLM');
  assert.equal(failed.runtime.pendingRequest?.status, 'failed');

  // 重复错误事件幂等：通知按 eventId 确定性 upsert，条目数与序号均不漂移
  const repeated = applyTutorSseEvent(failed, tutorErrorEvent);
  assert.equal(repeated.streamItems.length, failed.streamItems.length);
  assert.equal(repeated.runtime.latestSequence, failed.runtime.latestSequence);
});

test('Tutor 失败后重试清空半截块，旧请求的迟到增量拒写', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  const partial = applyTutorSseEvent(started, tutorDeltaEvent('旧半截'));
  const failed = applyTutorSseEvent(partial, tutorErrorEvent);

  const retryStarted = applyTutorSseEvent(
    failed,
    makeTutorEvent({
      eventId: 'evt-tutor-started-retry',
      requestId: 'req-tutor-2',
      type: 'tutor_started',
      sequence: 12,
      timestamp: 4000,
      payload: { questionId: 'q-1' },
    }),
  );
  const answer = findAnswer(retryStarted);
  assert.ok(answer);
  assert.equal(answer.status, 'streaming');
  assert.deepEqual(answer.blocks, [], '重试不得拼接半截旧内容');
  assert.equal(retryStarted.runtime.pendingRequest?.requestId, 'req-tutor-2');
  assert.equal(retryStarted.runtime.pendingRequest?.attempt, 2);

  const freshDelta = applyTutorSseEvent(
    retryStarted,
    tutorDeltaEvent('全新内容', { requestId: 'req-tutor-2', sequence: 13 }),
  );
  assert.equal(findAnswer(freshDelta)?.blocks[0].markdown, '全新内容');

  // 旧请求的迟到增量被 requestId 守卫拒写
  const staleDelta = tutorDeltaEvent('旧请求残留', { requestId: 'req-tutor-1', sequence: 14 });
  assert.equal(applyTutorSseEvent(freshDelta, staleDelta), freshDelta);
});

// ---- Task 2：主入口路由 ----

test('applyLearningSseEvent 对 Tutor 事件与 Tutor 错误的归约与专用入口一致', () => {
  assert.deepEqual(
    applyLearningSseEvent(baseWithQuestion, tutorStartedEvent),
    applyTutorSseEvent(baseWithQuestion, tutorStartedEvent),
  );
  const viaMain = applyLearningSseEvent(baseWithQuestion, tutorErrorEvent);
  assert.deepEqual(viaMain, applyTutorSseEvent(baseWithQuestion, tutorErrorEvent));
  // 带 questionId 的 request_error 走 Tutor 路径，不得把当前任务标记失败
  assert.equal(viaMain.runtime.currentTaskStatus, baseWithQuestion.runtime.currentTaskStatus);
});

test('request_completed 清理 Tutor pendingRequest', () => {
  const started = applyTutorSseEvent(baseWithQuestion, tutorStartedEvent);
  assert.ok(started.runtime.pendingRequest);
  const wrappedUp = applyLearningSseEvent(
    started,
    makeTutorEvent({
      eventId: 'evt-tutor-request-completed',
      type: 'request_completed',
      sequence: 10,
      timestamp: 2900,
      payload: { requestId: 'req-tutor-1' },
    }),
  );
  assert.equal(wrappedUp.runtime.pendingRequest, undefined);
});

// ---- Task 4：Next 薄透传路由（鉴权与必填字段校验） ----

// 与 python-agent/schemas/tutor.py InlineTutorRequest 对齐的合法请求体
const validTutorBody = {
  mode: 'inline_tutor',
  courseTopic: 'HTTP 缓存',
  chapter: { title: '验证策略', teachingGoal: '理解强缓存和协商缓存' },
  task: { taskId: 'task-1', title: 'ETag', taskDescription: '理解条件请求' },
  visibleContent: 'ETag 可以理解为资源的版本指纹。',
  recentInlineQA: [],
  question: { questionId: 'q-1', text: '304 为什么没有正文？' },
  idempotencyKey: 'tutor:ch-1:v1:task-1:q-1',
};

test('V2 Tutor 代理拒绝无认证请求', async () => {
  const response = await POST(new Request('http://localhost/api/learning/v2/tutor/stream', {
    method: 'POST', body: JSON.stringify(validTutorBody),
  }) as never);
  assert.equal(response.status, 401);
});

test('V2 Tutor 代理缺少必填字段返回 422 且不触达上游', async () => {
  const authedInit = { headers: { cookie: 'ai-learning-auth=abcd-1234-ef56' } };
  const missingKey = await POST(new Request('http://localhost/api/learning/v2/tutor/stream', {
    method: 'POST', body: JSON.stringify({ ...validTutorBody, idempotencyKey: undefined }), ...authedInit,
  }) as never);
  assert.equal(missingKey.status, 422);

  const missingQuestion = await POST(new Request('http://localhost/api/learning/v2/tutor/stream', {
    method: 'POST', body: JSON.stringify({ ...validTutorBody, question: undefined }), ...authedInit,
  }) as never);
  assert.equal(missingQuestion.status, 422);

  const invalidJson = await POST(new Request('http://localhost/api/learning/v2/tutor/stream', {
    method: 'POST', body: '不是 JSON', ...authedInit,
  }) as never);
  assert.equal(invalidJson.status, 422);
});

// ---- Task 6：双流编排决策（纯函数） ----

test('提交决策：流中入队、边界且空闲立即启动、忙碌时入队', () => {
  // 基于无问题条目的容器构造边界态，避免既有夹具问题干扰断言
  const atBoundary: NodeLessonV2 = { ...baseLesson, runtime: { ...baseLesson.runtime, status: 'awaiting_user' as const, currentTaskId: 'task-1', currentTaskStatus: 'awaiting_user' as const } };
  const start = decideTutorSubmission({ lesson: atBoundary, phase: 'boundary', isTutorBusy: false, text: '  为什么 304 没有正文？  ', questionId: 'q-s1', now: 5000 });
  assert.ok(start);
  assert.equal(start.action, 'start');
  assert.equal(start.taskId, 'task-1');
  const question = start.lesson.streamItems.find((i) => i.type === 'user_question');
  assert.equal(question?.type === 'user_question' && question.text, '为什么 304 没有正文？', '问题文本取 trim 后的值');

  const queuedDuringStream = decideTutorSubmission({ lesson: atBoundary, phase: 'streaming', isTutorBusy: false, text: '问题', questionId: 'q-s2', now: 5001 });
  assert.equal(queuedDuringStream?.action, 'queue');

  const queuedWhenBusy = decideTutorSubmission({ lesson: atBoundary, phase: 'boundary', isTutorBusy: true, text: '问题', questionId: 'q-s3', now: 5002 });
  assert.equal(queuedWhenBusy?.action, 'queue');

  assert.equal(decideTutorSubmission({ lesson: atBoundary, phase: 'boundary', isTutorBusy: false, text: '   ', questionId: 'q-s4', now: 5003 }), null, '空白问题拒收');
});

test('提交决策：相位白名单自防御，非学习相位一律拒收', () => {
  // 容器有当前任务、文本非空——若编排层不做相位守卫，这些提交都会被受理。
  // UI 门控之外的自防御：收尾/完成/失败相位不得受理提问（最终审查修复 3）
  const withTask: NodeLessonV2 = { ...baseLesson, runtime: { ...baseLesson.runtime, currentTaskId: 'task-1' } };
  for (const phase of ['planning', 'completing', 'completed', 'plan_failed'] as const) {
    assert.equal(
      decideTutorSubmission({ lesson: withTask, phase, isTutorBusy: false, text: '为什么 304 没有正文？', questionId: `q-p-${phase}`, now: 6000 }),
      null,
      `${phase} 相位应拒收提问`,
    );
  }
  // 白名单内的相位仍正常受理（边界空闲启动、生成中入队）
  const started = decideTutorSubmission({ lesson: withTask, phase: 'boundary', isTutorBusy: false, text: '问题', questionId: 'q-p-ok1', now: 6001 });
  assert.equal(started?.action, 'start');
  const queued = decideTutorSubmission({ lesson: withTask, phase: 'generating', isTutorBusy: false, text: '问题', questionId: 'q-p-ok2', now: 6002 });
  assert.equal(queued?.action, 'queue');
});

test('自动派发只取自动窗口内最早一题；忙碌时不派发', () => {
  let lesson = baseLesson;
  lesson = { ...lesson, runtime: { ...lesson.runtime, currentTaskId: 'task-1' } };
  lesson = appendUserQuestion(lesson, { taskId: 'task-1', questionId: 'q-a', text: '甲' }, 1);
  lesson = appendUserQuestion(lesson, { taskId: 'task-1', questionId: 'q-b', text: '乙' }, 2);
  assert.equal(pickAutoTutorQuestion(lesson, false)?.questionId, 'q-a');
  assert.equal(pickAutoTutorQuestion(lesson, true), undefined);
});

test('重试决策：仅失败问题可重试，排队/完成问题不接受重试', () => {
  const failed = applyTutorSseEvent(baseWithQuestion, tutorErrorEvent);
  assert.equal(canRetryTutorQuestion(failed, 'q-1')?.questionId, 'q-1');
  assert.equal(canRetryTutorQuestion(failed, 'q-missing'), undefined);
  const completed = applyTutorSseEvent(applyTutorSseEvent(baseWithQuestion, tutorStartedEvent), tutorCompletedEvent);
  assert.equal(canRetryTutorQuestion(completed, 'q-1'), undefined);
});

// ---- Task 6：双流编排行为契约（最小 harness） ----

test('流中提问不取消主任务流，任务完成后自动回答', async () => {
  const harness = createChapterLearningHarness({ phase: 'streaming' });
  harness.submitTutorQuestion('为什么 ETag 能减少正文传输？');
  assert.equal(harness.taskAbortCount, 0, '主任务流取消入口不得被触碰');
  assert.equal(harness.lesson.streamItems.some((i) => i.type === 'user_question'), true);
  assert.equal(harness.phase, 'streaming', '主任务流继续，相位不变');
  assert.equal(harness.tutorRequests, 0, '流式期间只入队，不发 Tutor 请求');
  assert.equal(harness.immediatePersists.length, 1, '问题提交立即落盘，不走节流');
  harness.emitTaskCompleted();
  assert.equal(harness.tutorRequests, 1, '任务完成后自动启动最早问题');
  assert.equal(harness.tutorBodies[0].courseId, 'course-1', '请求载荷必须携带 courseId');
  assert.equal(harness.tutorBodies[0].question.text, '为什么 ETag 能减少正文传输？');
  assert.equal(harness.tutorBodies[0].mode, 'inline_tutor');
});

test('边界提问立即启动 Tutor，回答后仍保持边界', async () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  harness.submitTutorQuestion('能举个例子吗？');
  assert.equal(harness.tutorRequests, 1);
  assert.equal(harness.phase, 'boundary', 'Tutor 启动不改变章节相位');
  await harness.emitTutorCompleted();
  assert.equal(harness.phase, 'boundary', '回答结束后仍停在边界');
  assert.equal(harness.orchestrator.isBusy, false);
  const answer = harness.lesson.streamItems.find((i) => i.type === 'tutor_answer');
  assert.equal(answer?.status, 'complete');
  const question = harness.lesson.streamItems.find((i) => i.type === 'user_question');
  assert.equal(question?.status, 'complete');
});

test('courseId 不匹配的事件丢弃，不污染当前章节', async () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  harness.submitTutorQuestion('304 为什么没有正文？');
  await harness.emitTutorStarted();
  await harness.emitForeignTutorEvent({ type: 'tutor_block_delta', payload: { blockId: 'tb1', delta: '来自其他课程的内容' } });
  let answer = harness.lesson.streamItems.find((i) => i.type === 'tutor_answer');
  assert.ok(answer, '本课程的 started 正常建流');
  assert.equal(answer?.type === 'tutor_answer' && answer.blocks.length, 0, '外课程 delta 被丢弃');
  const qid = harness.tutorBodies[0].question.questionId;
  await harness.emitForeignTutorEvent({
    type: 'tutor_completed',
    payload: { questionId: qid, blocks: [{ type: 'markdown', blockId: 'tb1', markdown: '被劫持的回答' }] },
  });
  answer = harness.lesson.streamItems.find((i) => i.type === 'tutor_answer');
  assert.equal(answer?.status, 'streaming', '外课程 completed 同样被丢弃，回答不被劫持');
});

test('失败问题局部重试只重发该问题，不动 completedTaskIds', async () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  harness.submitTutorQuestion('304 为什么没有正文？');
  await harness.emitTutorError();
  const completedBefore = [...harness.lesson.runtime.completedTaskIds];
  assert.equal(harness.lesson.streamItems.find((i) => i.type === 'tutor_answer')?.status, 'failed');
  assert.equal(harness.orchestrator.isBusy, false, '失败后 Tutor 回到空闲');

  assert.equal(harness.retryTutor(harness.lastQuestionId ?? ''), true);
  assert.equal(harness.tutorRequests, 2, '重试发起新的独立请求');
  assert.equal(harness.tutorBodies[1].question.questionId, harness.lastQuestionId);
  assert.deepEqual(harness.lesson.runtime.completedTaskIds, completedBefore, '不触碰已完成任务');
  assert.equal(harness.lesson.runtime.currentTaskStatus, 'awaiting_user', '不触碰主线任务状态');
  assert.equal(harness.phase, 'boundary');
  await harness.emitTutorCompleted('重试后的回答');
  assert.equal(harness.lesson.streamItems.find((i) => i.type === 'tutor_answer')?.status, 'complete');
});

test('重试只接受失败问题；Tutor 忙碌期间不重复发请求', async () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  const first = harness.submitTutorQuestion('第一个问题');
  assert.equal(harness.retryTutor(first ?? ''), false, '未失败的问题不能重试');
  const second = harness.submitTutorQuestion('第二个问题');
  assert.ok(second, '忙碌期间问题仍入队');
  assert.equal(harness.retryTutor(second ?? ''), false, '排队中的问题不能重试');
  assert.equal(harness.tutorRequests, 1, '全程只发一个请求');
});

test('快速连续提问：第一题立即启动，第二题入队；首题完成后自动串接第二题', async () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  harness.submitTutorQuestion('第一个问题');
  harness.submitTutorQuestion('第二个问题');
  assert.equal(harness.tutorRequests, 1, 'Tutor 请求进行中不启动第二个请求');
  assert.equal(harness.lesson.streamItems.filter((i) => i.type === 'user_question').length, 2);
  await harness.emitTutorCompleted('第一题的回答');
  assert.equal(harness.tutorRequests, 2, '终态后自动处理队列下一题');
  assert.equal(harness.tutorBodies[1].question.text, '第二个问题');
});

test('参与信号：答疑提交与回答终态按既有模式记录', async () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  harness.submitTutorQuestion('304 为什么没有正文？');
  await harness.emitTutorCompleted();
  assert.deepEqual(
    harness.engagements.map((e) => e.eventType),
    ['tutor_question_submitted', 'tutor_answer_completed'],
  );

  const failedHarness = createChapterLearningHarness({ phase: 'boundary' });
  failedHarness.submitTutorQuestion('另一个问题');
  await failedHarness.emitTutorError();
  assert.deepEqual(
    failedHarness.engagements.map((e) => e.eventType),
    ['tutor_question_submitted', 'tutor_answer_failed'],
  );
});

test('流未开始即失败（422 校验）：问题标记失败且可重试', async () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  harness.failNextTutorFetch(422, { code: 'INVALID_REQUEST', message: '幂等键与当前问题不一致' });
  harness.submitTutorQuestion('304 为什么没有正文？');
  await harness.settle();
  const answer = harness.lesson.streamItems.find((i) => i.type === 'tutor_answer');
  assert.equal(answer?.status, 'failed');
  assert.equal(answer?.type === 'tutor_answer' && answer.errorMessage, '幂等键与当前问题不一致');
  assert.equal(harness.orchestrator.isBusy, false, '失败后释放忙碌，允许重试');
  assert.equal(harness.retryTutor(harness.lastQuestionId ?? ''), true);
  assert.equal(harness.tutorRequests, 2);
});

test('网络异常：沿用本地合成失败模式，问题保留可重试', async () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  harness.failNextTutorFetchWithNetworkError();
  harness.submitTutorQuestion('304 为什么没有正文？');
  await harness.settle();
  const answer = harness.lesson.streamItems.find((i) => i.type === 'tutor_answer');
  assert.equal(answer?.status, 'failed');
  const question = harness.lesson.streamItems.find((i) => i.type === 'user_question');
  assert.equal(question?.status, 'failed', '失败保留问题条目');
  assert.ok(harness.lesson.streamItems.some((i) => i.type === 'system_notice'), '附带用户可见错误通知');
  assert.equal(harness.phase, 'boundary', 'Tutor 失败不改变章节相位');
});

test('流无终态结束：本地合成失败，防止 pending 永久停留', async () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  harness.submitTutorQuestion('304 为什么没有正文？');
  await harness.emitTutorStarted();
  await harness.emitTutorDelta('半截回答');
  await harness.endActiveStream();
  const answer = harness.lesson.streamItems.find((i) => i.type === 'tutor_answer');
  assert.equal(answer?.status, 'failed', '无终态时合成失败，不卡在 streaming');
  assert.equal(harness.orchestrator.isBusy, false);
});

test('卸载/章节切换作废在途请求：状态归一，重新派发可建流', async () => {
  const harness = createChapterLearningHarness({ phase: 'boundary' });
  harness.submitTutorQuestion('强缓存和协商缓存的区别？');
  await harness.emitTutorStarted();
  await harness.emitTutorDelta('半截回答');
  harness.invalidate();
  assert.equal(harness.orchestrator.isBusy, false, 'invalidate 复位忙碌');
  const answer = harness.lesson.streamItems.find((i) => i.type === 'tutor_answer');
  assert.equal(answer?.status, 'pending', '被中断回答归一为 pending（同刷新恢复语义）');
  assert.equal(harness.lesson.runtime.pendingRequest?.status, 'failed', '死请求标记 failed 解除在途守卫');

  // 章节切换后重新挂载：边界兜底派发可重启（旧代际事件已作废）
  harness.resumeFromBoot(false);
  assert.equal(harness.tutorRequests, 2);
  await harness.emitTutorCompleted('重启后的回答');
  assert.equal(harness.lesson.streamItems.find((i) => i.type === 'tutor_answer')?.status, 'complete');
});

// ---- Task 7：UI 文案辅助函数 ----

test('Tutor UI 文案区分流中排队和边界立即回答', () => {
  assert.equal(tutorPlaceholder('streaming'), '本节生成完成后回答你的问题…');
  assert.equal(tutorPlaceholder('boundary'), '针对本节内容提问…');
});

test('排队提示区分主任务生成中和边界超窗排队', () => {
  // 流中排队：内容仍在生成，提示生成完后回答
  assert.equal(tutorQueuedHint(true), '本节内容会先生成完，随后回答你的问题');
  // 边界超窗排队：此时没有内容在生成，原文案错位（最终审查修复 2）
  assert.equal(tutorQueuedHint(false), '问题较多时会按顺序回答，也可继续学习');
});
