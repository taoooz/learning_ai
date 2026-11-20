import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChapterGlossary, buildChapterReference, mergeCourseAssets } from '../lib/learning-v2/reference';
import type { NodeLesson, StoredCourse } from '../types/learning-v2';

const NOW = 2000;

function makeLesson(): NodeLesson {
  return {
    protocolVersion: 2,
    chapterId: 'ch-1',
    chapterPlan: {
      chapterId: 'ch-1',
      planId: 'plan-1',
      planVersion: 1,
      objectiveIds: ['obj-1'],
      tasks: [],
      status: 'completed',
      createdAt: 1000,
      updatedAt: 1000,
      generationMeta: { promptVersion: 'p', modelVersion: 'm', generatedAt: 1000 },
    },
    runtime: {
      status: 'completed',
      currentTaskId: null,
      currentTaskStatus: 'idle',
      completedTaskIds: ['t1'],
      skippedTaskIds: [],
      latestSequence: 4,
      lastActiveAt: NOW,
    },
    streamItems: [
      {
        itemId: 'tc:t1:v1',
        type: 'task_content',
        chapterId: 'ch-1',
        taskId: 't1',
        planVersion: 1,
        sequence: 1,
        createdAt: 1000,
        status: 'complete',
        title: 'HTTP 缓存',
        blocks: [
          {
            type: 'key_point',
            blockId: 'kp-1',
            title: '核心概念：协商缓存',
            points: ['通过 ETag 或 Last-Modified 验证资源是否变化。'],
          },
          {
            type: 'comparison',
            blockId: 'cmp-1',
            columns: ['维度', '强缓存', '协商缓存'],
            rows: [['是否请求服务器', '否', '是']],
          },
          { type: 'markdown', blockId: 'md-1', markdown: '过程性内容不应进入速查表。' },
        ],
        sourceRefs: [
          { title: 'MDN HTTP caching', url: 'https://developer.mozilla.org/docs/Web/HTTP/Caching' },
          { title: '重复来源', url: 'https://developer.mozilla.org/docs/Web/HTTP/Caching' },
        ],
      },
    ],
    evidence: [],
    updatedAt: NOW,
  };
}

function makeCourse(lesson: NodeLesson): StoredCourse {
  return {
    courseId: 'course-1',
    blueprint: {
      blueprintId: 'bp-1',
      protocolVersion: 2,
      topic: 'HTTP 缓存',
      intentType: 'skill_mastery',
      mission: {
        why: '优化前端性能',
        targetScenario: '前端性能优化',
        successCriteria: ['掌握 HTTP 缓存策略'],
        constraints: [],
        outOfScope: [],
      },
      learnerStartingPoint: {
        estimatedLevel: 'beginner',
        confirmedKnowledge: [],
        likelyGaps: [],
        excludedTopics: [],
      },
      courseObjectives: [],
      chapters: [{ chapterId: 'ch-1', index: 1, title: 'HTTP 缓存', objectiveIds: [], prerequisites: [], teachingGoal: '理解缓存', completionCriteria: [] }],
      createdAt: 1000,
      promptVersion: 'p',
      modelVersion: 'm',
    },
    treeView: {
      courseId: 'course-1',
      topic: 'HTTP 缓存',
      totalChapters: 1,
      chapters: [{ chapterId: 'ch-1', index: 1, title: 'HTTP 缓存', status: 'completed' }],
    },
    createdAt: 1000,
    references: [{
      referenceId: 'ref-ch-1',
      courseId: 'course-1',
      chapterId: 'ch-1',
      type: 'cheatsheet',
      title: '旧标题',
      blocks: [{ type: 'markdown', blockId: 'old', markdown: '旧内容' }],
      updatedAt: 1000,
    }],
    glossary: [{
      termId: 'term-协商缓存',
      preferredTerm: '协商缓存',
      aliases: [],
      definition: '旧定义',
      avoidTerms: [],
      updatedAt: 1000,
    }],
  };
}

test('章节完成后确定性提取速查表，排除过程性 markdown', () => {
  const lesson = makeLesson();
  const reference = buildChapterReference(lesson, 'HTTP 缓存', NOW);
  assert.ok(reference);
  assert.equal(reference.title, 'HTTP 缓存 速查');
  assert.deepEqual(reference.blocks.map((block) => block.blockId), ['kp-1', 'cmp-1']);
  assert.equal(reference.sourceRefs?.length, 1);
  assert.equal(reference.sourceRefs?.[0]?.url, 'https://developer.mozilla.org/docs/Web/HTTP/Caching');
});

test('章节完成后从关键点卡提取统一术语', () => {
  const terms = buildChapterGlossary(makeLesson(), NOW);
  assert.equal(terms.length, 1);
  assert.equal(terms[0]?.preferredTerm, '协商缓存');
  assert.equal(terms[0]?.definition, '通过 ETag 或 Last-Modified 验证资源是否变化。');
});

test('课程参考物与术语表按章节幂等合并', () => {
  const lesson = makeLesson();
  const course = makeCourse(lesson);
  const merged = mergeCourseAssets(course, lesson, 'HTTP 缓存', NOW);

  assert.equal(merged.references?.length, 1);
  assert.equal(merged.references?.[0]?.title, 'HTTP 缓存 速查');
  assert.equal(merged.glossary?.[0]?.definition, '通过 ETag 或 Last-Modified 验证资源是否变化。');
  assert.equal(merged.glossary?.[0]?.updatedAt, NOW);
});

test('无标题关键点从正文提取术语，跳过通用标签和 Markdown 标记', () => {
  const lesson = makeLesson();
  const finalItem = lesson.streamItems[0];
  if (finalItem.type !== 'task_content') throw new Error('expected task content');
  finalItem.blocks = [
    {
      type: 'key_point',
      blockId: 'generic-kp',
      points: [
        '**核心要点**',
        '**缓存定义**：浏览器会把网页资源存在本地，下次请求先查缓存。',
        '**两种状态**：新鲜期直接复用，过期后先验证。',
      ],
    },
  ];
  const terms = buildChapterGlossary(lesson, NOW);
  assert.equal(terms[0]?.preferredTerm, '缓存定义');
  assert.equal(terms[0]?.definition, '浏览器会把网页资源存在本地，下次请求先查缓存。');

  finalItem.blocks[0] = {
    type: 'key_point',
    blockId: 'summary-kp',
    points: [
      '模式总结',
      '判断缓存命中只看两列：Status 括号标注 + Size 的 cache 字样。',
    ],
  };
  const summaryTerms = buildChapterGlossary(lesson, NOW + 1);
  assert.equal(summaryTerms[0]?.preferredTerm, '判断缓存命中只看两列');
  assert.equal(summaryTerms[0]?.definition, 'Status 括号标注 + Size 的 cache 字样。');
});
