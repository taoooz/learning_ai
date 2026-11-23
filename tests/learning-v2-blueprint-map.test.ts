import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLUEPRINT_MAP_MODEL_VERSION,
  BLUEPRINT_MAP_PROMPT_VERSION,
  inferIntentType,
  mapTocToBlueprint,
  normalizeEstimatedLevel,
  normalizeIntentType,
} from '../lib/learning-v2/blueprint-map';
import { validateCourseBlueprint } from '../lib/learning-v2/validators';
import type { MapTocToBlueprintInput } from '../lib/learning-v2/blueprint-map';

function makeInput(overrides: Partial<MapTocToBlueprintInput> = {}): MapTocToBlueprintInput {
  return {
    courseId: 'course-1756600000000',
    courseName: 'Redis 缓存实战',
    description: '从使用场景出发，学会在真实项目中用好 Redis 缓存',
    nodes: [
      { index: 1, title: '缓存是什么', description: '理解缓存的作用与典型使用场景' },
      { index: 2, title: '缓存穿透与雪崩', description: '掌握两类常见缓存问题的成因与对策' },
      { index: 3, title: '缓存更新策略', description: '学会为业务选择合适的缓存更新方式' },
    ],
    outline: {
      topic: 'Redis 缓存',
      learningDirection: '后端开发中的缓存使用',
      learningGoal: '想系统理解缓存并在项目中实操',
      learnerPositioning: { estimatedLevel: '中级' },
    },
    now: 1756600000000,
    ...overrides,
  };
}

test('映射产物字段完整且 ID 规则正确', () => {
  const blueprint = mapTocToBlueprint(makeInput());

  assert.equal(blueprint.blueprintId, 'bp-course-1756600000000');
  assert.equal(blueprint.protocolVersion, 2);
  assert.equal(blueprint.topic, 'Redis 缓存实战');
  assert.equal(blueprint.promptVersion, BLUEPRINT_MAP_PROMPT_VERSION);
  assert.equal(blueprint.modelVersion, BLUEPRINT_MAP_MODEL_VERSION);
  assert.equal(blueprint.createdAt, 1756600000000);

  assert.equal(blueprint.chapters.length, 3);
  assert.equal(blueprint.courseObjectives.length, 3);

  const first = blueprint.chapters[0];
  assert.equal(first.chapterId, 'ch-1');
  assert.deepEqual(first.objectiveIds, ['obj-1']);
  assert.deepEqual(first.prerequisites, []);

  const second = blueprint.chapters[1];
  assert.equal(second.chapterId, 'ch-2');
  assert.deepEqual(second.prerequisites, ['ch-1']);
});

test('映射产物通过蓝图校验（锁定测试）', () => {
  const result = validateCourseBlueprint(mapTocToBlueprint(makeInput()));
  assert.equal(result.passed, true, `校验应通过，实际问题：${result.issues.join('；')}`);
});

test('observableOutcome 是行为描述，不是空泛词', () => {
  const blueprint = mapTocToBlueprint(makeInput());
  for (const objective of blueprint.courseObjectives) {
    assert.match(objective.observableOutcome, /^能在真实场景中运用/);
    assert.equal(objective.importance, 'core');
    assert.equal(objective.evidenceRequirement, 'exposure');
  }
});

test('章节交付会进入 observableOutcome 和完成标准', () => {
  const blueprint = mapTocToBlueprint(makeInput({
    nodes: [{
      index: 1,
      title: '推荐链路',
      description: '理解推荐系统基本结构。本章交付：能独立解释召回、排序、重排的职责边界',
    }],
  }));
  assert.equal(
    blueprint.courseObjectives[0].observableOutcome,
    '能独立解释召回、排序、重排的职责边界',
  );
  assert.equal(
    blueprint.chapters[0].completionCriteria[0],
    '能完成本章交付：能独立解释召回、排序、重排的职责边界',
  );
});

test('节点缺 index 时按位置补位且依赖链不断', () => {
  const blueprint = mapTocToBlueprint(
    makeInput({
      nodes: [
        { index: undefined as unknown as number, title: '第一章', description: '一' },
        { index: undefined as unknown as number, title: '第二章', description: '二' },
      ],
    }),
  );
  assert.deepEqual(
    blueprint.chapters.map((c) => c.chapterId),
    ['ch-1', 'ch-2'],
  );
  assert.deepEqual(blueprint.chapters[1].prerequisites, ['ch-1']);
  assert.equal(validateCourseBlueprint(blueprint).passed, true);
});

test('节点描述为空时回退用标题，不产生空目标', () => {
  const blueprint = mapTocToBlueprint(
    makeInput({ nodes: [{ index: 1, title: '缓存入门', description: '  ' }] }),
  );
  assert.equal(blueprint.courseObjectives[0].description, '缓存入门');
  assert.equal(blueprint.chapters[0].teachingGoal, '缓存入门');
});

test('normalizeEstimatedLevel 中英文枚举归一化', () => {
  assert.equal(normalizeEstimatedLevel('初级'), 'beginner');
  assert.equal(normalizeEstimatedLevel('novice'), 'beginner');
  assert.equal(normalizeEstimatedLevel('beginner'), 'beginner');
  assert.equal(normalizeEstimatedLevel('中级'), 'intermediate');
  assert.equal(normalizeEstimatedLevel('intermediate'), 'intermediate');
  assert.equal(normalizeEstimatedLevel('高级'), 'advanced');
  assert.equal(normalizeEstimatedLevel('advanced'), 'advanced');
  assert.equal(normalizeEstimatedLevel(''), 'beginner');
  assert.equal(normalizeEstimatedLevel(undefined), 'beginner');
  assert.equal(normalizeEstimatedLevel('大师'), 'beginner');
});

test('inferIntentType 按关键词分类且优先级正确', () => {
  assert.equal(inferIntentType('想快速复习一遍'), 'fast_review');
  assert.equal(inferIntentType('线上故障排查与诊断'), 'problem_solving');
  assert.equal(inferIntentType('想动手搭建一套环境，按步骤实操'), 'skill_mastery');
  assert.equal(inferIntentType('想系统理解原理'), 'conceptual_understanding');
  assert.equal(inferIntentType(''), 'conceptual_understanding');
  // 同时命中多类时：速成 > 解决问题 > 实操
  assert.equal(inferIntentType('快速上手解决问题'), 'fast_review');
  assert.equal(inferIntentType('实操解决缓存问题'), 'problem_solving');
});

test('skipBasics 映射为排除主题', () => {
  const blueprint = mapTocToBlueprint(
    makeInput({
      outline: {
        topic: 'Redis 缓存',
        learningGoal: '实操',
        learnerPositioning: {
          estimatedLevel: '高级',
          skipBasics: ['数据类型', '安装'],
          likelyGaps: ['持久化选型'],
          levelConfidence: 0.8,
          backgroundSummary: '有后端开发经验',
          preferredExampleDomains: ['电商库存', '消息队列'],
          personalExampleLimit: 1,
        },
      },
    }),
  );
  assert.deepEqual(blueprint.learnerStartingPoint.excludedTopics, ['数据类型', '安装']);
  assert.equal(blueprint.learnerStartingPoint.estimatedLevel, 'advanced');
  assert.deepEqual(blueprint.learnerStartingPoint.confirmedKnowledge, ['数据类型', '安装']);
  assert.deepEqual(blueprint.learnerStartingPoint.likelyGaps, ['持久化选型']);
  assert.equal(blueprint.learnerStartingPoint.levelConfidence, 0.8);
  assert.equal(blueprint.learnerStartingPoint.backgroundSummary, '有后端开发经验');
  assert.deepEqual(blueprint.learnerStartingPoint.preferredExampleDomains, ['电商库存', '消息队列']);
  assert.equal(blueprint.learnerStartingPoint.personalExampleLimit, 1);
  assert.equal(validateCourseBlueprint(blueprint).passed, true);
});

test('课程名为空时回退用 outline.topic', () => {
  const blueprint = mapTocToBlueprint(makeInput({ courseName: '  ' }));
  assert.equal(blueprint.topic, 'Redis 缓存');
});

test('inferIntentType 不再被裸“问题”一词误判', () => {
  assert.equal(inferIntentType('理解常见缓存问题的成因'), 'conceptual_understanding');
  assert.equal(inferIntentType('解决缓存问题'), 'problem_solving');
});

test('normalizeIntentType 只接受契约枚举', () => {
  assert.equal(normalizeIntentType('skill_mastery'), 'skill_mastery');
  assert.equal(normalizeIntentType('fast_review'), 'fast_review');
  assert.equal(normalizeIntentType('casual_chat'), undefined);
  assert.equal(normalizeIntentType(undefined), undefined);
  assert.equal(normalizeIntentType(''), undefined);
});
