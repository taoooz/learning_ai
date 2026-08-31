// tests/learning-v2-tutor-protocol.test.ts
// V2 流内答疑（Tutor）协议测试：幂等键、事件类型、问题/回答归约与版本守卫（P2 Task 1/Task 2）

import test from 'node:test';
import assert from 'node:assert/strict';

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
