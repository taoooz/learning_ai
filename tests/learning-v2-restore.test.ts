// tests/learning-v2-restore.test.ts
// decideResumeAction 九分支覆盖（计划 T7）：
// ①无 lesson→生成计划 ②completed→完成卡 ③planning→最小 order 任务（attempt 1）
// ④awaiting_user 边界→渲染已有 ⑤流式残留→新 attempt ⑥failed→重试
// ⑦脏 pendingRequest→不干扰正常分支 ⑧损坏 null 由 storage 归一（等同①）
// ⑨locked 在页面层重定向，不进此函数（由章节页守卫覆盖，此处不测）
// ②-bis（P1b）：completing 异步缝隙→末任务边界，防收尾死锁

import test from 'node:test';
import assert from 'node:assert/strict';

import { decideResumeAction } from '../lib/learning-v2/resume';
import { createInitialNodeLessonV2 } from '../lib/learning-v2/reducers';
import type { ChapterPlan, NodeLessonV2, PlannedTask } from '../types/learning-v2';

const NOW = 1756700000000;

function makeTask(taskId: string, order: number): PlannedTask {
  return {
    taskId,
    order,
    title: `任务 ${order}`,
    objectiveId: 'obj-1',
    taskGoal: `完成任务 ${order} 的目标`,
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

function makePlan(taskCount = 3): ChapterPlan {
  return {
    chapterId: 'ch-1',
    planId: 'plan-test00000001',
    planVersion: 1,
    objectiveIds: ['obj-1'],
    tasks: Array.from({ length: taskCount }, (_, i) => makeTask(`t${i + 1}`, i + 1)),
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    generationMeta: { promptVersion: 'test-v1', modelVersion: 'test-model', generatedAt: NOW },
  };
}

function makeLesson(mutate?: (lesson: NodeLessonV2) => void): NodeLessonV2 {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  mutate?.(lesson);
  return lesson;
}

test('分支①：无 lesson → 生成计划', () => {
  assert.deepEqual(decideResumeAction(null), { kind: 'generate_plan' });
});

test('分支⑧：损坏数据被 storage 归一为 null，走同①（此处直接验证 null 入口）', () => {
  // storage.loadNodeLessonV2 对解析失败返回 null，决策层只见到 null
  assert.equal(decideResumeAction(null).kind, 'generate_plan');
});

test('分支②：章节已完成 → 渲染完成卡', () => {
  const lesson = makeLesson((l) => {
    l.runtime.status = 'completed';
    l.runtime.currentTaskId = 't3';
    l.runtime.currentTaskStatus = 'completed';
    l.runtime.completedTaskIds = ['t1', 't2', 't3'];
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'render_completed' });
});

test('分支③：planning 且无进行中任务 → 最小 order 任务，attempt 1', () => {
  const lesson = makeLesson(); // createInitialNodeLessonV2 即 planning 态
  assert.deepEqual(decideResumeAction(lesson), {
    kind: 'start_task',
    taskId: 't1',
    attempt: 1,
  });
});

test('分支③变体：planning 且任务全部完成 → 回退重新生成计划', () => {
  const lesson = makeLesson((l) => {
    l.runtime.completedTaskIds = ['t1', 't2', 't3'];
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'generate_plan' });
});

test('分支④：awaiting_user 且当前任务已完成 → 渲染边界', () => {
  const lesson = makeLesson((l) => {
    l.runtime.status = 'awaiting_user';
    l.runtime.currentTaskId = 't1';
    l.runtime.currentTaskStatus = 'awaiting_user';
    l.runtime.completedTaskIds = ['t1'];
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'render_boundary', taskId: 't1' });
});

test('分支⑤：流式残留视为中断 → 对 currentTaskId 发新 attempt', () => {
  for (const status of ['streaming', 'generating', 'partial_paused'] as const) {
    const lesson = makeLesson((l) => {
      l.runtime.status = 'learning';
      l.runtime.currentTaskId = 't2';
      l.runtime.currentTaskStatus = status;
      l.runtime.completedTaskIds = ['t1'];
      l.runtime.pendingRequest = {
        requestId: 'req-old',
        kind: 'task',
        status: 'streaming',
        attempt: 2,
        startedAt: NOW,
      };
    });
    assert.deepEqual(
      decideResumeAction(lesson),
      { kind: 'start_task', taskId: 't2', attempt: 3 },
      `currentTaskStatus=${status} 应发 attempt 3`,
    );
  }
});

test('分支⑤变体：无 pendingRequest 时新 attempt 至少为 2', () => {
  const lesson = makeLesson((l) => {
    l.runtime.status = 'learning';
    l.runtime.currentTaskId = 't1';
    l.runtime.currentTaskStatus = 'streaming';
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'start_task', taskId: 't1', attempt: 2 });
});

test('分支②-bis（P1b）：completing 异步缝隙 → 回末任务边界，防收尾死锁', () => {
  // 收尾被刷新打断：Recap 已发未完成，状态停在 completing。
  // 若落回兜底分支依赖「全部完成」判断，任何遗漏都会死锁，须显式测试。
  const lesson = makeLesson((l) => {
    l.runtime.status = 'completing';
    l.runtime.currentTaskId = 't3';
    l.runtime.currentTaskStatus = 'completed';
    l.runtime.completedTaskIds = ['t1', 't2', 't3'];
    l.runtime.pendingRequest = {
      requestId: 'req-recap',
      kind: 'recap',
      status: 'streaming',
      attempt: 1,
      startedAt: NOW,
    };
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'render_boundary', taskId: 't3' });
});

test('分支②-bis 变体：completing 但无任何已完成任务 → 回退重新生成计划', () => {
  const lesson = makeLesson((l) => {
    l.runtime.status = 'completing';
    l.runtime.currentTaskId = 't1';
    l.runtime.currentTaskStatus = 'completed';
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'generate_plan' });
});

test('分支⑥：当前任务失败 → 以新 attempt 重新生成', () => {
  const lesson = makeLesson((l) => {
    l.runtime.status = 'learning';
    l.runtime.currentTaskId = 't2';
    l.runtime.currentTaskStatus = 'failed';
    l.runtime.completedTaskIds = ['t1'];
    l.runtime.pendingRequest = {
      requestId: 'req-failed',
      kind: 'task',
      status: 'failed',
      attempt: 1,
      startedAt: NOW,
      errorCode: 'LLM_TIMEOUT',
    };
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'start_task', taskId: 't2', attempt: 2 });
});

test('分支⑦：脏 pendingRequest 不干扰已停在边界的章节', () => {
  const lesson = makeLesson((l) => {
    l.runtime.status = 'awaiting_user';
    l.runtime.currentTaskId = 't2';
    l.runtime.currentTaskStatus = 'awaiting_user';
    l.runtime.completedTaskIds = ['t1', 't2'];
    // 脏数据：残留一个声称仍在途的旧请求
    l.runtime.pendingRequest = {
      requestId: 'req-stale',
      kind: 'task',
      status: 'streaming',
      attempt: 9,
      startedAt: NOW,
    };
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'render_boundary', taskId: 't2' });
});

test('兜底：awaiting_user 但当前任务未完成 → 继续下一个未完成任务', () => {
  const lesson = makeLesson((l) => {
    l.runtime.status = 'awaiting_user';
    l.runtime.currentTaskId = 't1';
    l.runtime.currentTaskStatus = 'awaiting_user';
    l.runtime.completedTaskIds = [];
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'start_task', taskId: 't1', attempt: 1 });
});

test('兜底：任务全部完成但未收尾 → 回到末任务边界', () => {
  const lesson = makeLesson((l) => {
    l.runtime.status = 'awaiting_user';
    l.runtime.currentTaskId = 't3';
    l.runtime.currentTaskStatus = 'completed';
    l.runtime.completedTaskIds = ['t1', 't2', 't3'];
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'render_boundary', taskId: 't3' });
});

test('跳过的任务不再重发：skipped 任务被兜底查找跳过', () => {
  // 用 learning 态绕过分支④，直达兜底的 firstUnfinishedTask 查找
  const lesson = makeLesson((l) => {
    l.runtime.status = 'learning';
    l.runtime.currentTaskId = 't1';
    l.runtime.currentTaskStatus = 'completed';
    l.runtime.completedTaskIds = ['t1'];
    l.runtime.skippedTaskIds = ['t2'];
  });
  assert.deepEqual(decideResumeAction(lesson), { kind: 'start_task', taskId: 't3', attempt: 1 });
});
