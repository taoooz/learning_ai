import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHECKPOINT_GENERATION_FAILED_MESSAGE,
  canRetryCheckpointGeneration,
  clearCheckpointGenerationNotice,
} from '../lib/learning-v2/checkpoint-generation';
import type { NodeLesson, SystemNoticeItem } from '../types/learning-v2';

function notice(overrides: Partial<SystemNoticeItem> = {}): SystemNoticeItem {
  return {
    itemId: 'notice-1',
    type: 'system_notice',
    chapterId: 'ch-1',
    planVersion: 1,
    sequence: 2,
    createdAt: 1,
    status: 'complete',
    tone: 'warning',
    message: CHECKPOINT_GENERATION_FAILED_MESSAGE,
    code: 'CHECKPOINT_GENERATION_FAILED',
    taskId: 't1',
    retryable: true,
    ...overrides,
  };
}

function lesson(items: NodeLesson['streamItems']): NodeLesson {
  return {
    protocolVersion: 2,
    chapterId: 'ch-1',
    chapterPlan: {
      chapterId: 'ch-1',
      planId: 'plan-1',
      planVersion: 1,
      objectiveIds: ['obj-1'],
      tasks: [],
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      generationMeta: { promptVersion: 'p', modelVersion: 'm', generatedAt: 1 },
    },
    runtime: {
      status: 'awaiting_user',
      currentTaskId: 't1',
      currentTaskStatus: 'awaiting_user',
      completedTaskIds: [],
      skippedTaskIds: [],
      latestSequence: 3,
      lastActiveAt: 1,
    },
    streamItems: items,
    evidence: [],
    updatedAt: 1,
  };
}

test('只有存在重试回调时才展示 Checkpoint 生成重试入口', () => {
  assert.equal(canRetryCheckpointGeneration(notice(), true), true);
  assert.equal(canRetryCheckpointGeneration(notice(), false), false);
  assert.equal(canRetryCheckpointGeneration(notice({ retryable: false }), true), false);
  assert.equal(canRetryCheckpointGeneration(notice({ taskId: undefined }), true), false);
  assert.equal(
    canRetryCheckpointGeneration(
      notice({ code: 'TASK_STREAM_ERROR', taskId: 't1' }),
      true,
    ),
    false,
  );
});

test('重试只清除目标任务的 Checkpoint 失败通知', () => {
  const otherTaskFailure = notice({
    itemId: 'notice-2',
    sequence: 4,
    taskId: 't2',
  });
  const tutorFailure = notice({
    itemId: 'notice-3',
    sequence: 5,
    taskId: undefined,
    questionId: 'q1',
    code: 'TUTOR_STREAM_ERROR',
  });
  const cleaned = clearCheckpointGenerationNotice(
    lesson([notice(), otherTaskFailure, tutorFailure]),
    't1',
    10,
  );

  assert.deepEqual(
    cleaned.streamItems.map((item) => item.itemId),
    ['notice-2', 'notice-3'],
  );
  assert.equal(cleaned.updatedAt, 10);
});
