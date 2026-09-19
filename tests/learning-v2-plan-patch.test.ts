// tests/learning-v2-plan-patch.test.ts
// P4 动态调度：计划补丁校验与应用（版本守卫/上限/只动未展示任务/预取失效）

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlanPatch, canApplyPatch } from '../lib/learning-v2/plan-patch';
import { createInitialNodeLessonV2 } from '../lib/learning-v2/reducers';
import type { ChapterPlan, ChapterPlanPatch, NodeLessonV2 } from '../types/learning-v2';
import { MAX_PLAN_PATCHES_PER_CHAPTER } from '../types/learning-v2';

const META = { promptVersion: 'v1', modelVersion: 'test', generatedAt: 1, durationMs: 1, degraded: false };

function makePlan(): ChapterPlan {
  return {
    chapterId: 'ch-1', planId: 'plan-1', planVersion: 1,
    objectiveIds: ['obj-1'],
    tasks: [
      { taskId: 'task-1', order: 1, title: 'ETag', objectiveId: 'obj-1', taskGoal: 'g1',
        observableOutcome: 'o1', conceptKeys: [], prerequisiteTaskIds: [], teachingPattern: 'explain',
        expectedMinutes: 3, evidencePolicy: 'none', origin: 'initial', status: 'planned' },
      { taskId: 'task-2', order: 2, title: 'Cache-Control', objectiveId: 'obj-1', taskGoal: 'g2',
        observableOutcome: 'o2', conceptKeys: [], prerequisiteTaskIds: ['task-1'], teachingPattern: 'explain',
        expectedMinutes: 3, evidencePolicy: 'none', origin: 'initial', status: 'planned' },
      { taskId: 'task-3', order: 3, title: '总结', objectiveId: 'obj-1', taskGoal: 'g3',
        observableOutcome: 'o3', conceptKeys: [], prerequisiteTaskIds: ['task-2'], teachingPattern: 'recap',
        expectedMinutes: 2, evidencePolicy: 'none', origin: 'initial', status: 'planned' },
    ],
    status: 'active', createdAt: 1000, updatedAt: 1000, generationMeta: META,
  };
}

/** 模拟 task-1 已完成的 lesson（awaiting_user 边界） */
function makeLessonWithTask1Done(): NodeLessonV2 {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  return {
    ...lesson,
    runtime: {
      ...lesson.runtime,
      status: 'awaiting_user',
      currentTaskId: 'task-1',
      currentTaskStatus: 'awaiting_user',
      completedTaskIds: ['task-1'],
      prefetchedTask: { taskId: 'task-2', planId: 'plan-1', planVersion: 1, prefetchedAt: 2000 },
    },
    streamItems: [
      { itemId: 'tc:task-1', type: 'task_content', chapterId: 'ch-1', taskId: 'task-1',
        planVersion: 1, sequence: 1, createdAt: 1500, status: 'complete',
        title: 'ETag', blocks: [], boundaryPrompt: { takeaway: '', nextHint: '' } },
    ],
  };
}

function makePatch(overrides?: Partial<ChapterPlanPatch>): ChapterPlanPatch {
  return {
    patchId: 'patch-1',
    basePlanVersion: 1,
    operations: [{ type: 'skip_task', targetTaskIds: ['task-2'] }],
    summary: '你对这部分已经很熟了，跳过这一节',
    reasonCode: 'STRONG_PRIOR_EVIDENCE',
    confidence: 0.9,
    createdAt: 3000,
    ...overrides,
  };
}

// ---- canApplyPatch ----

test('canApplyPatch: 版本匹配 + 未展示目标 → 通过', () => {
  const lesson = makeLessonWithTask1Done();
  const result = canApplyPatch(lesson, makePatch());
  assert.equal(result.ok, true);
});

test('canApplyPatch: 版本不匹配 → VERSION_MISMATCH（拒绝旧补丁）', () => {
  const lesson = makeLessonWithTask1Done();
  // 模拟已升级到 v2
  const v2Lesson = { ...lesson, chapterPlan: { ...lesson.chapterPlan, planVersion: 2 } };
  const result = canApplyPatch(v2Lesson, makePatch());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VERSION_MISMATCH');
});

test('canApplyPatch: 目标已展示 → TARGETS_SHOWN_TASK（不改写已展示内容）', () => {
  const lesson = makeLessonWithTask1Done();
  const patch = makePatch({ operations: [{ type: 'skip_task', targetTaskIds: ['task-1'] }] });
  const result = canApplyPatch(lesson, patch);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TARGETS_SHOWN_TASK');
});

test('canApplyPatch: skip 置信度不足 → LOW_CONFIDENCE', () => {
  const lesson = makeLessonWithTask1Done();
  const result = canApplyPatch(lesson, makePatch({ confidence: 0.6 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'LOW_CONFIDENCE');
});

test('canApplyPatch: 超过每章上限 → PATCH_LIMIT_REACHED', () => {
  const lesson = makeLessonWithTask1Done();
  const maxed = { ...lesson, chapterPlan: { ...lesson.chapterPlan, appliedPatchCount: MAX_PLAN_PATCHES_PER_CHAPTER } };
  const result = canApplyPatch(maxed, makePatch());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PATCH_LIMIT_REACHED');
});

test('canApplyPatch: 空操作 → EMPTY_OPERATIONS', () => {
  const lesson = makeLessonWithTask1Done();
  const result = canApplyPatch(lesson, makePatch({ operations: [] }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'EMPTY_OPERATIONS');
});

// ---- applyPlanPatch ----

test('applyPlanPatch: skip 后 planVersion+1、任务标记 skipped、预取失效', () => {
  const lesson = makeLessonWithTask1Done();
  const result = applyPlanPatch(lesson, makePatch(), 3000);
  assert.equal(result.chapterPlan.planVersion, 2, '版本应升级到 2');
  assert.equal(result.chapterPlan.appliedPatchCount, 1);
  assert.equal(result.chapterPlan.tasks.find((t) => t.taskId === 'task-2')?.status, 'skipped');
  assert.equal(result.runtime.prefetchedTask, undefined, '预取应失效');
  // 已展示任务不受影响
  assert.equal(result.chapterPlan.tasks.find((t) => t.taskId === 'task-1')?.status, 'planned');
});

test('applyPlanPatch: skip 后 order 重排连续', () => {
  const lesson = makeLessonWithTask1Done();
  const result = applyPlanPatch(lesson, makePatch(), 3000);
  const orders = result.chapterPlan.tasks.map((t) => t.order);
  assert.deepEqual(orders, [1, 2, 3], 'order 应保持连续');
});

test('applyPlanPatch: 不可应用时原样返回', () => {
  const lesson = makeLessonWithTask1Done();
  const badPatch = makePatch({ basePlanVersion: 99 });
  const result = applyPlanPatch(lesson, badPatch, 3000);
  assert.equal(result, lesson, '拒绝旧补丁时不修改 lesson');
});
