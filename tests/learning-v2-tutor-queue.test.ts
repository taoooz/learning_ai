// tests/learning-v2-tutor-queue.test.ts
// P2 流内答疑问题队列（设计文档 §3.3，计划 Task 5）：
// - 同一章节按提交顺序（streamItems sequence）串行
// - 回答状态非 complete/failed 的问题（含无回答条目）视为未回答
// - takeNextTutorQuestion 只返回最早一题且不修改输入
// - 自动窗口上限 3 由消费方（hook）使用 slice 截取，纯函数层不删除超出问题

import test from 'node:test';
import assert from 'node:assert/strict';

import { appendUserQuestion, applyLearningSseEvent, createInitialNodeLessonV2 } from '../lib/learning-v2/reducers';
import {
  countUnansweredTutorQuestions,
  getPendingTutorQuestions,
  takeNextTutorQuestion,
  TUTOR_AUTO_WINDOW_LIMIT,
} from '../lib/learning-v2/tutor-queue';

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
    eventId: 'evt-q',
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

/** 按提交顺序依次入流的纯问题夹具（无回答） */
function lessonWithQuestions(questionIds: string[]): NodeLessonV2 {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  questionIds.forEach((questionId, index) => {
    lesson = appendUserQuestion(
      lesson,
      { taskId: 'task-1', questionId, text: `问题 ${questionId}` },
      NOW + index + 1,
    );
  });
  return lesson;
}

// ---- 简报基线用例 ----

test('Tutor 队列按提交顺序串行，自动窗口最多三题', () => {
  const lesson = lessonWithQuestions(['q-1', 'q-2', 'q-3', 'q-4']);
  assert.deepEqual(getPendingTutorQuestions(lesson).map(q => q.questionId), ['q-1', 'q-2', 'q-3', 'q-4']);
  assert.equal(takeNextTutorQuestion(lesson)?.questionId, 'q-1');
  assert.equal(countUnansweredTutorQuestions(lesson), 4);
});

// ---- 队列排序与筛选 ----

test('队列顺序以 sequence 为准，不依赖数组写入顺序', () => {
  const lesson = lessonWithQuestions(['q-1', 'q-2', 'q-3']);
  const shuffled: NodeLessonV2 = { ...lesson, streamItems: [...lesson.streamItems].reverse() };
  assert.deepEqual(
    getPendingTutorQuestions(shuffled).map((q) => q.questionId),
    ['q-1', 'q-2', 'q-3'],
  );
  assert.equal(takeNextTutorQuestion(shuffled)?.questionId, 'q-1');
});

test('已回答与回答失败的问题不进入待答队列', () => {
  let lesson = lessonWithQuestions(['q-1', 'q-2', 'q-3']);
  lesson = applyLearningSseEvent(lesson, tutorCompletedEvent('q-1', 'task-1', '回答一', 11));
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'request_error',
      taskId: 'task-1',
      questionId: 'q-2',
      sequence: 12,
      requestId: 'req-q-2',
      payload: { code: 'LLM_TIMEOUT', message: '模型响应超时，请稍后重试', retryable: true },
    }),
  );
  assert.deepEqual(getPendingTutorQuestions(lesson).map((q) => q.questionId), ['q-3']);
  assert.equal(countUnansweredTutorQuestions(lesson), 1);
  assert.equal(takeNextTutorQuestion(lesson)?.questionId, 'q-3');
});

test('无问题的章节队列为空', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  assert.deepEqual(getPendingTutorQuestions(lesson), []);
  assert.equal(takeNextTutorQuestion(lesson), undefined);
  assert.equal(countUnansweredTutorQuestions(lesson), 0);
});

// ---- 纯函数约束 ----

test('takeNextTutorQuestion 只返回最早一题且不修改输入', () => {
  const lesson = lessonWithQuestions(['q-1', 'q-2']);
  const before = JSON.stringify(lesson);
  takeNextTutorQuestion(lesson);
  getPendingTutorQuestions(lesson);
  countUnansweredTutorQuestions(lesson);
  assert.equal(JSON.stringify(lesson), before, '输入 lesson 不被修改');
});

// ---- 自动窗口 ----

test('自动窗口上限为 3，由消费方截取，队列本身不删除超出问题', () => {
  assert.equal(TUTOR_AUTO_WINDOW_LIMIT, 3);
  const lesson = lessonWithQuestions(['q-1', 'q-2', 'q-3', 'q-4']);
  const window = getPendingTutorQuestions(lesson).slice(0, TUTOR_AUTO_WINDOW_LIMIT);
  assert.deepEqual(window.map((q) => q.questionId), ['q-1', 'q-2', 'q-3']);
  assert.equal(countUnansweredTutorQuestions(lesson), 4, '超出窗口的问题仍在队列中');
});
