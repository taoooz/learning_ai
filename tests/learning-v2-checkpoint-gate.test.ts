import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateChapterCheckpointGate } from '../lib/learning-v2/checkpoint-gate';
import type { NodeLesson } from '../types/learning-v2';

const META = { promptVersion: 'p', modelVersion: 'm', generatedAt: 1 };

function makeLesson(overrides: Partial<NodeLesson> = {}): NodeLesson {
  const tasks = [
    { taskId: 't1', order: 1, title: '任务一', objectiveId: 'obj-1', taskGoal: '目标一', observableOutcome: '结果一', conceptKeys: [], prerequisiteTaskIds: [], teachingPattern: 'explain' as const, expectedMinutes: 3, evidencePolicy: 'none' as const, origin: 'initial' as const, status: 'planned' as const },
    { taskId: 't2', order: 2, title: '任务二', objectiveId: 'obj-1', taskGoal: '目标二', observableOutcome: '结果二', conceptKeys: [], prerequisiteTaskIds: ['t1'], teachingPattern: 'recap' as const, expectedMinutes: 3, evidencePolicy: 'checkpoint' as const, origin: 'initial' as const, status: 'planned' as const },
  ];
  return {
    protocolVersion: 2,
    chapterId: 'ch-1',
    chapterPlan: { chapterId: 'ch-1', planId: 'plan-1', planVersion: 1, objectiveIds: ['obj-1'], tasks, status: 'active', createdAt: 1, updatedAt: 1, generationMeta: META },
    runtime: { status: 'awaiting_user', currentTaskId: 't2', currentTaskStatus: 'awaiting_user', completedTaskIds: ['t1', 't2'], skippedTaskIds: [], latestSequence: 10, lastActiveAt: 1 },
    streamItems: [],
    evidence: [],
    updatedAt: 1,
    ...overrides,
  };
}

function checkpointItem(evaluation?: { nextAction?: 'continue' | 'remediate_here' }) {
  return {
    itemId: 'checkpoint:cp-1',
    type: 'checkpoint' as const,
    chapterId: 'ch-1',
    taskId: 't2',
    planVersion: 1,
    sequence: 11,
    createdAt: 1,
    status: evaluation ? 'evaluated' as const : 'pending' as const,
    checkpoint: {
      checkpointId: 'cp-1', objectiveId: 'obj-1', taskId: 't2', conceptKeys: ['概念'], kind: 'scenario_choice' as const,
      prompt: '题目', options: [], correctAnswer: 'a', remediationHint: '提示', estimatedSeconds: 45, generationMeta: META,
    },
    remediationAttempt: 0,
    evaluation: evaluation ? { checkpointId: 'cp-1', outcome: 'not_demonstrated' as const, score: 0, confidence: 1, feedback: '反馈', nextAction: evaluation.nextAction ?? 'continue', correct: false } : undefined,
  };
}

test('章末检查未生成时阻止完成章节', () => {
  const gate = evaluateChapterCheckpointGate(makeLesson());
  assert.deepEqual(gate, { blocked: true, reason: 'generating' });
});

test('章末检查未作答时阻止完成章节', () => {
  const lesson = makeLesson({ streamItems: [checkpointItem()] });
  assert.deepEqual(evaluateChapterCheckpointGate(lesson), { blocked: true, reason: 'awaiting_answer' });
});

test('首次答错需要补救时阻止完成章节', () => {
  const lesson = makeLesson({ streamItems: [checkpointItem({ nextAction: 'remediate_here' })] });
  assert.deepEqual(evaluateChapterCheckpointGate(lesson), { blocked: true, reason: 'remediation_required' });
});

test('检查完成且允许继续时才解锁完成章节', () => {
  const lesson = makeLesson({ streamItems: [checkpointItem({ nextAction: 'continue' })] });
  assert.deepEqual(evaluateChapterCheckpointGate(lesson), { blocked: false });
});

test('检查生成失败时不永久锁死章节', () => {
  const lesson = makeLesson({
    streamItems: [{
      itemId: 'notice-1', type: 'system_notice' as const, chapterId: 'ch-1', taskId: 't2', planVersion: 1,
      sequence: 12, createdAt: 2, status: 'complete' as const, tone: 'warning' as const,
      message: '理解检查生成失败', code: 'CHECKPOINT_GENERATION_FAILED', retryable: true,
    }],
  });
  assert.deepEqual(evaluateChapterCheckpointGate(lesson), { blocked: false });
});
