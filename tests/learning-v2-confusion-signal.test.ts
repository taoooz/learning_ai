// tests/learning-v2-confusion-signal.test.ts
// 切片 4：困惑信号检测纯函数测试

import test from 'node:test';
import assert from 'node:assert/strict';

import { countConsecutiveConfusions, isConfusionSignal, REEXPLAIN_THRESHOLD } from '../lib/learning-v2/confusion-signal';
import { createInitialNodeLesson, appendUserQuestion } from '../lib/learning-v2/reducers';
import type { ChapterPlan, GenerationMeta, PlannedTask } from '../types/learning-v2';

const NOW = 1756700000000;
const META: GenerationMeta = { promptVersion: 'p1', modelVersion: 'm1', generatedAt: NOW };

function makePlan(): ChapterPlan {
  const task: PlannedTask = {
    taskId: 't1', order: 0, title: '任务 1', objectiveId: 'obj-1',
    taskGoal: '目标', observableOutcome: '结果', conceptKeys: [],
    prerequisiteTaskIds: [], teachingPattern: 'explain', expectedMinutes: 2,
    evidencePolicy: 'none', origin: 'initial', status: 'planned',
  };
  return {
    chapterId: 'ch-1', planId: 'plan-1', planVersion: 1,
    objectiveIds: ['obj-1'], tasks: [task], status: 'active',
    createdAt: NOW, updatedAt: NOW, generationMeta: META,
  };
}

function makeLesson(questions: string[]) {
  let lesson = createInitialNodeLesson('ch-1', makePlan(), NOW);
  questions.forEach((text, i) => {
    lesson = appendUserQuestion(lesson, { taskId: 't1', questionId: `q-${i}`, text }, NOW);
  });
  return lesson;
}

test('isConfusionSignal detects confusion keywords', () => {
  assert.equal(isConfusionSignal('没理解'), true);
  assert.equal(isConfusionSignal('还是不清楚'), true);
  assert.equal(isConfusionSignal('看不懂这段'), true);
});

test('isConfusionSignal ignores non-confusion', () => {
  assert.equal(isConfusionSignal('能举个例子吗？'), false);
  assert.equal(isConfusionSignal(''), false);
});

test('countConsecutiveConfusions counts trailing streak', () => {
  const lesson = makeLesson(['什么是缓存？', '没理解', '还是没理解']);
  assert.equal(countConsecutiveConfusions(lesson, 't1'), 2);
});

test('countConsecutiveConfusions resets on non-confusion', () => {
  const lesson = makeLesson(['没理解', '能举个例子吗？', '还是不清楚']);
  assert.equal(countConsecutiveConfusions(lesson, 't1'), 1);
});

test('countConsecutiveConfusions empty returns 0', () => {
  assert.equal(countConsecutiveConfusions(makeLesson([]), 't1'), 0);
});

test('REEXPLAIN_THRESHOLD is 2', () => {
  assert.equal(REEXPLAIN_THRESHOLD, 2);
});
