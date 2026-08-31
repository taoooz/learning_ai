// tests/learning-v2-prefetch.test.ts
// 单任务预取纯函数（文档 §6.1 / §10.2 三路径，计划 T1）：
// canStartPrefetch 触发条件、resolvePrefetchConsumption 命中/未命中裁决、
// 重编号顺序、重放合法性与幂等（重放事件绝不绕过版本校验写入）

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialNodeLessonV2, applyLearningSseEvent } from '../lib/learning-v2/reducers';
import {
  canStartPrefetch,
  renumberSseEvents,
  resolvePrefetchConsumption,
  type PrefetchCacheEntry,
} from '../lib/learning-v2/prefetch';

import type {
  ChapterPlan,
  GenerationMeta,
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
    tasks: [makeTask('task-1', 0), makeTask('task-2', 1), makeTask('task-3', 2)],
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    generationMeta: META,
  };
}

function makeEvent(overrides: Partial<LearningSseEvent> = {}): LearningSseEvent {
  return {
    eventId: 'evt-p',
    requestId: 'req-prefetch',
    type: 'task_started',
    courseId: 'course-1',
    chapterId: 'ch-1',
    planVersion: 1,
    sequence: 1,
    timestamp: NOW,
    payload: {},
    ...overrides,
  };
}

/** 任务 1 完成、停在边界的 lesson（awaiting_user/awaiting_user） */
function makeBoundaryLesson(): NodeLessonV2 {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({ type: 'task_started', taskId: 'task-1', sequence: 1, requestId: 'req-1', payload: { taskId: 'task-1', title: '任务 0' } }),
  );
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'task_completed',
      taskId: 'task-1',
      sequence: 2,
      requestId: 'req-1',
      payload: {
        task: {
          taskId: 'task-1',
          planVersion: 1,
          title: '任务 0',
          blocks: [{ type: 'markdown', blockId: 'b1', markdown: '任务一内容' }],
          boundaryPrompt: { takeaway: '任务一要点' },
          generationMeta: META,
        },
      },
    }),
  );
  return lesson;
}

/** 任务 2 的完整预取事件序列（成功路径产物） */
function makePrefetchEvents(): LearningSseEvent[] {
  return [
    makeEvent({ type: 'task_started', taskId: 'task-2', sequence: 1, payload: { taskId: 'task-2', title: '任务 1' } }),
    makeEvent({ type: 'content_block_started', taskId: 'task-2', sequence: 2, payload: { blockId: 'b1', blockType: 'markdown' } }),
    makeEvent({ type: 'content_block_delta', taskId: 'task-2', sequence: 3, payload: { blockId: 'b1', delta: '预取内容' } }),
    makeEvent({
      type: 'task_completed',
      taskId: 'task-2',
      sequence: 4,
      payload: {
        task: {
          taskId: 'task-2',
          planVersion: 1,
          title: '任务 1',
          blocks: [{ type: 'markdown', blockId: 'b1', markdown: '预取内容' }],
          boundaryPrompt: { takeaway: '任务二要点' },
          generationMeta: META,
        },
      },
    }),
  ];
}

function makeEntry(overrides: Partial<PrefetchCacheEntry> = {}): PrefetchCacheEntry {
  return {
    taskId: 'task-2',
    planId: 'plan-1',
    planVersion: 1,
    events: makePrefetchEvents(),
    complete: true,
    ...overrides,
  };
}

// ---- canStartPrefetch ----

test('边界等待态且下一任务无缓存 → 返回下一任务 id', () => {
  const lesson = makeBoundaryLesson();
  assert.equal(canStartPrefetch(lesson, 'boundary', () => false), 'task-2');
});

test('非边界相位 / 非等待态 / 末任务 / 已有缓存 → 不预取', () => {
  const lesson = makeBoundaryLesson();
  assert.equal(canStartPrefetch(lesson, 'streaming', () => false), null, '相位不符');

  const learning = { ...lesson, runtime: { ...lesson.runtime, status: 'learning' as const } };
  assert.equal(canStartPrefetch(learning, 'boundary', () => false), null, '章节非等待态');

  const taskRunning = {
    ...lesson,
    runtime: { ...lesson.runtime, currentTaskStatus: 'streaming' as const },
  };
  assert.equal(canStartPrefetch(taskRunning, 'boundary', () => false), null, '当前任务非等待态');

  const lastTask = {
    ...lesson,
    runtime: { ...lesson.runtime, currentTaskId: 'task-3' },
  };
  assert.equal(canStartPrefetch(lastTask, 'boundary', () => false), null, '末任务无下一任务');

  assert.equal(canStartPrefetch(lesson, 'boundary', (taskId) => taskId === 'task-2'), null, '已有缓存');
});

// ---- renumberSseEvents ----

test('重编号：从 startSequence 起严格递增，事件内容不变', () => {
  const events = makePrefetchEvents();
  const renumbered = renumberSseEvents(events, 42);
  assert.deepEqual(
    renumbered.map((event) => event.sequence),
    [42, 43, 44, 45],
  );
  assert.deepEqual(
    renumbered.map((event) => ({ ...event, sequence: 0 })),
    events.map((event) => ({ ...event, sequence: 0 })),
    '只改 sequence，其余字段不变',
  );
});

// ---- resolvePrefetchConsumption（§10.2 三路径） ----

test('命中：缓存完整且 planId/planVersion/taskId 全匹配 → replay，重编号从 latestSequence+1 起', () => {
  const lesson = makeBoundaryLesson();
  const result = resolvePrefetchConsumption(lesson, makeEntry(), 'task-2');
  assert.equal(result.kind, 'replay');
  if (result.kind !== 'replay') return;
  assert.equal(result.events[0].sequence, lesson.runtime.latestSequence + 1, '重放序号接在既有条目之后');
  assert.equal(result.events.length, 4);
});

test('未命中：无缓存 / 仍在途 → live', () => {
  const lesson = makeBoundaryLesson();
  assert.equal(resolvePrefetchConsumption(lesson, null, 'task-2').kind, 'live');
  assert.equal(resolvePrefetchConsumption(lesson, undefined, 'task-2').kind, 'live');
  assert.equal(
    resolvePrefetchConsumption(lesson, makeEntry({ complete: false }), 'task-2').kind,
    'live',
    '仍在途',
  );
});

test('未命中：taskId / planId / planVersion 任一不匹配 → live，事件绝不写入 streamItems', () => {
  const lesson = makeBoundaryLesson();
  const mismatches = [
    makeEntry({ taskId: 'task-3' }),
    makeEntry({ planId: 'plan-other' }),
    makeEntry({ planVersion: 2 }),
  ];
  for (const entry of mismatches) {
    const result = resolvePrefetchConsumption(lesson, entry, 'task-2');
    assert.equal(result.kind, 'live', `${JSON.stringify({ taskId: entry.taskId, planId: entry.planId, planVersion: entry.planVersion })} 应判 live`);
  }
  // §13：废弃预取不进学习流——lesson 未被任何消费路径改写
  assert.equal(lesson.streamItems.length, makeBoundaryLesson().streamItems.length);
});

// ---- 重放合法性与幂等 ----

test('重放合法性：边界态依序应用重放事件 → 状态链正确、任务完成', () => {
  const lesson = makeBoundaryLesson();
  const result = resolvePrefetchConsumption(lesson, makeEntry(), 'task-2');
  assert.equal(result.kind, 'replay');
  if (result.kind !== 'replay') return;

  let next = lesson;
  for (const event of result.events) {
    next = applyLearningSseEvent(next, event);
  }

  // awaiting_user → learning → awaiting_user 均在转换表内，状态链合法
  assert.equal(next.runtime.status, 'awaiting_user');
  assert.equal(next.runtime.currentTaskId, 'task-2');
  assert.equal(next.runtime.currentTaskStatus, 'awaiting_user');
  assert.deepEqual(next.runtime.completedTaskIds, ['task-1', 'task-2']);

  const item = next.streamItems.find((i) => i.type === 'task_content' && i.taskId === 'task-2');
  assert.ok(item && item.type === 'task_content');
  assert.equal(item.status, 'complete');
  const block = item.blocks[0];
  assert.ok(block && block.type === 'markdown');
  assert.equal(block.markdown, '预取内容');

  // 重放条目排序键严格大于全部既有条目
  const task1Item = next.streamItems.find((i) => i.type === 'task_content' && i.taskId === 'task-1');
  assert.ok(task1Item);
  assert.ok(item.sequence > task1Item.sequence, '重放条目排序键大于既有条目');
});

test('重放幂等：重复应用同一重放序列不产生重复 item', () => {
  const lesson = makeBoundaryLesson();
  const result = resolvePrefetchConsumption(lesson, makeEntry(), 'task-2');
  assert.equal(result.kind, 'replay');
  if (result.kind !== 'replay') return;

  let next = lesson;
  for (const event of result.events) next = applyLearningSseEvent(next, event);
  for (const event of result.events) next = applyLearningSseEvent(next, event);

  const task2Items = next.streamItems.filter((i) => i.type === 'task_content' && i.taskId === 'task-2');
  assert.equal(task2Items.length, 1, '确定性 itemId 保证不重复');
  assert.equal(next.runtime.completedTaskIds.filter((id) => id === 'task-2').length, 1);
});
