// tests/learning-v2-tutor-resume.test.ts
// P2 流内答疑刷新恢复归一（设计文档 §5，计划 Task 5）：
// - pending/streaming 的 Tutor 回答统一恢复为 pending，保留问题与已展示回答块
// - 已完成/已失败回答不动；主任务状态不受 Tutor 恢复影响
// - 一次性自动重试：首次尝试被刷新打断才自动重试，标记随 pendingRequest 持久化，防刷新循环重试

import test from 'node:test';
import assert from 'node:assert/strict';

import { appendUserQuestion, applyLearningSseEvent, createInitialNodeLessonV2 } from '../lib/learning-v2/reducers';
import { normalizeTutorRuntimeForResume } from '../lib/learning-v2/resume';
import { prepareTutorBoot } from '../lib/learning-v2/tutor-orchestration';
import { createChapterLearningHarness } from './helpers/tutor-harness';

import type {
  ChapterPlan,
  GenerationMeta,
  LearningContentBlock,
  LearningSseEvent,
  NodeLessonV2,
  PlannedTask,
  TutorAnswerItem,
  UserQuestionItem,
} from '../types/learning-v2';

// ---- 测试基座 ----

const NOW = 1756700000000;
const META: GenerationMeta = { promptVersion: 'p1', modelVersion: 'm1', generatedAt: NOW };

function makeTask(taskId: string, order: number): PlannedTask {
  return {
    taskId,
    order,
    title: `任务 ${order}`,
    objectiveId: 'obj-1',
    taskGoal: `完成任务 ${order}`,
    observableOutcome: `能说明任务 ${order} 的要点`,
    conceptKeys: [`c${order}`],
    prerequisiteTaskIds: [],
    teachingPattern: 'explain',
    expectedMinutes: 2,
    evidencePolicy: 'none',
    origin: 'initial',
    status: 'planned',
  };
}

function makePlan(): ChapterPlan {
  return {
    chapterId: 'ch-1',
    planId: 'plan-1',
    planVersion: 1,
    objectiveIds: ['obj-1'],
    tasks: [makeTask('task-1', 0), makeTask('task-2', 1)],
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    generationMeta: META,
  };
}

function makeEvent(overrides: Partial<LearningSseEvent> = {}): LearningSseEvent {
  return {
    eventId: 'evt-r',
    requestId: 'req-q-1',
    type: 'tutor_started',
    courseId: 'course-1',
    chapterId: 'ch-1',
    planVersion: 1,
    sequence: 1,
    timestamp: NOW,
    payload: {},
    ...overrides,
  };
}

function taskCompletedEvent(
  taskId: string,
  title: string,
  blocks: LearningContentBlock[],
  sequence: number,
): LearningSseEvent {
  return makeEvent({
    type: 'task_completed',
    taskId,
    sequence,
    requestId: `req-${taskId}`,
    payload: {
      task: {
        taskId,
        planVersion: 1,
        title,
        blocks,
        boundaryPrompt: {},
        generationMeta: META,
      },
    },
  });
}

function tutorStartedEvent(questionId: string, requestId: string, sequence: number): LearningSseEvent {
  return makeEvent({
    type: 'tutor_started',
    taskId: 'task-1',
    questionId,
    sequence,
    requestId,
    payload: { questionId },
  });
}

function tutorDeltaEvent(
  questionId: string,
  requestId: string,
  delta: string,
  sequence: number,
): LearningSseEvent {
  return makeEvent({
    type: 'tutor_block_delta',
    taskId: 'task-1',
    questionId,
    sequence,
    requestId,
    payload: { blockId: 'tb1', delta },
  });
}

function tutorCompletedEvent(questionId: string, markdown: string, sequence: number): LearningSseEvent {
  return makeEvent({
    type: 'tutor_completed',
    taskId: 'task-1',
    questionId,
    sequence,
    requestId: `req-${questionId}`,
    payload: {
      questionId,
      blocks: [{ type: 'markdown', blockId: `tb-${questionId}`, markdown }],
    },
  });
}

/** 任务 1 完成、边界提问后流式回答进行中被刷新的夹具（经真实归约器构造） */
function makeLessonWithStreamingTutor(): NodeLessonV2 {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  // 真实时序：先 task_started（planning→learning），task_completed 才能推进到边界
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      sequence: 1,
      requestId: 'req-task-1',
      payload: { taskId: 'task-1', title: 'ETag' },
    }),
  );
  lesson = applyLearningSseEvent(
    lesson,
    taskCompletedEvent(
      'task-1',
      'ETag',
      [{ type: 'markdown', blockId: 'b1', markdown: 'ETag 是资源的版本指纹。' }],
      2,
    ),
  );
  lesson = appendUserQuestion(
    lesson,
    { taskId: 'task-1', questionId: 'q-1', text: '304 为什么没有正文？' },
    NOW + 1,
  );
  lesson = applyLearningSseEvent(lesson, tutorStartedEvent('q-1', 'req-q-1', 1));
  lesson = applyLearningSseEvent(lesson, tutorDeltaEvent('q-1', 'req-q-1', '半截回答：304 表示资源未变化', 2));
  return lesson;
}

const lessonWithStreamingTutor = makeLessonWithStreamingTutor();

// ---- 简报基线用例 ----

test('刷新将 pending/streaming 统一为 pending，只自动重试一次', () => {
  const first = normalizeTutorRuntimeForResume(lessonWithStreamingTutor, 0);
  assert.equal(first.lesson.streamItems.find(i => i.type === 'tutor_answer')?.status, 'pending');
  assert.equal(first.shouldAutoRetry, true);
  const second = normalizeTutorRuntimeForResume(first.lesson, 1);
  assert.equal(second.shouldAutoRetry, false);
});

// ---- 恢复保留语义 ----

test('流式残留恢复为 pending 时保留问题、已展示回答块与活跃时间', () => {
  const result = normalizeTutorRuntimeForResume(lessonWithStreamingTutor, NOW + 10);
  const answer = result.lesson.streamItems.find((i) => i.itemId === 'ta:q-1');
  const question = result.lesson.streamItems.find((i) => i.itemId === 'uq:q-1');
  assert.equal(answer?.status, 'pending');
  assert.deepEqual(answer?.type === 'tutor_answer' && answer.blocks, [
    { type: 'markdown', blockId: 'tb1', markdown: '半截回答：304 表示资源未变化' },
  ]);
  assert.equal(question?.status, 'pending', '问题保留且不被改动');
  assert.equal(result.lesson.updatedAt, NOW + 10);
  assert.equal(result.lesson.runtime.lastActiveAt, NOW + 10);
});

test('已完成回答不重复请求，无变化时原样返回', () => {
  let lesson = makeLessonWithStreamingTutor();
  lesson = applyLearningSseEvent(lesson, tutorCompletedEvent('q-1', '完整回答', 3));
  const result = normalizeTutorRuntimeForResume(lesson, NOW + 10);
  assert.equal(result.shouldAutoRetry, false);
  assert.equal(result.lesson.streamItems.find((i) => i.itemId === 'ta:q-1')?.status, 'complete');
  assert.equal(result.lesson, lesson, '无需归一时返回原引用');
});

test('已失败回答保持失败态，不自动重试', () => {
  let lesson = lessonWithQuestions();
  const result = normalizeTutorRuntimeForResume(lesson, NOW + 10);
  assert.equal(result.shouldAutoRetry, false);
  assert.equal(result.lesson.streamItems.find((i) => i.itemId === 'ta:q-1')?.status, 'failed');
  assert.equal(result.lesson.streamItems.find((i) => i.itemId === 'uq:q-1')?.status, 'failed');
  assert.equal(result.lesson, lesson, '无需归一时返回原引用');
});

/** 问题提交后回答直接失败的夹具（未开始流式） */
function lessonWithQuestions(): NodeLessonV2 {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = appendUserQuestion(
    lesson,
    { taskId: 'task-1', questionId: 'q-1', text: '304 为什么没有正文？' },
    NOW + 1,
  );
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'request_error',
      taskId: 'task-1',
      questionId: 'q-1',
      sequence: 2,
      requestId: 'req-q-1',
      payload: { code: 'LLM_TIMEOUT', message: '模型响应超时，请稍后重试', retryable: true },
    }),
  );
  return lesson;
}

// ---- 一次性重试标记与重试放行 ----

test('死请求归一为 failed 并保留 attempt，重试请求以新 requestId 正常建流', () => {
  const first = normalizeTutorRuntimeForResume(lessonWithStreamingTutor, NOW + 10);
  assert.equal(first.lesson.runtime.pendingRequest?.kind, 'tutor');
  assert.equal(first.lesson.runtime.pendingRequest?.status, 'failed');
  assert.equal(first.lesson.runtime.pendingRequest?.attempt, 1);

  // 自动重试以新 requestId 建流：不被在途流式守卫/过期请求守卫拒写
  const retried = applyLearningSseEvent(first.lesson, tutorStartedEvent('q-1', 'req-q-1-retry', 1));
  assert.equal(retried.streamItems.find((i) => i.itemId === 'ta:q-1')?.status, 'streaming');
  assert.equal(retried.runtime.pendingRequest?.requestId, 'req-q-1-retry');
  assert.equal(retried.runtime.pendingRequest?.attempt, 2);

  // 重试进行中再次刷新：一次性重试已消耗，不再自动重试
  const second = normalizeTutorRuntimeForResume(retried, NOW + 20);
  assert.equal(second.shouldAutoRetry, false);
  assert.equal(second.lesson.streamItems.find((i) => i.itemId === 'ta:q-1')?.status, 'pending');
});

test('无任何 Tutor 条目的章节原样返回', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  const result = normalizeTutorRuntimeForResume(lesson, NOW + 10);
  assert.equal(result.shouldAutoRetry, false);
  assert.equal(result.lesson, lesson);
});

// ---- 主任务隔离 ----

test('主任务请求在途时只归一 Tutor 回答，不动主任务状态', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      sequence: 1,
      requestId: 'req-task-1',
      payload: { taskId: 'task-1', title: 'ETag' },
    }),
  );
  const taskRequest = lesson.runtime.pendingRequest;
  assert.equal(taskRequest?.kind, 'task');

  // 手工注入未完成的 Tutor 问答（极端崩溃时序下才会出现的混合态）
  const question: UserQuestionItem = {
    itemId: 'uq:q-1',
    type: 'user_question',
    chapterId: 'ch-1',
    taskId: 'task-1',
    questionId: 'q-1',
    planVersion: 1,
    sequence: 2,
    createdAt: NOW + 1,
    status: 'pending',
    text: '304 为什么没有正文？',
  };
  const streamingAnswer: TutorAnswerItem = {
    itemId: 'ta:q-1',
    type: 'tutor_answer',
    chapterId: 'ch-1',
    taskId: 'task-1',
    questionId: 'q-1',
    planVersion: 1,
    sequence: 3,
    createdAt: NOW + 2,
    status: 'streaming',
    blocks: [{ type: 'markdown', blockId: 'tb1', markdown: '半截回答' }],
  };
  const pendingAnswer: TutorAnswerItem = {
    ...streamingAnswer,
    itemId: 'ta:q-2',
    questionId: 'q-2',
    sequence: 4,
    status: 'pending',
    blocks: [],
  };
  const mixed: NodeLessonV2 = {
    ...lesson,
    streamItems: [...lesson.streamItems, question, streamingAnswer, pendingAnswer],
  };

  const result = normalizeTutorRuntimeForResume(mixed, NOW + 10);
  assert.equal(result.shouldAutoRetry, false, '主任务请求不是 Tutor 请求，不触发自动重试');
  assert.deepEqual(result.lesson.runtime.pendingRequest, taskRequest, '主任务请求原封不动');
  assert.equal(result.lesson.runtime.currentTaskStatus, 'streaming', '主任务状态原封不动');
  assert.equal(result.lesson.streamItems.find((i) => i.itemId === 'ta:q-1')?.status, 'pending');
  assert.equal(result.lesson.streamItems.find((i) => i.itemId === 'ta:q-2')?.status, 'pending');
});

// ---- Task 6：刷新恢复接线（prepareTutorBoot + 编排层 harness） ----

test('prepareTutorBoot：归一结果需落盘，一次性自动重试标记正确', () => {
  const prepared = prepareTutorBoot(lessonWithStreamingTutor, NOW + 10);
  assert.equal(prepared.persisted, true, '归一改变了容器，启动时需落盘');
  assert.equal(prepared.shouldAutoRetry, true);
  assert.ok(prepared.lesson);
  assert.equal(prepared.lesson.streamItems.find((i) => i.itemId === 'ta:q-1')?.status, 'pending');

  // 一次性重试标记随归一消耗：再次准备不再自动重试
  const again = prepareTutorBoot(prepared.lesson, NOW + 20);
  assert.equal(again.shouldAutoRetry, false, '第二次刷新不再自动重试');
});

test('prepareTutorBoot：无可归一内容返回原引用不落盘；空容器安全', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  const prepared = prepareTutorBoot(lesson, NOW + 10);
  assert.equal(prepared.lesson, lesson, '原样返回');
  assert.equal(prepared.persisted, false, '跳过冗余落盘');
  assert.equal(prepared.shouldAutoRetry, false);

  const empty = prepareTutorBoot(null, NOW);
  assert.equal(empty.lesson, null);
  assert.equal(empty.persisted, false);
  assert.equal(empty.shouldAutoRetry, false);
});

test('刷新恢复：被中断的 Tutor 自动重试一次，不影响主任务状态', async () => {
  const prepared = prepareTutorBoot(lessonWithStreamingTutor, NOW + 10);
  assert.ok(prepared.lesson);
  const harness = createChapterLearningHarness({ lesson: prepared.lesson });
  assert.equal(harness.phase, 'boundary');
  harness.resumeFromBoot(prepared.shouldAutoRetry);
  assert.equal(harness.tutorRequests, 1, '自动重试只发一次请求');
  assert.equal(harness.tutorBodies[0].question.questionId, 'q-1');
  assert.equal(harness.tutorBodies[0].courseId, 'course-1');

  // 归一后死请求为 failed，重试的新 requestId 能正常建流且 attempt 升到 2
  await harness.emitTutorStarted();
  assert.equal(harness.lesson.runtime.pendingRequest?.kind, 'tutor');
  assert.equal(harness.lesson.runtime.pendingRequest?.status, 'streaming');
  assert.equal(harness.lesson.runtime.pendingRequest?.attempt, 2, '再次刷新不再自动重试的守卫依据');
  assert.deepEqual(harness.lesson.runtime.completedTaskIds, ['task-1'], '主任务完成列表不受影响');

  await harness.emitTutorCompleted('重试后完成的回答');
  assert.equal(harness.phase, 'boundary', '重试完成后仍停在边界');
  assert.equal(harness.lesson.streamItems.find((i) => i.itemId === 'ta:q-1')?.status, 'complete');
});

test('刷新恢复：自动重试再次失败进入可见失败态，第二次刷新不再自动重试', async () => {
  const prepared = prepareTutorBoot(lessonWithStreamingTutor, NOW + 10);
  assert.equal(prepared.shouldAutoRetry, true);
  assert.ok(prepared.lesson);
  const harness = createChapterLearningHarness({ lesson: prepared.lesson });
  harness.resumeFromBoot(prepared.shouldAutoRetry);
  assert.equal(harness.tutorRequests, 1, '自动重试只发生一次');

  // 重试的流再次失败 → 可见失败态（错误文案 + 问题标记失败供手动重试）
  await harness.emitTutorError('LLM_TIMEOUT', '模型响应超时，请稍后重试');
  const answer = harness.lesson.streamItems.find((i) => i.itemId === 'ta:q-1');
  const question = harness.lesson.streamItems.find((i) => i.itemId === 'uq:q-1');
  assert.equal(answer?.status, 'failed');
  assert.equal(
    answer?.type === 'tutor_answer' && answer.errorMessage,
    '模型响应超时，请稍后重试',
    '失败态携带 UI 可见的中文错误文案',
  );
  assert.equal(question?.status, 'failed', '问题保留并标记失败');
  assert.equal(harness.phase, 'boundary', '失败不改变章节相位');
  assert.equal(harness.orchestrator.isBusy, false, '失败后释放忙碌，允许手动重试');

  // 第二次刷新：失败回答不再归一、不再自动重试（防循环重试）
  const second = normalizeTutorRuntimeForResume(harness.lesson, NOW + 20);
  assert.equal(second.shouldAutoRetry, false);
  assert.equal(second.lesson, harness.lesson, '失败态容器原样返回');
});

test('刷新恢复：无 pendingRequest 的已提交未答问题走边界兜底派发', async () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      sequence: 1,
      requestId: 'req-task-1',
      payload: { taskId: 'task-1', title: 'ETag' },
    }),
  );
  lesson = applyLearningSseEvent(
    lesson,
    taskCompletedEvent('task-1', 'ETag', [{ type: 'markdown', blockId: 'b1', markdown: 'ETag 是资源的版本指纹。' }], 2),
  );
  lesson = appendUserQuestion(lesson, { taskId: 'task-1', questionId: 'q-9', text: '304 为什么没有正文？' }, NOW + 1);

  const prepared = prepareTutorBoot(lesson, NOW + 10);
  assert.equal(prepared.shouldAutoRetry, false, '无被中断的 Tutor 请求 → 无自动重试标记');
  assert.equal(prepared.persisted, false, '无归一内容 → 不冗余落盘');
  assert.ok(prepared.lesson);

  const harness = createChapterLearningHarness({ lesson: prepared.lesson });
  assert.equal(harness.phase, 'boundary');
  harness.resumeFromBoot(prepared.shouldAutoRetry);
  assert.equal(harness.tutorRequests, 1, '边界空闲兜底派发启动最早问题');
  assert.equal(harness.tutorBodies[0].question.questionId, 'q-9');
});

test('刷新恢复：主任务重启时 Tutor 问题不抢先启动，等任务完成后自动回答', async () => {
  // 流式相位（主线恢复为流式中）：队列里有问题也不启动 Tutor，等任务完成再派发
  const harness = createChapterLearningHarness({ phase: 'streaming' });
  harness.submitTutorQuestion('304 为什么没有正文？');
  assert.equal(harness.tutorRequests, 0);
  const prepared = prepareTutorBoot(harness.lesson, NOW + 10);
  assert.equal(prepared.shouldAutoRetry, false);
  harness.resumeFromBoot(prepared.shouldAutoRetry);
  assert.equal(harness.tutorRequests, 0, '非边界相位不启动 Tutor');
  harness.emitTaskCompleted();
  assert.equal(harness.tutorRequests, 1, '任务完成后队列兜底启动');
});
