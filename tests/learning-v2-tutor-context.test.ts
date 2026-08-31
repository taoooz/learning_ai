// tests/learning-v2-tutor-context.test.ts
// P2 流内答疑最小上下文构造（设计文档 §3.2，计划 Task 3）：
// - visibleContent 只取当前任务已完成内容块，拼接后限制 6000 字符
// - recentInlineQA 只取当前任务最近 3 组已完成问答，问题 ≤300 字符、回答 ≤1200 字符
// - 请求载荷不得包含整门课程对象或全量历史（字段形状固定为最小契约）

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendUserQuestion,
  applyLearningSseEvent,
  createInitialNodeLessonV2,
} from '../lib/learning-v2/reducers';
import {
  buildInlineTutorContext,
  TUTOR_ANSWER_CHAR_LIMIT,
  TUTOR_QUESTION_CHAR_LIMIT,
  TUTOR_VISIBLE_CONTENT_LIMIT,
} from '../lib/learning-v2/tutor-context';

import type {
  ChapterPlan,
  GenerationMeta,
  LearningContentBlock,
  LearningSseEvent,
  NodeLessonV2,
  PlannedTask,
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
    eventId: 'evt-t',
    requestId: 'req-tutor',
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

/** 问题的完整回答事件（tutor_completed 一步落定回答条目） */
function tutorCompletedEvent(
  questionId: string,
  taskId: string,
  markdown: string,
  sequence: number,
): LearningSseEvent {
  return makeEvent({
    type: 'tutor_completed',
    taskId,
    questionId,
    sequence,
    requestId: `req-${questionId}`,
    payload: {
      questionId,
      blocks: [{ type: 'markdown', blockId: `tb-${questionId}`, markdown }],
    },
  });
}

/** 任务 1 内容超长（>6000 字符）且任务 2 也有内容（应被排除）的夹具 */
function makeLessonWithLongBlocks(): NodeLessonV2 {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = applyLearningSseEvent(
    lesson,
    taskCompletedEvent(
      'task-1',
      'ETag',
      [
        { type: 'markdown', blockId: 'b1', markdown: '长'.repeat(6500) },
        { type: 'key_point', blockId: 'b2', title: '要点', points: ['ETag 是版本指纹'] },
      ],
      1,
    ),
  );
  lesson = applyLearningSseEvent(
    lesson,
    taskCompletedEvent(
      'task-2',
      'Cache-Control',
      [{ type: 'markdown', blockId: 'b1', markdown: '任务二专属内容，不应进入 Tutor 上下文' }],
      2,
    ),
  );
  return lesson;
}

const lessonWithLongBlocks = makeLessonWithLongBlocks();

/** 含 4 组已完成问答的夹具（只应保留最近 3 组） */
function makeLessonWithFourQAPairs(): NodeLessonV2 {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = applyLearningSseEvent(
    lesson,
    taskCompletedEvent(
      'task-1',
      'ETag',
      [{ type: 'markdown', blockId: 'b1', markdown: 'ETag 是资源的版本指纹。' }],
      1,
    ),
  );
  for (let index = 1; index <= 4; index += 1) {
    lesson = appendUserQuestion(
      lesson,
      { taskId: 'task-1', questionId: `q-old-${index}`, text: `历史问题 ${index}` },
      NOW + index,
    );
    lesson = applyLearningSseEvent(
      lesson,
      tutorCompletedEvent(`q-old-${index}`, 'task-1', `历史回答 ${index}`, 10 + index),
    );
  }
  return lesson;
}

const BASE_ARGS = {
  courseTopic: 'HTTP 缓存',
  chapter: { title: '验证策略', teachingGoal: '理解强缓存和协商缓存' },
  task: { taskId: 'task-1', title: 'ETag', taskDescription: '理解条件请求' },
  questionId: 'q-1',
  question: '304 为什么没有正文？',
  idempotencyKey: 'tutor:ch-1:v1:task-1:q-1',
};

// ---- 简报基线用例 ----

test('Tutor 上下文只包含当前任务并截断已展示内容', () => {
  const request = buildInlineTutorContext({
    courseTopic: 'HTTP 缓存',
    chapter: { title: '验证策略', teachingGoal: '理解强缓存和协商缓存' },
    task: { taskId: 'task-1', title: 'ETag', taskDescription: '理解条件请求' },
    lesson: lessonWithLongBlocks,
    questionId: 'q-1',
    question: '304 为什么没有正文？',
    idempotencyKey: 'tutor:ch-1:v1:task-1:q-1',
  });
  assert.equal(request.mode, 'inline_tutor');
  assert.equal(request.question.text, '304 为什么没有正文？');
  assert.equal(request.visibleContent.length <= 6000, true);
  assert.equal('fullCourse' in request, false);
});

// ---- visibleContent ----

test('visibleContent 恰好截断到上限，且不含其他任务内容', () => {
  const request = buildInlineTutorContext({ ...BASE_ARGS, lesson: lessonWithLongBlocks });
  assert.equal(request.visibleContent.length, TUTOR_VISIBLE_CONTENT_LIMIT);
  assert.equal(request.visibleContent.includes('任务二专属内容'), false, '其他任务内容被排除');
});

test('key_point / example 块文本也计入 visibleContent', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = applyLearningSseEvent(
    lesson,
    taskCompletedEvent(
      'task-1',
      'ETag',
      [
        { type: 'key_point', blockId: 'b1', title: '要点标题', points: ['要点一', '要点二'] },
        {
          type: 'example',
          blockId: 'b2',
          title: '示例标题',
          context: '示例背景',
          content: '示例内容',
          takeaway: '示例要点',
        },
      ],
      1,
    ),
  );
  const request = buildInlineTutorContext({ ...BASE_ARGS, lesson });
  assert.ok(request.visibleContent.includes('要点一'), '要点文本入选');
  assert.ok(request.visibleContent.includes('示例要点'), '示例要点入选');
});

test('仍在流式生成（未完成）的任务内容不进入 visibleContent', () => {
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
  const request = buildInlineTutorContext({ ...BASE_ARGS, lesson });
  assert.equal(request.visibleContent, '');
});

// ---- recentInlineQA ----

test('recentInlineQA 只保留当前任务最近 3 组问答，按时间排列', () => {
  const request = buildInlineTutorContext({
    ...BASE_ARGS,
    questionId: 'q-new',
    question: '新问题',
    lesson: makeLessonWithFourQAPairs(),
  });
  assert.deepEqual(request.recentInlineQA, [
    { question: '历史问题 2', answer: '历史回答 2' },
    { question: '历史问题 3', answer: '历史回答 3' },
    { question: '历史问题 4', answer: '历史回答 4' },
  ]);
});

test('问答按字符上限截断：问题 300、回答 1200', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = appendUserQuestion(
    lesson,
    { taskId: 'task-1', questionId: 'q-long', text: '问'.repeat(500) },
    NOW + 1,
  );
  lesson = applyLearningSseEvent(
    lesson,
    tutorCompletedEvent('q-long', 'task-1', '答'.repeat(2000), 11),
  );
  const request = buildInlineTutorContext({ ...BASE_ARGS, questionId: 'q-new', lesson });
  assert.equal(request.recentInlineQA.length, 1);
  assert.equal(request.recentInlineQA[0].question.length, TUTOR_QUESTION_CHAR_LIMIT);
  assert.equal(request.recentInlineQA[0].answer.length, TUTOR_ANSWER_CHAR_LIMIT);
});

test('未回答与回答失败的问题不进入 recentInlineQA', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = appendUserQuestion(
    lesson,
    { taskId: 'task-1', questionId: 'q-pending', text: '还没回答的问题' },
    NOW + 1,
  );
  lesson = appendUserQuestion(
    lesson,
    { taskId: 'task-1', questionId: 'q-failed', text: '回答失败的问题' },
    NOW + 2,
  );
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'request_error',
      taskId: 'task-1',
      questionId: 'q-failed',
      sequence: 12,
      requestId: 'req-q-failed',
      payload: { code: 'LLM_TIMEOUT', message: '模型响应超时，请稍后重试', retryable: true },
    }),
  );
  const request = buildInlineTutorContext({ ...BASE_ARGS, questionId: 'q-new', lesson });
  assert.deepEqual(request.recentInlineQA, []);
});

test('其他任务的问答不进入 recentInlineQA', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = appendUserQuestion(
    lesson,
    { taskId: 'task-2', questionId: 'q-other', text: '其他任务的问题' },
    NOW + 1,
  );
  lesson = applyLearningSseEvent(
    lesson,
    tutorCompletedEvent('q-other', 'task-2', '其他任务的回答', 11),
  );
  const request = buildInlineTutorContext({ ...BASE_ARGS, questionId: 'q-new', lesson });
  assert.deepEqual(request.recentInlineQA, []);
});

test('当前问题即便已有完成回答，也不混入历史问答（避免与 question 字段自引用重复）', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = appendUserQuestion(
    lesson,
    { taskId: 'task-1', questionId: 'q-1', text: '之前问过的问题' },
    NOW + 1,
  );
  lesson = applyLearningSseEvent(lesson, tutorCompletedEvent('q-1', 'task-1', '之前的回答', 11));
  const request = buildInlineTutorContext({ ...BASE_ARGS, lesson });
  assert.deepEqual(request.recentInlineQA, []);
});

// ---- 载荷形状与当前问题 ----

test('当前问题文本同样按问题字符上限截断', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  const request = buildInlineTutorContext({
    ...BASE_ARGS,
    question: '问'.repeat(500),
    lesson,
  });
  assert.equal(request.question.text.length, TUTOR_QUESTION_CHAR_LIMIT);
  assert.equal(request.question.questionId, 'q-1');
});

test('载荷字段固定为最小契约，不含课程全量字段', () => {
  const request = buildInlineTutorContext({ ...BASE_ARGS, lesson: lessonWithLongBlocks });
  assert.deepEqual(Object.keys(request).sort(), [
    'chapter',
    'courseTopic',
    'idempotencyKey',
    'mode',
    'question',
    'recentInlineQA',
    'task',
    'visibleContent',
  ]);
  assert.deepEqual(request.chapter, { title: '验证策略', teachingGoal: '理解强缓存和协商缓存' });
  assert.deepEqual(request.task, { taskId: 'task-1', title: 'ETag', taskDescription: '理解条件请求' });
});

test('空 lesson → 空上下文', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  const request = buildInlineTutorContext({ ...BASE_ARGS, lesson });
  assert.equal(request.visibleContent, '');
  assert.deepEqual(request.recentInlineQA, []);
});
