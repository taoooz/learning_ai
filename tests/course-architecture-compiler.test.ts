import test from 'node:test';
import assert from 'node:assert/strict';

import type { CourseArchitecture } from '../types/learning-v2/course-architecture';
import {
  BLUEPRINT_ARCHITECTURE_COMPILER_VERSION,
  compileCourseArchitecture,
} from '../lib/learning-v2/blueprint-from-architecture';
import { validateCourseBlueprint } from '../lib/learning-v2/validators';

function makeArchitecture(): CourseArchitecture {
  return {
    architectureVersion: 1,
    courseTopic: '推荐系统核心链路',
    thesis: {
      audience: '有内容运营背景的中级学习者',
      currentBoundary: ['能配置推荐位', '还不能定位链路问题'],
      targetCapability: '能定位推荐问题并设计验证方案',
      learningDelta: ['从看报表到判断链路边界', '从经验决策到指标验证'],
      nonGoals: ['不从零讲推荐系统历史'],
    },
    conceptGraph: [
      {
        conceptId: 'c1',
        label: '召回与排序边界',
        targetDepth: 'apply',
        rationale: '定位问题的基础',
        prerequisiteConceptIds: [],
      },
      {
        conceptId: 'c2',
        label: '评估指标',
        targetDepth: 'transfer',
        rationale: '迁移到新场景',
        prerequisiteConceptIds: ['c1'],
      },
    ],
    chapters: [
      {
        chapterId: 'ch-1',
        title: '链路职责边界',
        roleInCourse: '建立诊断框架',
        conceptIds: ['c1'],
        deliverable: '能判断问题属于哪个链路环节',
        prerequisites: [],
        assessmentMode: 'checkpoint',
      },
      {
        chapterId: 'ch-2',
        title: '推荐效果评估',
        roleInCourse: '把业务问题转成验证方案',
        conceptIds: ['c2'],
        deliverable: '能为推荐问题设计离线与在线验证方案',
        prerequisites: ['ch-1'],
        assessmentMode: 'self_report',
      },
    ],
    examplePolicy: {
      preferredDomains: ['内容平台', '电商推荐'],
      personalExampleLimit: 1,
      avoidRepeatedScenarios: true,
    },
  };
}

test('CourseArchitecture compiles to a valid CourseBlueprint', () => {
  const blueprint = compileCourseArchitecture({
    courseId: 'course-architecture-1',
    architecture: makeArchitecture(),
    learner: {
      estimatedLevel: '中级',
      backgroundSummary: '做过内容运营',
      skipBasics: ['推荐系统基本概念'],
      likelyGaps: ['召回与排序边界'],
      levelConfidence: 0.75,
      preferredExampleDomains: ['内容平台'],
      personalExampleLimit: 1,
    },
    modelVersion: 'ark/deepseek-v4-1-flash',
    now: 1000,
  });

  assert.equal(blueprint.protocolVersion, 2);
  assert.equal(blueprint.promptVersion, BLUEPRINT_ARCHITECTURE_COMPILER_VERSION);
  assert.equal(blueprint.topic, '推荐系统核心链路');
  assert.equal(blueprint.chapters.length, 2);
  assert.equal(blueprint.courseObjectives[0].observableOutcome, '能判断问题属于哪个链路环节');
  assert.equal(blueprint.courseObjectives[0].evidenceRequirement, 'demonstration');
  assert.equal(blueprint.courseObjectives[1].evidenceRequirement, 'self_report');
  assert.deepEqual(blueprint.courseObjectives[0].conceptKeys, ['召回与排序边界']);
  assert.deepEqual(blueprint.chapters[1].prerequisites, ['ch-1']);
  assert.deepEqual(blueprint.learnerStartingPoint.confirmedKnowledge, ['推荐系统基本概念']);
  assert.equal(blueprint.learnerStartingPoint.personalExampleLimit, 1);

  const validation = validateCourseBlueprint(blueprint);
  assert.equal(validation.passed, true, validation.issues.join('；'));
});

test('compiler rejects chapter references to unknown concepts', () => {
  const architecture = makeArchitecture();
  architecture.chapters[0].conceptIds = ['ghost'];
  assert.throws(
    () => compileCourseArchitecture({
      courseId: 'course-architecture-2',
      architecture,
      learner: { estimatedLevel: 'intermediate' },
      now: 1000,
    }),
    /不存在的概念/,
  );
});

test('compiler promotes a core objective when architecture only has explanatory depth', () => {
  const architecture = makeArchitecture();
  architecture.conceptGraph.forEach((concept) => { concept.targetDepth = 'understand'; });
  const blueprint = compileCourseArchitecture({
    courseId: 'course-architecture-3',
    architecture,
    learner: { estimatedLevel: 'beginner' },
    now: 1000,
  });
  assert.ok(blueprint.courseObjectives.some((objective) => objective.importance === 'core'));
  assert.equal(validateCourseBlueprint(blueprint).passed, true);
});

test('compiler falls back to architecture example domains when learner has none', () => {
  const architecture = makeArchitecture();
  const blueprint = compileCourseArchitecture({
    courseId: 'course-architecture-4',
    architecture,
    learner: { estimatedLevel: 'intermediate' },
    now: 1000,
  });

  assert.deepEqual(
    blueprint.learnerStartingPoint.preferredExampleDomains,
    architecture.examplePolicy.preferredDomains,
  );
});

test('intentType 优先澄清契约，缺失或非法时回退关键词推断', () => {
  const base = {
    courseId: 'course-intent',
    architecture: makeArchitecture(),
    learner: { estimatedLevel: '中级' as const },
  };
  // 契约值直接透传，不被目标文本关键词覆盖
  assert.equal(
    compileCourseArchitecture({ ...base, intentType: 'fast_review' }).intentType,
    'fast_review',
  );
  // fixture 目标文本含裸“问题”但无强关键词：回退推断不再误判 problem_solving
  assert.equal(compileCourseArchitecture(base).intentType, 'conceptual_understanding');
  // 非法值按缺失处理
  assert.equal(
    compileCourseArchitecture({ ...base, intentType: 'casual_chat' as never }).intentType,
    'conceptual_understanding',
  );
});
