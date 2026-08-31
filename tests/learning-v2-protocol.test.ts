import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAPTER_TRANSITIONS,
  TASK_STATUS_TRANSITIONS,
  canTransitionChapter,
  canTransitionTask,
  transitionChapter,
  transitionTask,
} from '../lib/learning-v2/state-machine';
import {
  validateCourseBlueprintV2,
  validateChapterPlan,
  PLAN_VALIDATION_CODES,
} from '../lib/learning-v2/validators';
import {
  createInitialNodeLessonV2,
  createInitialRuntime,
  applyLearningSseEvent,
  applyChapterRecap,
  appendSystemNotice,
  taskContentItemId,
  chapterRecapItemId,
} from '../lib/learning-v2/reducers';
import {
  buildChapterPlanIdempotencyKey,
  buildTaskAttemptIdempotencyKey,
  buildChapterCompleteIdempotencyKey,
  IdempotencyRegistry,
} from '../lib/learning-v2/idempotency';
import {
  deriveCourseTreeViewV2,
  createStoredCourseV2,
  findStoredCourseV2,
  upsertStoredCourseV2List,
  saveNodeLessonV2,
  loadNodeLessonV2,
  deleteNodeLessonV2,
} from '../lib/learning-v2/storage';
import { detectProtocolVersion, resolveStoredCourseFromData } from '../lib/learning-v2/dispatch';
import { isV2LearningEnabled, setV2LearningEnabled } from '../lib/learning-v2/feature-flag';
import { getV2ChapterStorageKey } from '../lib/storage';

import type { StoredCourseBundle, StoredDataV2 } from '../types/course';
import type {
  ChapterDefinition,
  ChapterPlan,
  ChapterRecap,
  CourseBlueprintV2,
  GenerationMeta,
  LearningSseEvent,
  NodeLessonV2,
  PlannedTask,
  StoredCourseV2,
} from '../types/learning-v2';

// ---- 测试基座 ----

type MemoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function createMemoryStorage(): MemoryStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** 安装 window/localStorage 全局（课程级持久化与 Feature Flag 需要），返回还原函数 */
function installBrowserGlobals(): () => void {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
  const g = globalThis as Record<string, unknown>;
  const hadWindow = 'window' in g;
  const hadLocalStorage = 'localStorage' in g;
  const prevWindow = g.window;
  const prevLocalStorage = g.localStorage;
  g.localStorage = storage;
  g.window = { localStorage: storage, dispatchEvent: () => true };
  return () => {
    if (hadWindow) g.window = prevWindow;
    else delete g.window;
    if (hadLocalStorage) g.localStorage = prevLocalStorage;
    else delete g.localStorage;
  };
}

const META: GenerationMeta = { promptVersion: 'p1', modelVersion: 'm1', generatedAt: 1000 };

function makeBlueprint(overrides: Partial<CourseBlueprintV2> = {}): CourseBlueprintV2 {
  return {
    blueprintId: 'bp-1',
    protocolVersion: 2,
    topic: 'React 状态管理',
    intentType: 'conceptual_understanding',
    targetScenario: '前端开发',
    learnerStartingPoint: {
      estimatedLevel: 'beginner',
      confirmedKnowledge: [],
      likelyGaps: [],
      excludedTopics: [],
    },
    courseObjectives: [
      {
        objectiveId: 'obj-1',
        description: '理解 useState',
        observableOutcome: '能独立用 useState 实现计数器',
        importance: 'core',
        evidenceRequirement: 'demonstration',
        conceptKeys: ['useState'],
      },
    ],
    successCriteria: ['能独立写出计数器'],
    chapters: [
      {
        chapterId: 'ch-1',
        index: 0,
        title: 'useState 入门',
        objectiveIds: ['obj-1'],
        prerequisites: [],
        teachingGoal: '掌握 useState',
        completionCriteria: ['能写计数器'],
      },
      {
        chapterId: 'ch-2',
        index: 1,
        title: 'useReducer 进阶',
        objectiveIds: ['obj-1'],
        prerequisites: ['ch-1'],
        teachingGoal: '掌握 useReducer',
        completionCriteria: ['能写 reducer'],
      },
    ],
    createdAt: 1000,
    promptVersion: 'p1',
    modelVersion: 'm1',
    ...overrides,
  };
}

function makeTask(overrides: Partial<PlannedTask> = {}): PlannedTask {
  return {
    taskId: 'task-1',
    order: 0,
    title: '认识 useState',
    objectiveId: 'obj-1',
    taskGoal: '理解 useState 的用法',
    observableOutcome: '能写出一个计数器',
    conceptKeys: ['useState'],
    prerequisiteTaskIds: [],
    teachingPattern: 'explain',
    expectedMinutes: 5,
    evidencePolicy: 'none',
    origin: 'initial',
    status: 'planned',
    ...overrides,
  };
}

function makePlan(overrides: Partial<ChapterPlan> = {}): ChapterPlan {
  return {
    chapterId: 'ch-1',
    planId: 'plan-1',
    planVersion: 1,
    objectiveIds: ['obj-1'],
    tasks: [
      makeTask({ taskId: 'task-1', order: 0 }),
      makeTask({ taskId: 'task-2', order: 1, title: '练习 useState', teachingPattern: 'practice' }),
      makeTask({ taskId: 'task-3', order: 2, title: '对比 useState 与 class state', teachingPattern: 'compare' }),
    ],
    status: 'active',
    createdAt: 1000,
    updatedAt: 1000,
    generationMeta: META,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<LearningSseEvent> = {}): LearningSseEvent {
  return {
    eventId: 'evt-1',
    requestId: 'req-1',
    type: 'task_started',
    courseId: 'course-1',
    chapterId: 'ch-1',
    planVersion: 1,
    sequence: 1,
    timestamp: 2000,
    payload: {},
    ...overrides,
  };
}

// ---- 状态机 ----

test('chapter state machine allows all documented legal transitions', () => {
  const legal: Array<[keyof typeof CHAPTER_TRANSITIONS, string]> = [
    ['not_started', 'planning'],
    ['planning', 'learning'],
    ['learning', 'learning'],
    ['learning', 'awaiting_user'],
    ['awaiting_user', 'learning'],
    ['awaiting_user', 'checking'],
    ['awaiting_user', 'completing'],
    ['checking', 'remediating'],
    ['checking', 'awaiting_user'],
    ['remediating', 'awaiting_user'],
    ['completing', 'completed'],
  ];
  for (const [from, to] of legal) {
    assert.ok(canTransitionChapter(from as never, to as never), `${from} -> ${to} should be legal`);
  }
});

test('chapter state machine rejects illegal transitions', () => {
  assert.equal(canTransitionChapter('not_started', 'learning'), false);
  assert.equal(canTransitionChapter('not_started', 'completed'), false);
  assert.equal(canTransitionChapter('learning', 'completed'), false);
  assert.equal(canTransitionChapter('completed', 'learning'), false);
  assert.equal(canTransitionChapter('completed', 'completed'), false);
});

test('transitionChapter updates status on legal transition and rejects illegal', () => {
  const runtime = createInitialRuntime(1000);
  const toPlanning = transitionChapter(runtime, 'planning', 1500);
  assert.equal(toPlanning.ok, true);
  if (toPlanning.ok) {
    assert.equal(toPlanning.runtime.status, 'planning');
    assert.equal(toPlanning.runtime.lastActiveAt, 1500);
  }

  const illegal = transitionChapter(runtime, 'completed', 1500);
  assert.equal(illegal.ok, false);
  assert.match(illegal.ok === false ? illegal.reason : '', /非法章节状态转换/);
});

test('task state machine supports partial_paused recovery and failed retry', () => {
  assert.ok(canTransitionTask('streaming', 'partial_paused'));
  assert.ok(canTransitionTask('partial_paused', 'streaming'));
  assert.ok(canTransitionTask('failed', 'generating'));
  assert.ok(canTransitionTask('awaiting_user', 'completed'));
  assert.equal(canTransitionTask('streaming', 'completed'), false);
  assert.equal(canTransitionTask('completed', 'streaming'), false);
});

test('transitionTask updates currentTaskStatus and rejects illegal', () => {
  const runtime = { ...createInitialRuntime(1000), currentTaskStatus: 'generating' as const };
  const ok = transitionTask(runtime, 'streaming', 1200);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.runtime.currentTaskStatus, 'streaming');

  const bad = transitionTask(runtime, 'completed', 1200);
  assert.equal(bad.ok, false);
});

test('task transition table exposes all eight current task statuses', () => {
  assert.equal(Object.keys(TASK_STATUS_TRANSITIONS).length, 8);
});

// ---- 蓝图校验 ----

test('valid blueprint passes validation', () => {
  const result = validateCourseBlueprintV2(makeBlueprint());
  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test('blueprint without core objective fails', () => {
  const blueprint = makeBlueprint({
    courseObjectives: [
      {
        objectiveId: 'obj-1',
        description: 'x',
        observableOutcome: '能做出东西',
        importance: 'supporting',
        evidenceRequirement: 'exposure',
        conceptKeys: [],
      },
    ],
  });
  const result = validateCourseBlueprintV2(blueprint);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes('core')));
});

test('blueprint detects duplicate objective and chapter ids', () => {
  const blueprint = makeBlueprint({
    courseObjectives: [
      {
        objectiveId: 'obj-1',
        description: 'a',
        observableOutcome: '能做出计数器',
        importance: 'core',
        evidenceRequirement: 'demonstration',
        conceptKeys: [],
      },
      {
        objectiveId: 'obj-1',
        description: 'b',
        observableOutcome: '能做出表单',
        importance: 'supporting',
        evidenceRequirement: 'exposure',
        conceptKeys: [],
      },
    ],
  });
  const result = validateCourseBlueprintV2(blueprint);
  assert.ok(result.issues.some((issue) => issue.includes('课程目标 ID 重复')));
});

test('blueprint detects prerequisite cycle', () => {
  const chapters: ChapterDefinition[] = [
    { chapterId: 'a', index: 0, title: 'A', objectiveIds: ['obj-1'], prerequisites: ['b'], teachingGoal: '', completionCriteria: [] },
    { chapterId: 'b', index: 1, title: 'B', objectiveIds: ['obj-1'], prerequisites: ['a'], teachingGoal: '', completionCriteria: [] },
  ];
  const result = validateCourseBlueprintV2(makeBlueprint({ chapters }));
  assert.ok(result.issues.some((issue) => issue.includes('循环')));
});

test('blueprint flags vague observableOutcome', () => {
  const blueprint = makeBlueprint({
    courseObjectives: [
      {
        objectiveId: 'obj-1',
        description: 'x',
        observableOutcome: '深入理解',
        importance: 'core',
        evidenceRequirement: 'exposure',
        conceptKeys: [],
      },
    ],
  });
  const result = validateCourseBlueprintV2(blueprint);
  assert.ok(result.issues.some((issue) => issue.includes('空泛描述')));
});

// ---- 章节计划校验 ----

test('valid chapter plan passes', () => {
  const result = validateChapterPlan(makePlan());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('chapter plan detects duplicate task id and objective not covered', () => {
  const plan = makePlan({
    objectiveIds: ['obj-1', 'obj-2'],
    tasks: [makeTask({ taskId: 'task-1', order: 0 }), makeTask({ taskId: 'task-1', order: 1 })],
  });
  const result = validateChapterPlan(plan);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === PLAN_VALIDATION_CODES.DUPLICATE_TASK_ID));
  assert.ok(result.errors.some((e) => e.code === PLAN_VALIDATION_CODES.OBJECTIVE_NOT_COVERED));
});

test('chapter plan detects task prerequisite cycle', () => {
  const plan = makePlan({
    tasks: [
      makeTask({ taskId: 't1', order: 0, prerequisiteTaskIds: ['t2'] }),
      makeTask({ taskId: 't2', order: 1, prerequisiteTaskIds: ['t1'] }),
      makeTask({ taskId: 't3', order: 2 }),
    ],
  });
  const result = validateChapterPlan(plan);
  assert.ok(result.errors.some((e) => e.code === PLAN_VALIDATION_CODES.PREREQ_CYCLE));
});

test('chapter plan warns on out-of-range task count and single teaching pattern', () => {
  const twoSamePattern = makePlan({
    tasks: [makeTask({ taskId: 'a', order: 0 }), makeTask({ taskId: 'b', order: 1 })],
  });
  const result = validateChapterPlan(twoSamePattern);
  assert.ok(result.warnings.some((w) => w.code === PLAN_VALIDATION_CODES.TASK_COUNT_OUT_OF_RANGE));
  assert.ok(result.warnings.some((w) => w.code === PLAN_VALIDATION_CODES.SINGLE_TEACHING_PATTERN));
});

test('chapter plan checks objective coverage against chapter when provided', () => {
  const chapter: ChapterDefinition = {
    chapterId: 'ch-1',
    index: 0,
    title: 'useState 入门',
    objectiveIds: ['obj-1', 'obj-missing'],
    prerequisites: [],
    teachingGoal: '',
    completionCriteria: [],
  };
  const result = validateChapterPlan(makePlan(), chapter);
  assert.ok(result.errors.some((e) => e.code === PLAN_VALIDATION_CODES.CHAPTER_OBJECTIVE_MISSING));
});

// ---- reducer：初始化与守卫 ----

test('createInitialNodeLessonV2 creates a serializable empty shell', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  assert.equal(lesson.protocolVersion, 2);
  assert.equal(lesson.chapterId, 'ch-1');
  assert.equal(lesson.runtime.status, 'planning');
  assert.deepEqual(lesson.streamItems, []);
  assert.deepEqual(lesson.evidence, []);
  // 可序列化/反序列化无损
  const restored = JSON.parse(JSON.stringify(lesson)) as NodeLessonV2;
  assert.deepEqual(restored, lesson);
});

test('applyLearningSseEvent rejects chapterId mismatch', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  const event = makeEvent({ chapterId: 'ch-other' });
  assert.equal(applyLearningSseEvent(lesson, event), lesson);
});

test('applyLearningSseEvent rejects planVersion mismatch', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  const event = makeEvent({ planVersion: 99 });
  assert.equal(applyLearningSseEvent(lesson, event), lesson);
});

// ---- reducer：任务流 ----

test('task_started creates a streaming task_content and transitions chapter to learning', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  const next = applyLearningSseEvent(
    lesson,
    makeEvent({ type: 'task_started', taskId: 'task-1', payload: { taskId: 'task-1', title: '认识 useState' } }),
  );
  assert.equal(next.runtime.status, 'learning');
  assert.equal(next.runtime.currentTaskId, 'task-1');
  assert.equal(next.runtime.currentTaskStatus, 'streaming');
  assert.equal(next.streamItems.length, 1);
  assert.equal(next.streamItems[0].type, 'task_content');
  assert.equal(next.runtime.pendingRequest?.requestId, 'req-1');
});

test('re-applying the same task_started is idempotent (no duplicate items)', () => {
  const event = makeEvent({ type: 'task_started', taskId: 'task-1', payload: { taskId: 'task-1', title: 'T' } });
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  lesson = applyLearningSseEvent(lesson, event);
  lesson = applyLearningSseEvent(lesson, event);
  assert.equal(lesson.streamItems.length, 1);
  assert.equal(lesson.streamItems.filter((i) => i.itemId === taskContentItemId('task-1', 1)).length, 1);
});

test('markdown content blocks accumulate deltas by blockId', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'task_started', taskId: 'task-1', sequence: 1, payload: { taskId: 'task-1', title: 'T' } }));
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({ type: 'content_block_started', taskId: 'task-1', sequence: 2, payload: { blockId: 'b1', blockType: 'markdown' } }),
  );
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({ type: 'content_block_delta', taskId: 'task-1', sequence: 3, payload: { blockId: 'b1', delta: 'Hello ' } }),
  );
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({ type: 'content_block_delta', taskId: 'task-1', sequence: 4, payload: { blockId: 'b1', delta: 'World' } }),
  );

  const item = lesson.streamItems.find((i) => i.type === 'task_content');
  assert.ok(item && item.type === 'task_content');
  const block = item.blocks.find((b) => b.blockId === 'b1');
  assert.ok(block && block.type === 'markdown');
  assert.equal(block.type === 'markdown' ? block.markdown : '', 'Hello World');
});

test('task_completed finalizes item, records completedTaskIds, transitions to awaiting_user', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'task_started', taskId: 'task-1', sequence: 1, payload: { taskId: 'task-1', title: 'T' } }));
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'task_completed',
      taskId: 'task-1',
      sequence: 2,
      payload: {
        task: {
          taskId: 'task-1',
          planVersion: 1,
          title: '认识 useState',
          blocks: [{ type: 'markdown', blockId: 'b1', markdown: '完成内容' }],
          boundaryPrompt: { takeaway: '要点' },
          generationMeta: META,
        },
      },
    }),
  );
  assert.equal(lesson.runtime.status, 'awaiting_user');
  assert.deepEqual(lesson.runtime.completedTaskIds, ['task-1']);
  const item = lesson.streamItems.find((i) => i.itemId === taskContentItemId('task-1', 1));
  assert.ok(item && item.type === 'task_content');
  assert.equal(item.status, 'complete');
});

test('task_started after a completed task records a task_transition item', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'task_started', taskId: 'task-1', sequence: 1, payload: { taskId: 'task-1', title: 'A' } }));
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'task_completed',
      taskId: 'task-1',
      sequence: 2,
      payload: {
        task: { taskId: 'task-1', planVersion: 1, title: 'A', blocks: [], boundaryPrompt: {}, generationMeta: META },
      },
    }),
  );
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'task_started', taskId: 'task-2', sequence: 3, payload: { taskId: 'task-2', title: 'B' } }));

  const transition = lesson.streamItems.find((i) => i.type === 'task_transition');
  assert.ok(transition && transition.type === 'task_transition');
  assert.equal(transition.fromTaskId, 'task-1');
  assert.equal(transition.toTaskId, 'task-2');
});

// ---- reducer：通用事件 ----

test('request_error marks streaming task failed and appends an error notice', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'task_started', taskId: 'task-1', sequence: 1, payload: { taskId: 'task-1', title: 'T' } }));
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'request_error',
      taskId: 'task-1',
      sequence: 2,
      payload: { code: 'E_LLM', message: '生成失败', retryable: true },
    }),
  );
  assert.equal(lesson.runtime.currentTaskStatus, 'failed');
  const item = lesson.streamItems.find((i) => i.itemId === taskContentItemId('task-1', 1));
  assert.ok(item && item.type === 'task_content');
  assert.equal(item.status, 'failed');
  const notice = lesson.streamItems.find((i) => i.type === 'system_notice');
  assert.ok(notice && notice.type === 'system_notice');
  assert.equal(notice.tone, 'error');
});

test('retrying a failed task resets half-written blocks instead of appending (§10.2, 缺陷 A)', () => {
  // 首次流式：部分内容写入固定 blockId "b1" 后流中断失败
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'task_started', taskId: 'task-1', sequence: 1, requestId: 'req-1', payload: { taskId: 'task-1', title: 'T' } }));
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'content_block_started', taskId: 'task-1', sequence: 2, payload: { blockId: 'b1', blockType: 'markdown' } }));
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'content_block_delta', taskId: 'task-1', sequence: 3, payload: { blockId: 'b1', delta: '半截内容' } }));
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'request_error', taskId: 'task-1', sequence: 4, payload: { code: 'E_LLM', message: '生成失败', retryable: true } }));

  // 新 attempt 重试：task_started 必须清空半截块，新 delta 不得拼到旧内容上
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'task_started', taskId: 'task-1', sequence: 5, requestId: 'req-2', payload: { taskId: 'task-1', title: 'T' } }));
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'content_block_started', taskId: 'task-1', sequence: 6, requestId: 'req-2', payload: { blockId: 'b1', blockType: 'markdown' } }));
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'content_block_delta', taskId: 'task-1', sequence: 7, requestId: 'req-2', payload: { blockId: 'b1', delta: '全新内容' } }));

  const item = lesson.streamItems.find((i) => i.itemId === taskContentItemId('task-1', 1));
  assert.ok(item && item.type === 'task_content');
  const block = item.blocks.find((b) => b.blockId === 'b1');
  assert.ok(block && block.type === 'markdown');
  assert.equal(block.markdown, '全新内容', '重试内容不得拼接半截旧块');
  assert.equal(item.blocks.length, 1, '不得残留旧块');
  assert.ok(lesson.streamItems.some((i) => i.type === 'system_notice' && i.tone === 'error'), '失败通知保留');
  assert.equal(lesson.streamItems.filter((i) => i.itemId === taskContentItemId('task-1', 1)).length, 1);

  // 终态干净：task_completed 全量替换后为完整内容
  lesson = applyLearningSseEvent(
    lesson,
    makeEvent({
      type: 'task_completed',
      taskId: 'task-1',
      sequence: 8,
      requestId: 'req-2',
      payload: {
        task: {
          taskId: 'task-1',
          planVersion: 1,
          title: 'T',
          blocks: [{ type: 'markdown', blockId: 'b1', markdown: '完整内容' }],
          boundaryPrompt: {},
          generationMeta: META,
        },
      },
    }),
  );
  const finalItem = lesson.streamItems.find((i) => i.itemId === taskContentItemId('task-1', 1));
  assert.ok(finalItem && finalItem.type === 'task_content');
  assert.equal(finalItem.status, 'complete');
  const finalBlock = finalItem.blocks[0];
  assert.ok(finalBlock && finalBlock.type === 'markdown');
  assert.equal(finalBlock.markdown, '完整内容');
});

test('request_warning appends a warning notice and advances sequence monotonically', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'request_warning', sequence: 5, payload: { code: 'W1', message: '注意' } }));
  const afterFirst = lesson.runtime.latestSequence;
  assert.ok(afterFirst >= 5, 'latestSequence 应推进到不小于事件 sequence');
  // 再来一个更小的 sequence，latestSequence 不得回退
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'request_warning', sequence: 3, payload: { code: 'W2', message: '再注意' } }));
  assert.ok(lesson.runtime.latestSequence >= afterFirst, 'latestSequence 不得回退');
  assert.equal(lesson.streamItems.filter((i) => i.type === 'system_notice').length, 2);
});

test('request_completed clears matching pendingRequest only', () => {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'task_started', taskId: 'task-1', sequence: 1, requestId: 'req-A', payload: { taskId: 'task-1', title: 'T' } }));
  assert.ok(lesson.runtime.pendingRequest);
  lesson = applyLearningSseEvent(lesson, makeEvent({ type: 'request_completed', sequence: 2, requestId: 'req-A', payload: { requestId: 'req-A' } }));
  assert.equal(lesson.runtime.pendingRequest, undefined);
});

test('appendSystemNotice works without an SSE event and increments sequence', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  const next = appendSystemNotice(lesson, { tone: 'info', message: '本地提示' }, 1500);
  assert.equal(next.runtime.latestSequence, lesson.runtime.latestSequence + 1);
  const notice = next.streamItems.at(-1);
  assert.ok(notice && notice.type === 'system_notice');
  assert.equal(notice.message, '本地提示');
});

test('applyChapterRecap is idempotent and does not drift sequence on re-apply', () => {
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  const recap: ChapterRecap = {
    chapterId: 'ch-1',
    keyTakeaways: ['要点一', '要点二'],
    demonstratedObjectives: [],
    fragileObjectives: [],
    unresolvedQuestions: [],
    degraded: true,
  };

  const once = applyChapterRecap(lesson, recap, 1500);
  assert.deepEqual(once.recap, recap, 'recap 写入 lesson.recap');
  assert.equal(once.runtime.latestSequence, lesson.runtime.latestSequence + 1);
  const recapItems = once.streamItems.filter((item) => item.itemId === chapterRecapItemId('ch-1'));
  assert.equal(recapItems.length, 1, '只产生一条 recap 条目');
  const recapItem = recapItems[0];
  assert.ok(recapItem && recapItem.type === 'chapter_recap');
  assert.equal(recapItem.status, 'complete');
  assert.deepEqual(recapItem.recap, recap);

  // 重入（网络重试等）复用既有 sequence，不产生重复条目、序号不漂移
  const twice = applyChapterRecap(once, recap, 1600);
  assert.equal(twice.runtime.latestSequence, once.runtime.latestSequence);
  assert.equal(
    twice.streamItems.filter((item) => item.itemId === chapterRecapItemId('ch-1')).length,
    1,
  );
});

// ---- 幂等 ----

test('idempotency key builders are stable and distinct', () => {
  assert.equal(buildChapterPlanIdempotencyKey('c', 'ch', 'bp'), 'plan:c:ch:bp');
  assert.equal(buildTaskAttemptIdempotencyKey('c', 'ch', 'p', 2, 't', 1), 'task:c:ch:p:v2:t:a1');
  assert.equal(buildChapterCompleteIdempotencyKey('c', 'ch', 'p', 2), 'complete:c:ch:p:v2');
});

test('IdempotencyRegistry returns existing result for same key and calls create once', async () => {
  const registry = new IdempotencyRegistry<{ id: number }>();
  let calls = 0;
  const create = async () => {
    calls += 1;
    return { id: calls };
  };
  const first = await registry.run('key-a', create);
  const second = await registry.run('key-a', create);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(registry.has('key-a'), true);
  assert.equal(registry.has('key-b'), false);
});

// ---- 存储：课程级（纯函数 + 树视图） ----

test('deriveCourseTreeViewV2 marks first chapter available and dependent locked', () => {
  const tree = deriveCourseTreeViewV2('course-1', makeBlueprint());
  assert.equal(tree.totalChapters, 2);
  assert.equal(tree.chapters[0].status, 'available');
  assert.equal(tree.chapters[1].status, 'locked');
});

test('deriveCourseTreeViewV2 marks completed chapters and unlocks dependents', () => {
  const tree = deriveCourseTreeViewV2('course-1', makeBlueprint(), ['ch-1']);
  assert.equal(tree.chapters[0].status, 'completed');
  assert.equal(tree.chapters[1].status, 'available');
});

test('createStoredCourseV2 + find/upsert behave as pure functions', () => {
  const course = createStoredCourseV2('course-1', makeBlueprint(), 1000);
  assert.equal(course.courseId, 'course-1');
  assert.equal(course.createdAt, 1000);
  assert.equal(course.blueprint.protocolVersion, 2);

  assert.equal(findStoredCourseV2([course], 'course-1'), course);
  assert.equal(findStoredCourseV2([course], 'missing'), null);

  const updated = { ...course, createdAt: 2000 };
  const upserted = upsertStoredCourseV2List([course], updated);
  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].createdAt, 2000);
});

// ---- 存储：章节级（可注入存储，真实 round-trip） ----

test('saveNodeLessonV2 + loadNodeLessonV2 round-trip via injected storage', () => {
  const storage = createMemoryStorage();
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  assert.equal(saveNodeLessonV2('course-1', lesson, storage), true);
  const restored = loadNodeLessonV2('course-1', 'ch-1', storage);
  assert.deepEqual(restored, lesson);
});

test('loadNodeLessonV2 rejects wrong chapterId, wrong protocolVersion, and corrupted JSON', () => {
  const storage = createMemoryStorage();
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  saveNodeLessonV2('course-1', lesson, storage);

  assert.equal(loadNodeLessonV2('course-1', 'ch-other', storage), null);

  // 协议版本不符
  const bad = { ...lesson, protocolVersion: 1 };
  saveNodeLessonV2('course-1', bad as unknown as NodeLessonV2, storage);
  assert.equal(loadNodeLessonV2('course-1', 'ch-1', storage), null);

  // 数据损坏：向真实存储 key 写入损坏 JSON，load 应返回 null
  saveNodeLessonV2('course-1', lesson, storage);
  storage.setItem(getV2ChapterStorageKey('course-1', 'ch-1'), '{not json');
  assert.equal(loadNodeLessonV2('course-1', 'ch-1', storage), null);
});

test('deleteNodeLessonV2 removes the stored lesson', () => {
  const storage = createMemoryStorage();
  const lesson = createInitialNodeLessonV2('ch-1', makePlan(), 1000);
  saveNodeLessonV2('course-1', lesson, storage);
  deleteNodeLessonV2('course-1', 'ch-1', storage);
  assert.equal(loadNodeLessonV2('course-1', 'ch-1', storage), null);
});

// ---- 分发 ----

test('detectProtocolVersion treats only explicit protocolVersion 2 as V2', () => {
  assert.equal(detectProtocolVersion({ protocolVersion: 2 }), 2);
  assert.equal(detectProtocolVersion({ protocolVersion: 1 }), 1);
  assert.equal(detectProtocolVersion({}), 1);
  assert.equal(detectProtocolVersion(null), 1);
  assert.equal(detectProtocolVersion('str'), 1);
  assert.equal(detectProtocolVersion(undefined), 1);
});

test('resolveStoredCourseFromData prefers V2, falls back to V1, returns null when absent', () => {
  const v2Course: StoredCourseV2 = createStoredCourseV2('course-1', makeBlueprint(), 1000);
  const v1Course: StoredCourseBundle = {
    blueprint: { courseId: 'course-legacy', topic: 'Old', learnerPositioning: { estimatedLevel: 'beginner' }, courseGoal: '', globalConcepts: [], nodes: [] },
    treeView: { courseId: 'course-legacy', topic: 'Old', courseGoal: '', totalNodes: 0, nodes: [] },
    lessons: {},
  };
  const data: StoredDataV2 = {
    courses: [v1Course],
    currentCourseId: null,
    courseProgress: {},
    userProfile: null,
    recommendations: [],
    v2Courses: [v2Course],
  };

  const v2 = resolveStoredCourseFromData(data, 'course-1');
  assert.ok(v2 && v2.protocol === 2);
  const v1 = resolveStoredCourseFromData(data, 'course-legacy');
  assert.ok(v1 && v1.protocol === 1);
  assert.equal(resolveStoredCourseFromData(data, 'missing'), null);
});

// ---- Feature Flag ----

test('feature flag defaults to disabled without browser globals', () => {
  assert.equal(isV2LearningEnabled(), false);
});

test('feature flag round-trips when browser globals are present', () => {
  const restore = installBrowserGlobals();
  try {
    assert.equal(isV2LearningEnabled(), false);
    setV2LearningEnabled(true);
    assert.equal(isV2LearningEnabled(), true);
    setV2LearningEnabled(false);
    assert.equal(isV2LearningEnabled(), false);
  } finally {
    restore();
  }
});
