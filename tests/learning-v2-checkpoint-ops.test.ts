// tests/learning-v2-checkpoint-ops.test.ts
// P3a Checkpoint 客户端纯函数：needsCheckpoint / upsert / evaluation / evidence 收集

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCheckpointEvaluation,
  collectEvidence,
  findCheckpointForTask,
  needsCheckpoint,
  upsertCheckpointItem,
} from '../lib/learning-v2/checkpoint-ops';
import { createInitialNodeLessonV2, appendUserQuestion } from '../lib/learning-v2/reducers';
import type { CheckpointDefinition, CheckpointEvaluation } from '../types/learning-v2';
import type { ChapterPlan } from '../types/learning-v2';

const META = { promptVersion: 'v1', modelVersion: 'test', generatedAt: 1, durationMs: 1, degraded: false };

function makePlan(overrides?: Partial<ChapterPlan>): ChapterPlan {
  return {
    chapterId: 'ch-1',
    planId: 'plan-1',
    planVersion: 1,
    objectiveIds: ['obj-1'],
    tasks: [
      {
        taskId: 'task-1', order: 1, title: 'ETag', objectiveId: 'obj-1',
        taskGoal: '理解条件请求', observableOutcome: '能说明 304 流程',
        conceptKeys: ['etag'], prerequisiteTaskIds: [], teachingPattern: 'explain',
        expectedMinutes: 3, evidencePolicy: 'checkpoint', origin: 'initial', status: 'planned',
      },
      {
        taskId: 'task-2', order: 2, title: 'Cache-Control', objectiveId: 'obj-1',
        taskGoal: '理解强缓存', observableOutcome: '能区分 no-store 和 no-cache',
        conceptKeys: ['cache-control'], prerequisiteTaskIds: ['task-1'], teachingPattern: 'explain',
        expectedMinutes: 3, evidencePolicy: 'none', origin: 'initial', status: 'planned',
      },
    ],
    status: 'active', createdAt: 1000, updatedAt: 1000, generationMeta: META,
    ...overrides,
  };
}

const baseLesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);

const cpDefinition: CheckpointDefinition = {
  checkpointId: 'cp-1', objectiveId: 'obj-1', taskId: 'task-1', conceptKeys: ['etag'],
  kind: 'scenario_choice', prompt: '304 应该怎么做？',
  options: [
    { id: 'a', text: '重新下载' }, { id: 'b', text: '用缓存' },
    { id: 'c', text: '清缓存' }, { id: 'd', text: '报错' },
  ],
  correctAnswer: 'b', remediationHint: '304 = 未变化', estimatedSeconds: 45,
  generationMeta: META,
};

const evalPass: CheckpointEvaluation = {
  checkpointId: 'cp-1', outcome: 'demonstrated', score: 1.0, confidence: 1.0,
  feedback: '正确', nextAction: 'continue', correct: true,
};

const evalFail: CheckpointEvaluation = {
  checkpointId: 'cp-1', outcome: 'not_demonstrated', score: 0.0, confidence: 1.0,
  feedback: '不正确', nextAction: 'remediate_here', correct: false, correctAnswer: 'b',
};

// ---- needsCheckpoint ----

test('needsCheckpoint: evidencePolicy=checkpoint 且无条目 → true', () => {
  const withTask = { ...baseLesson, runtime: { ...baseLesson.runtime, currentTaskId: 'task-1' } };
  assert.equal(needsCheckpoint(withTask, 'task-1'), true);
});

test('needsCheckpoint: evidencePolicy=none → false', () => {
  assert.equal(needsCheckpoint(baseLesson, 'task-2'), false);
});

test('needsCheckpoint: 已有 checkpoint 条目 → false', () => {
  const withCp = upsertCheckpointItem(baseLesson, cpDefinition, 2000);
  assert.equal(needsCheckpoint(withCp, 'task-1'), false);
});

// ---- upsertCheckpointItem ----

test('upsertCheckpointItem 添加条目并转 checking', () => {
  const atBoundary = { ...baseLesson, runtime: { ...baseLesson.runtime, status: 'awaiting_user' as const } };
  const result = upsertCheckpointItem(atBoundary, cpDefinition, 2000);
  const item = findCheckpointForTask(result, 'task-1');
  assert.ok(item);
  assert.equal(item.status, 'pending');
  assert.equal(item.checkpoint.checkpointId, 'cp-1');
  assert.equal(result.runtime.status, 'checking');
});

test('upsertCheckpointItem 幂等：同 checkpointId 不重复', () => {
  const once = upsertCheckpointItem(baseLesson, cpDefinition, 2000);
  const twice = upsertCheckpointItem(once, cpDefinition, 2001);
  assert.equal(twice.streamItems.filter((s) => s.type === 'checkpoint').length, 1);
});

// ---- applyCheckpointEvaluation ----

test('applyCheckpointEvaluation 写入评估并回到 awaiting_user', () => {
  const atBoundary = { ...baseLesson, runtime: { ...baseLesson.runtime, status: 'awaiting_user' as const } };
  const withCp = upsertCheckpointItem(atBoundary, cpDefinition, 2000);
  const result = applyCheckpointEvaluation(withCp, 'cp-1', 'b', evalPass, 2001);
  const item = findCheckpointForTask(result, 'task-1');
  assert.ok(item);
  assert.equal(item.status, 'evaluated');
  assert.ok(item.evaluation);
  assert.equal(item.evaluation.outcome, 'demonstrated');
  assert.equal(item.submission?.attempt, 1);
  assert.equal(result.runtime.status, 'awaiting_user');
});

test('applyCheckpointEvaluation 重试 attempt 递增', () => {
  const atBoundary = { ...baseLesson, runtime: { ...baseLesson.runtime, status: 'awaiting_user' as const } };
  const withCp = upsertCheckpointItem(atBoundary, cpDefinition, 2000);
  const first = applyCheckpointEvaluation(withCp, 'cp-1', 'a', evalFail, 2001);
  const second = applyCheckpointEvaluation(first, 'cp-1', 'b', evalPass, 2002);
  const item = findCheckpointForTask(second, 'task-1');
  assert.ok(item?.submission);
  assert.equal(item.submission.attempt, 2);
});

// ---- collectEvidence ----

test('collectEvidence 提取已评估的 checkpoint 证据', () => {
  const atBoundary = { ...baseLesson, runtime: { ...baseLesson.runtime, status: 'awaiting_user' as const } };
  const withCp = upsertCheckpointItem(atBoundary, cpDefinition, 2000);
  const evaluated = applyCheckpointEvaluation(withCp, 'cp-1', 'b', evalPass, 2001);
  const evidence = collectEvidence(evaluated);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].objectiveId, 'obj-1');
  assert.equal(evidence[0].outcome, 'demonstrated');
  assert.equal(evidence[0].attempt, 1);
});

test('collectEvidence: 无评估 → 空', () => {
  assert.equal(collectEvidence(baseLesson).length, 0);
});
