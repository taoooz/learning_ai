import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  NodeLesson,
  SystemNoticeItem,
  TaskContentItem,
  TutorAnswerItem,
} from '../types/learning-v2';
import { isResolvedErrorNotice } from '../lib/learning-v2/stream-item-presentation';

function makeLesson(items: NodeLesson['streamItems']): NodeLesson {
  return {
    protocolVersion: 2,
    chapterId: 'ch-1',
    chapterPlan: {
      chapterId: 'ch-1',
      planId: 'plan-1',
      planVersion: 1,
      objectiveIds: [],
      tasks: [],
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      generationMeta: {
        promptVersion: 'test',
        modelVersion: 'test',
        generatedAt: 1,
      },
    },
    runtime: {
      status: 'awaiting_user',
      currentTaskId: 'task-1',
      currentTaskStatus: 'awaiting_user',
      completedTaskIds: [],
      skippedTaskIds: [],
      latestSequence: items.length,
      lastActiveAt: 1,
    },
    streamItems: items,
    evidence: [],
    updatedAt: 1,
  };
}

function taskNotice(): SystemNoticeItem {
  return {
    itemId: 'notice-task',
    type: 'system_notice',
    chapterId: 'ch-1',
    planVersion: 1,
    sequence: 1,
    createdAt: 1,
    status: 'complete',
    tone: 'error',
    message: '任务流服务不可用',
    taskId: 'task-1',
    retryable: true,
  };
}

function completedTask(): TaskContentItem {
  return {
    itemId: 'task-1:v1',
    type: 'task_content',
    chapterId: 'ch-1',
    planVersion: 1,
    taskId: 'task-1',
    sequence: 2,
    createdAt: 2,
    status: 'complete',
    title: '任务',
    blocks: [],
  };
}

test('任务错误通知在对应任务完成后不再展示', () => {
  const notice = taskNotice();
  const lesson = makeLesson([notice, completedTask()]);
  assert.equal(isResolvedErrorNotice(notice, lesson), true);
});

test('任务仍在失败或流式中时继续展示错误通知', () => {
  const notice = taskNotice();
  const failedTask: TaskContentItem = { ...completedTask(), status: 'failed' };
  assert.equal(isResolvedErrorNotice(notice, makeLesson([notice, failedTask])), false);
  assert.equal(isResolvedErrorNotice(notice, makeLesson([notice])), false);
});

test('答疑错误通知在回答完成后不再展示', () => {
  const notice: SystemNoticeItem = {
    ...taskNotice(),
    itemId: 'notice-answer',
    taskId: undefined,
    questionId: 'q-1',
    message: '回答生成失败',
  };
  const answer: TutorAnswerItem = {
    itemId: 'ta:q-1',
    type: 'tutor_answer',
    chapterId: 'ch-1',
    planVersion: 1,
    questionId: 'q-1',
    taskId: 'task-1',
    sequence: 3,
    createdAt: 3,
    status: 'complete',
    blocks: [],
  };
  assert.equal(isResolvedErrorNotice(notice, makeLesson([notice, answer])), true);
  assert.equal(isResolvedErrorNotice({ ...notice }, makeLesson([notice])), false);
});

test('非错误通知不受成功请求影响', () => {
  const notice: SystemNoticeItem = { ...taskNotice(), tone: 'warning', taskId: undefined };
  assert.equal(isResolvedErrorNotice(notice, makeLesson([notice, completedTask()])), false);
});
