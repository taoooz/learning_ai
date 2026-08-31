// tests/learning-v2-archive.test.ts
// 已完成章节压缩归档（文档 §6.1.1，计划 T1）：
// 三级兜底摘要、非正文条目保留、二次归档幂等

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialNodeLessonV2, applyChapterRecap, appendSystemNotice } from '../lib/learning-v2/reducers';
import { archiveCompletedLesson, summarizeTaskContent } from '../lib/learning-v2/archive';

import type {
  ChapterPlan,
  ChapterRecap,
  GenerationMeta,
  NodeLessonV2,
  PlannedTask,
  TaskContentItem,
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

function makeTaskContentItem(overrides: Partial<TaskContentItem> = {}): TaskContentItem {
  return {
    itemId: 'tc:task-1:v1',
    type: 'task_content',
    chapterId: 'ch-1',
    taskId: 'task-1',
    planVersion: 1,
    sequence: 1,
    createdAt: NOW,
    status: 'complete',
    title: '任务标题兜底',
    blocks: [],
    ...overrides,
  };
}

/** 构造含两类正文任务 + 通知 + 过渡条目的已收尾 lesson */
function makeCompletedLesson(): NodeLessonV2 {
  let lesson = createInitialNodeLessonV2('ch-1', makePlan(), NOW);
  lesson.streamItems = [
    // 任务 1：有 takeaway → 摘要取 takeaway
    makeTaskContentItem({
      taskId: 'task-1',
      title: '认识概念',
      blocks: [
        { type: 'markdown', blockId: 'b1', markdown: '很长的正文内容'.repeat(30) },
        { type: 'key_point', blockId: 'b2', title: '要点', points: ['甲', '乙'] },
      ],
      boundaryPrompt: { takeaway: '本任务的核心要点' },
    }),
    // 任务 2：无 takeaway，首个 markdown 块截断
    makeTaskContentItem({
      itemId: 'tc:task-2:v1',
      taskId: 'task-2',
      title: '练习概念',
      sequence: 5,
      blocks: [{ type: 'markdown', blockId: 'b1', markdown: '没有 takeaway 时的正文开头内容'.repeat(10) }],
    }),
    // 过渡条目（归档应保留）
    {
      itemId: 'tt:task-1:task-2',
      type: 'task_transition',
      chapterId: 'ch-1',
      planVersion: 1,
      sequence: 3,
      createdAt: NOW,
      status: 'complete',
      fromTaskId: 'task-1',
      toTaskId: 'task-2',
    },
  ];
  lesson = appendSystemNotice(lesson, { tone: 'info', message: '本地提示' }, NOW + 1);
  const recap: ChapterRecap = {
    chapterId: 'ch-1',
    keyTakeaways: ['要点一'],
    demonstratedObjectives: [],
    fragileObjectives: [],
    unresolvedQuestions: [],
  };
  lesson = applyChapterRecap(lesson, recap, NOW + 2);
  return lesson;
}

// ---- summarizeTaskContent 三级兜底 ----

test('摘要一级兜底：优先取 boundaryPrompt.takeaway', () => {
  const item = makeTaskContentItem({
    blocks: [{ type: 'markdown', blockId: 'b1', markdown: '正文内容' }],
    boundaryPrompt: { takeaway: '  核心要点  ' },
  });
  assert.equal(summarizeTaskContent(item), '核心要点', 'takeaway 需 trim');
});

test('摘要二级兜底：无 takeaway 时取首个 markdown 块，超 80 字截断加省略号', () => {
  const long = '甲'.repeat(120);
  const item = makeTaskContentItem({
    blocks: [
      { type: 'key_point', blockId: 'b0', points: ['不算 markdown'] },
      { type: 'markdown', blockId: 'b1', markdown: long },
    ],
  });
  const summary = summarizeTaskContent(item);
  assert.equal(summary, `${'甲'.repeat(80)}…`);
  assert.equal(summary.length, 81);
});

test('摘要二级兜底：不超过 80 字时原样保留', () => {
  const item = makeTaskContentItem({
    blocks: [{ type: 'markdown', blockId: 'b1', markdown: '短正文' }],
  });
  assert.equal(summarizeTaskContent(item), '短正文');
});

test('摘要三级兜底：无 takeaway 且无 markdown 块（或为空）时用任务标题', () => {
  const noMarkdown = makeTaskContentItem({
    blocks: [{ type: 'key_point', blockId: 'b1', points: ['只有要点块'] }],
  });
  assert.equal(summarizeTaskContent(noMarkdown), '任务标题兜底');

  const emptyMarkdown = makeTaskContentItem({
    blocks: [{ type: 'markdown', blockId: 'b1', markdown: '   ' }],
  });
  assert.equal(summarizeTaskContent(emptyMarkdown), '任务标题兜底');
});

// ---- archiveCompletedLesson ----

test('归档：task_content 正文块替换为单条摘要块', () => {
  const archived = archiveCompletedLesson(makeCompletedLesson(), NOW + 10);

  const task1 = archived.streamItems.find((i) => i.itemId === 'tc:task-1:v1');
  assert.ok(task1 && task1.type === 'task_content');
  assert.equal(task1.blocks.length, 1, '多块压缩为单块');
  const block1 = task1.blocks[0];
  assert.ok(block1 && block1.type === 'markdown');
  assert.equal(block1.markdown, '本任务的核心要点');

  const task2 = archived.streamItems.find((i) => i.itemId === 'tc:task-2:v1');
  assert.ok(task2 && task2.type === 'task_content');
  const block2 = task2.blocks[0];
  assert.ok(block2 && block2.type === 'markdown');
  assert.equal(block2.markdown, `${'没有 takeaway 时的正文开头内容'.repeat(10).slice(0, 80)}…`);
});

test('归档：非正文条目与 recap/标题原样保留，标记与时间戳更新', () => {
  const archived = archiveCompletedLesson(makeCompletedLesson(), NOW + 10);

  assert.equal(archived.archived, true);
  assert.equal(archived.updatedAt, NOW + 10);
  assert.ok(archived.streamItems.some((i) => i.type === 'task_transition'), '过渡条目保留');
  assert.ok(archived.streamItems.some((i) => i.type === 'system_notice'), '系统通知保留');
  assert.ok(archived.streamItems.some((i) => i.type === 'chapter_recap'), 'recap 条目保留');
  assert.deepEqual(archived.recap?.keyTakeaways, ['要点一'], 'lesson.recap 保留');
  assert.equal(archived.chapterPlan.tasks.length, 2, '计划不被改动');
  assert.equal(archived.streamItems.length, 5, '条目总数不变');
});

test('归档幂等：已归档章节二次归档原样返回', () => {
  const archived = archiveCompletedLesson(makeCompletedLesson(), NOW + 10);
  const again = archiveCompletedLesson(archived, NOW + 20);
  assert.equal(again, archived, '已归档直接返回原对象');
});
