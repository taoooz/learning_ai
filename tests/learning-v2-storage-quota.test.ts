// tests/learning-v2-storage-quota.test.ts
// 存储配额兜底（文档 §6.1.1，计划 T5）：
// 写入失败 → 按 index 升序压缩归档「已完成且未归档」的历史章节腾空间 → 重试；
// 候选耗尽才提示用户。用带容量上限的假存储模拟 QuotaExceeded。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  saveNodeLessonV2,
  saveNodeLessonV2WithQuotaFallback,
  trySaveNodeLessonV2,
} from '../lib/learning-v2/storage';
import { archiveCompletedLesson } from '../lib/learning-v2/archive';
import { getV2ChapterStorageKey } from '../lib/storage';

import type {
  ChapterPlan,
  ChapterStatus,
  CourseBlueprintV2,
  GenerationMeta,
  NodeLessonV2,
  PlannedTask,
} from '../types/learning-v2';

// ---- 测试基座 ----

const NOW = 1756700000000;
const META: GenerationMeta = { promptVersion: 'p1', modelVersion: 'm1', generatedAt: NOW };

/** 带容量上限的假存储：总量超限抛错，模拟 localStorage 配额 */
class CapacityStorage {
  private map = new Map<string, string>();
  constructor(public capacity: number) {}
  private used(): number {
    let total = 0;
    for (const value of this.map.values()) total += value.length;
    return total;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    const nextUsed = this.used() - (this.map.get(key)?.length ?? 0) + value.length;
    if (nextUsed > this.capacity) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const sizeOf = (lesson: NodeLessonV2): number => JSON.stringify(lesson).length;
const keyOf = (courseId: string, chapterId: string): string =>
  getV2ChapterStorageKey(courseId, chapterId);

function makeTask(chapterId: string): PlannedTask {
  return {
    taskId: 'task-1',
    order: 0,
    title: `任务 ${chapterId}`,
    objectiveId: 'obj-1',
    taskGoal: `完成任务 ${chapterId}`,
    observableOutcome: `能说明任务 ${chapterId} 的要点`,
    conceptKeys: ['c1'],
    prerequisiteTaskIds: [],
    teachingPattern: 'explain',
    expectedMinutes: 2,
    evidencePolicy: 'none',
    origin: 'initial',
    status: 'planned',
  };
}

function makePlan(chapterId: string): ChapterPlan {
  return {
    chapterId,
    planId: `plan-${chapterId}`,
    planVersion: 1,
    objectiveIds: ['obj-1'],
    tasks: [makeTask(chapterId)],
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    generationMeta: META,
  };
}

/** 构造指定状态/正文大小的 lesson；blockSize 为正文块字符数（0 表示无正文条目） */
function makeLesson(
  chapterId: string,
  status: ChapterStatus,
  blockSize: number,
  archived = false,
): NodeLessonV2 {
  const completed = status === 'completed';
  return {
    protocolVersion: 2,
    chapterId,
    chapterPlan: makePlan(chapterId),
    runtime: {
      status,
      currentTaskId: completed ? null : 'task-1',
      currentTaskStatus: completed ? 'completed' : 'awaiting_user',
      completedTaskIds: completed ? ['task-1'] : [],
      skippedTaskIds: [],
      latestSequence: 1,
      lastActiveAt: NOW,
    },
    streamItems:
      blockSize > 0
        ? [
            {
              itemId: `tc:${chapterId}:task-1:v1`,
              type: 'task_content',
              chapterId,
              taskId: 'task-1',
              planVersion: 1,
              sequence: 1,
              createdAt: NOW,
              status: 'complete',
              title: `任务标题 ${chapterId}`,
              blocks: [{ type: 'markdown', blockId: 'b1', markdown: '正'.repeat(blockSize) }],
              boundaryPrompt: { takeaway: `要点 ${chapterId}` },
            },
          ]
        : [],
    evidence: [],
    archived: archived || undefined,
    updatedAt: NOW,
  };
}

function makeBlueprint(chapterIds: readonly string[]): CourseBlueprintV2 {
  return {
    blueprintId: 'bp-1',
    protocolVersion: 2,
    topic: '测试课程',
    intentType: 'conceptual_understanding',
    targetScenario: '测试',
    learnerStartingPoint: {
      estimatedLevel: 'beginner',
      confirmedKnowledge: [],
      likelyGaps: [],
      excludedTopics: [],
    },
    courseObjectives: [
      {
        objectiveId: 'obj-1',
        description: '目标一',
        observableOutcome: '能说明目标一',
        importance: 'core',
        evidenceRequirement: 'exposure',
        conceptKeys: ['c1'],
      },
    ],
    successCriteria: [],
    chapters: chapterIds.map((chapterId, index) => ({
      chapterId,
      index,
      title: `章节 ${chapterId}`,
      objectiveIds: ['obj-1'],
      prerequisites: index > 0 ? [chapterIds[index - 1]] : [],
      teachingGoal: `掌握 ${chapterId}`,
      completionCriteria: [],
    })),
    createdAt: NOW,
    promptVersion: 'p1',
    modelVersion: 'm1',
  };
}

// ---- trySaveNodeLessonV2：只写不提示 ----

test('trySave：写入失败返回 false 且不抛错', () => {
  const storage = new CapacityStorage(10);
  const lesson = makeLesson('ch-1', 'completed', 1000);
  assert.equal(trySaveNodeLessonV2('course-1', lesson, storage), false);
  assert.equal(storage.getItem(keyOf('course-1', 'ch-1')), null);
});

test('trySave：容量充足返回 true', () => {
  const lesson = makeLesson('ch-1', 'completed', 100);
  const storage = new CapacityStorage(sizeOf(lesson) + 100);
  assert.equal(trySaveNodeLessonV2('course-1', lesson, storage), true);
});

test('saveNodeLessonV2：失败返回 false（无 window 时通知 no-op，不抛错）', () => {
  const storage = new CapacityStorage(10);
  const lesson = makeLesson('ch-1', 'completed', 1000);
  assert.equal(saveNodeLessonV2('course-1', lesson, storage), false);
});

// ---- saveNodeLessonV2WithQuotaFallback ----

test('容量充足：直接保存成功，不动任何历史章节', () => {
  const ch1 = makeLesson('ch-1', 'completed', 3000);
  const ch2 = makeLesson('ch-2', 'awaiting_user', 3000);
  const storage = new CapacityStorage(sizeOf(ch1) + sizeOf(ch2) + 1000);
  storage.setItem(keyOf('course-1', 'ch-1'), JSON.stringify(ch1));

  const result = saveNodeLessonV2WithQuotaFallback(
    'course-1',
    ch2,
    makeBlueprint(['ch-1', 'ch-2']),
    storage,
    NOW,
  );

  assert.equal(result.saved, true);
  assert.deepEqual(result.archivedChapterIds, []);
  assert.equal(storage.getItem(keyOf('course-1', 'ch-1')), JSON.stringify(ch1), '历史章节原样');
});

test('配额不足：压缩归档最早的已完成章节腾出空间后保存成功', () => {
  const ch1 = makeLesson('ch-1', 'completed', 3000);
  const ch2 = makeLesson('ch-2', 'awaiting_user', 3000);
  // 容量放得下「归档后的 ch-1 + 完整 ch-2」，放不下「完整 ch-1 + 完整 ch-2」
  const archivedCh1Size = sizeOf(archiveCompletedLesson(ch1, NOW));
  const storage = new CapacityStorage(archivedCh1Size + sizeOf(ch2) + 200);
  storage.setItem(keyOf('course-1', 'ch-1'), JSON.stringify(ch1));

  const result = saveNodeLessonV2WithQuotaFallback(
    'course-1',
    ch2,
    makeBlueprint(['ch-1', 'ch-2']),
    storage,
    NOW,
  );

  assert.equal(result.saved, true);
  assert.deepEqual(result.archivedChapterIds, ['ch-1']);

  const storedCh1 = JSON.parse(storage.getItem(keyOf('course-1', 'ch-1'))!) as NodeLessonV2;
  assert.equal(storedCh1.archived, true, 'ch-1 被标记归档');
  const task1 = storedCh1.streamItems.find((i) => i.type === 'task_content');
  assert.ok(task1 && task1.type === 'task_content');
  assert.equal(task1.blocks.length, 1, '正文压缩为单条摘要块');

  const storedCh2 = JSON.parse(storage.getItem(keyOf('course-1', 'ch-2'))!) as NodeLessonV2;
  assert.equal(storedCh2.archived, undefined, '当前章节完整保留不归档');
});

test('候选按 index 升序遍历：腾出一个章节即停，后面的章节不动', () => {
  const ch1 = makeLesson('ch-1', 'completed', 3000);
  const ch2 = makeLesson('ch-2', 'completed', 3000);
  const ch3 = makeLesson('ch-3', 'awaiting_user', 3000);
  const archivedCh1Size = sizeOf(archiveCompletedLesson(ch1, NOW));
  // 只归档 ch-1 就够；若连 ch-2 也归档会浪费但不应发生
  const storage = new CapacityStorage(archivedCh1Size + sizeOf(ch2) + sizeOf(ch3) + 200);
  storage.setItem(keyOf('course-1', 'ch-1'), JSON.stringify(ch1));
  storage.setItem(keyOf('course-1', 'ch-2'), JSON.stringify(ch2));

  const result = saveNodeLessonV2WithQuotaFallback(
    'course-1',
    ch3,
    makeBlueprint(['ch-1', 'ch-2', 'ch-3']),
    storage,
    NOW,
  );

  assert.equal(result.saved, true);
  assert.deepEqual(result.archivedChapterIds, ['ch-1']);
  const storedCh2 = JSON.parse(storage.getItem(keyOf('course-1', 'ch-2'))!) as NodeLessonV2;
  assert.equal(storedCh2.archived, undefined, 'ch-2 未被触碰');
});

test('候选过滤：已归档与未完成章节不参与压缩', () => {
  const ch1 = makeLesson('ch-1', 'completed', 3000, true); // 已归档 → 跳过
  const ch2 = makeLesson('ch-2', 'awaiting_user', 3000); // 未完成 → 跳过
  const ch3 = makeLesson('ch-3', 'awaiting_user', 3000);
  const storage = new CapacityStorage(sizeOf(ch1) + 100); // 装不下 ch-3
  storage.setItem(keyOf('course-1', 'ch-1'), JSON.stringify(ch1));

  const result = saveNodeLessonV2WithQuotaFallback(
    'course-1',
    ch3,
    makeBlueprint(['ch-1', 'ch-2', 'ch-3']),
    storage,
    NOW,
  );

  assert.equal(result.saved, false);
  assert.deepEqual(result.archivedChapterIds, []);
  assert.equal(storage.getItem(keyOf('course-1', 'ch-1')), JSON.stringify(ch1), '已归档章节不被二次处理');
});

test('当前章节自身不是候选：即使已存旧数据也不压缩', () => {
  const oldCh1 = makeLesson('ch-1', 'completed', 3000);
  // 新数据明显更大：同键覆盖的净增量也超出容量，但旧数据不应被当作候选压缩
  const newCh1 = makeLesson('ch-1', 'awaiting_user', 6000);
  const storage = new CapacityStorage(sizeOf(oldCh1) + 100);
  storage.setItem(keyOf('course-1', 'ch-1'), JSON.stringify(oldCh1));

  const result = saveNodeLessonV2WithQuotaFallback(
    'course-1',
    newCh1,
    makeBlueprint(['ch-1']),
    storage,
    NOW,
  );

  assert.equal(result.saved, false);
  assert.deepEqual(result.archivedChapterIds, []);
  assert.equal(storage.getItem(keyOf('course-1', 'ch-1')), JSON.stringify(oldCh1), '旧数据原样保留');
});

test('候选耗尽仍写不进：返回失败（通知在无 window 环境 no-op）', () => {
  const ch1 = makeLesson('ch-1', 'completed', 3000);
  const ch2 = makeLesson('ch-2', 'awaiting_user', 3000);
  // 先以大容量预置数据，再缩到连归档版都写不进的极小容量
  const storage = new CapacityStorage(sizeOf(ch1) + 100);
  storage.setItem(keyOf('course-1', 'ch-1'), JSON.stringify(ch1));
  storage.capacity = 50;

  const result = saveNodeLessonV2WithQuotaFallback(
    'course-1',
    ch2,
    makeBlueprint(['ch-1', 'ch-2']),
    storage,
    NOW,
  );

  assert.equal(result.saved, false);
  assert.deepEqual(result.archivedChapterIds, []);
});
