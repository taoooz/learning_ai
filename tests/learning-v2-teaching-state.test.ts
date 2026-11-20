import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addPendingArtifact,
  addTeachingInsight,
  createCourseTeachingState,
  markTeachingInsightUsed,
  resolvePendingArtifact,
  setTeachingChapter,
  updateTeachingStateAfterChapter,
} from '../lib/learning-v2/teaching-state';
import type { NodeLesson, StoredCourse } from '../types/learning-v2';

const NOW = 2000;

function makeCourse(): StoredCourse {
  return {
    courseId: 'course-1',
    blueprint: {
      blueprintId: 'bp-1',
      protocolVersion: 2,
      topic: 'HTTP 缓存',
      intentType: 'skill_mastery',
      mission: {
        why: '解决缓存性能问题',
        targetScenario: '性能优化',
        successCriteria: ['能设计缓存策略'],
        constraints: [],
        outOfScope: [],
      },
      learnerStartingPoint: { estimatedLevel: 'beginner', confirmedKnowledge: [], likelyGaps: [], excludedTopics: [] },
      courseObjectives: [],
      chapters: [
        { chapterId: 'ch-1', index: 1, title: '缓存基础', objectiveIds: [], prerequisites: [], teachingGoal: '理解缓存', completionCriteria: [] },
        { chapterId: 'ch-2', index: 2, title: '缓存策略', objectiveIds: [], prerequisites: [], teachingGoal: '设计策略', completionCriteria: [] },
      ],
      createdAt: 1000,
      promptVersion: 'p',
      modelVersion: 'm',
    },
    treeView: {
      courseId: 'course-1',
      topic: 'HTTP 缓存',
      totalChapters: 2,
      chapters: [
        { chapterId: 'ch-1', index: 1, title: '缓存基础', status: 'completed' },
        { chapterId: 'ch-2', index: 2, title: '缓存策略', status: 'available' },
      ],
    },
    createdAt: 1000,
  };
}

function makeLesson(): NodeLesson {
  return {
    protocolVersion: 2,
    chapterId: 'ch-1',
    chapterPlan: {
      chapterId: 'ch-1', planId: 'plan-1', planVersion: 1, objectiveIds: [], tasks: [],
      status: 'completed', createdAt: 1000, updatedAt: 1000,
      generationMeta: { promptVersion: 'p', modelVersion: 'm', generatedAt: 1000 },
    },
    runtime: {
      status: 'completed', currentTaskId: 't1', currentTaskStatus: 'idle', completedTaskIds: ['t1'],
      skippedTaskIds: [], latestSequence: 1, lastActiveAt: NOW,
    },
    streamItems: [],
    evidence: [{
      objectiveId: 'obj-1', checkpointId: 'cp-1', outcome: 'demonstrated', score: 1, attempt: 1, recordedAt: NOW,
    }],
    updatedAt: NOW,
  };
}

test('课程教学状态支持待反馈材料、素材和章节焦点', () => {
  let state = createCourseTeachingState(1000);
  state = setTeachingChapter(state, 'ch-1', 1100);
  state = addPendingArtifact(state, {
    kind: 'checkpoint_result',
    chapterId: 'ch-1',
    description: '等待第 1 章理解检查结果',
  }, 1200);
  state = addTeachingInsight(state, {
    content: '用户已理解缓存命中',
    suggestedChapterId: 'ch-2',
    status: 'candidate',
  }, 1300);

  assert.equal(state.currentChapterId, 'ch-1');
  assert.equal(state.pendingArtifacts.length, 1);
  assert.equal(state.insights.length, 1);

  state = resolvePendingArtifact(state, 'checkpoint_result', 'ch-1', 1400);
  state = markTeachingInsightUsed(state, state.insights[0]!.insightId, 1500);
  assert.equal(state.pendingArtifacts.length, 0);
  assert.equal(state.insights[0]?.status, 'used');
});

test('章节完成后更新教学焦点并沉淀下一章素材', () => {
  const course = makeCourse();
  const lesson = makeLesson();
  const state = updateTeachingStateAfterChapter(course, lesson, NOW);

  assert.equal(state.currentChapterId, 'ch-2');
  assert.equal(state.insights.length, 1);
  assert.equal(state.insights[0]?.suggestedChapterId, 'ch-2');
  assert.ok(state.insights[0]?.content.includes('已完成'));
});

test('无检查证据时保留待反馈材料', () => {
  const course = makeCourse();
  const lesson = makeLesson();
  lesson.evidence = [];
  course.teachingState = {
    ...createCourseTeachingState(1000),
    pendingArtifacts: [{
      kind: 'checkpoint_result', chapterId: 'ch-1', description: '等待检查结果', createdAt: 1000,
    }],
  };
  const state = updateTeachingStateAfterChapter(course, lesson, NOW);
  assert.equal(state.pendingArtifacts.length, 1);
});
