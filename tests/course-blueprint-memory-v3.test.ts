import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStoredCourseBundleFromBlueprint,
  deriveCourseTreeFromStoredCourseBundle,
  deriveCourseTreeViewFromBlueprint,
} from '../lib/course-blueprint';
import {
  appendEventToMemoryStoreV3,
  createEmptyMemoryStoreV3,
} from '../lib/memory/aggregator';
import { getPlanningMemoryPayload } from '../lib/memory/memory-agent';
import { activateSystemCourse, clearLegacyLearningData, getStoredData, getSystemCourseRecommendations } from '../lib/storage';
import { buildCompactCourseBlueprintPrompt } from '../lib/prompt';
import { validateCourseBlueprint } from '../lib/validation/course-validator';
import { validateNodeLesson } from '../lib/validation/node-validator';

test('deriveCourseTreeViewFromBlueprint maps blueprint nodes into lightweight course tree view', () => {
  const blueprint = {
    courseId: 'course-agent',
    topic: 'Agent',
    learnerPositioning: {
      estimatedLevel: 'beginner' as const,
    },
    courseGoal: '能独立理解并设计基础 Agent 学习路径',
    globalConcepts: [
      { id: 'concept-agent-definition', name: 'Agent 基本定义', aliases: ['什么是 Agent'] },
      { id: 'concept-tool-use', name: '工具调用', aliases: ['外部工具调用'] },
    ],
    nodes: [
      {
        index: 0,
        title: '先建立 Agent 基本框架',
        teachingGoal: '理解 Agent 的基本定义',
        teachConceptIds: ['concept-agent-definition'],
        prerequisiteConceptIds: [],
        assessmentTargetIds: ['concept-agent-definition'],
        bridgeFromPreviousNode: '无',
        personalizationHooks: {
          mustRemediateConceptIds: [],
          canCompressKnownConceptIds: [],
          analogyFactIds: [],
        },
        cardCount: 8,
        status: 'available' as const,
      },
      {
        index: 1,
        title: '搞清工具调用为什么必要',
        teachingGoal: '理解工具调用的边界',
        teachConceptIds: ['concept-tool-use'],
        prerequisiteConceptIds: ['concept-agent-definition'],
        assessmentTargetIds: ['concept-tool-use'],
        bridgeFromPreviousNode: '从定义过渡到执行能力',
        personalizationHooks: {
          mustRemediateConceptIds: ['concept-tool-use'],
          canCompressKnownConceptIds: [],
          analogyFactIds: [],
        },
        cardCount: 9,
        status: 'locked' as const,
      },
    ],
    coverage: {
      introducedConceptIds: ['concept-agent-definition', 'concept-tool-use'],
      assessedConceptIds: ['concept-agent-definition', 'concept-tool-use'],
      remediatedConceptIds: ['concept-tool-use'],
    },
    generationNotes: {
      compressedKnownConceptIds: [],
      emphasizedRiskConceptIds: ['concept-tool-use'],
      selectedAnalogyFactIds: [],
    },
  };

  const treeView = deriveCourseTreeViewFromBlueprint(blueprint);

  assert.deepEqual(treeView, {
    courseId: 'course-agent',
    topic: 'Agent',
    courseGoal: '能独立理解并设计基础 Agent 学习路径',
    totalNodes: 2,
    nodes: [
      { index: 0, title: '先建立 Agent 基本框架', status: 'available' },
      { index: 1, title: '搞清工具调用为什么必要', status: 'locked' },
    ],
  });
});

test('createEmptyMemoryStoreV3 seeds profile, event log, and projections', () => {
  const store = createEmptyMemoryStoreV3({
    name: '小王',
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      workSummary: ['做过 React 后台项目'],
      educationSummary: [],
      analogyExperiences: ['负责过埋点分析和实验设计'],
      learningStyle: '实践型',
      technicalLevel: '业务级',
      valuePriorities: ['效率提升'],
      summary: '前端和数据分析经验',
    },
  });

  assert.equal(store.version, 3);
  assert.equal(store.learnerId, 'local-user');
  assert.equal(store.events.length, 0);
  assert.deepEqual(store.projections.conceptProjections, []);
  assert.deepEqual(store.projections.topicProjections, []);
  assert.deepEqual(store.projections.episodicProjections, []);
  assert.equal(store.profile.goals.some((item) => item.goalText.includes('AI 产品经理')), true);
  assert.equal(store.profile.stableFacts.some((item) => item.text.includes('React 后台项目')), true);
});

test('stored course bundle can hydrate into runtime course tree with node lessons', () => {
  const blueprint = {
    courseId: 'course-agent',
    topic: 'Agent',
    learnerPositioning: {
      estimatedLevel: 'beginner' as const,
    },
    courseGoal: '理解 Agent 的核心结构',
    globalConcepts: [
      { id: 'concept-agent-definition', name: 'Agent 基本定义', aliases: ['什么是 Agent'] },
    ],
    nodes: [
      {
        index: 0,
        title: '先建立 Agent 基本框架',
        teachingGoal: '理解 Agent 定义',
        teachConceptIds: ['concept-agent-definition'],
        prerequisiteConceptIds: [],
        assessmentTargetIds: ['concept-agent-definition'],
        bridgeFromPreviousNode: '无',
        personalizationHooks: {
          mustRemediateConceptIds: [],
          canCompressKnownConceptIds: [],
          analogyFactIds: [],
        },
        cardCount: 8,
        status: 'available' as const,
      },
    ],
    coverage: {
      introducedConceptIds: ['concept-agent-definition'],
      assessedConceptIds: ['concept-agent-definition'],
      remediatedConceptIds: [],
    },
    generationNotes: {
      compressedKnownConceptIds: [],
      emphasizedRiskConceptIds: [],
      selectedAnalogyFactIds: [],
    },
  };

  const bundle = createStoredCourseBundleFromBlueprint(blueprint);
  bundle.lessons[0] = {
    courseId: 'course-agent',
    nodeIndex: 0,
    title: '先建立 Agent 基本框架',
    teachingGoal: '理解 Agent 定义',
    teachConceptIds: ['concept-agent-definition'],
    assessmentTargetIds: ['concept-agent-definition'],
    cards: [
      {
        id: 'card-1',
        title: 'Agent 是什么',
        content: 'Agent 是能围绕目标做决策和调用能力的系统。',
        imageUrl: null,
        coveredConceptIds: ['concept-agent-definition'],
      },
    ],
    questions: [
      {
        id: 'q-1',
        type: 'single' as const,
        question: 'Agent 最核心的特点是什么？',
        options: ['A. 只有模型推理', 'B. 围绕目标行动'],
        answer: 'B',
        cardId: 'card-1',
        targetConceptId: 'concept-agent-definition',
      },
    ],
  };

  const runtimeCourse = deriveCourseTreeFromStoredCourseBundle(bundle);

  assert.equal(runtimeCourse.nodes[0].cards?.[0]?.title, 'Agent 是什么');
  assert.equal(runtimeCourse.nodes[0].questions?.[0]?.targetConceptId, 'concept-agent-definition');
});

test('createStoredCourseBundleFromBlueprint normalizes 1-based node indexes into 0-based internal indexes', () => {
  const blueprint = {
    courseId: 'course-react',
    topic: 'React',
    learnerPositioning: {
      estimatedLevel: 'beginner' as const,
    },
    courseGoal: '完成 React 入门路径',
    globalConcepts: [
      { id: 'concept-jsx', name: 'JSX', aliases: [] },
      { id: 'concept-component', name: '组件', aliases: [] },
    ],
    nodes: [
      {
        index: 1,
        title: '认识 JSX',
        teachingGoal: '理解 JSX 的基本作用',
        teachConceptIds: ['concept-jsx'],
        prerequisiteConceptIds: [],
        assessmentTargetIds: ['concept-jsx'],
        bridgeFromPreviousNode: '无',
        personalizationHooks: {
          mustRemediateConceptIds: [],
          canCompressKnownConceptIds: [],
          analogyFactIds: [],
        },
        status: 'available' as const,
      },
      {
        index: 2,
        title: '理解组件',
        teachingGoal: '理解组件的拆分方式',
        teachConceptIds: ['concept-component'],
        prerequisiteConceptIds: ['concept-jsx'],
        assessmentTargetIds: ['concept-component'],
        bridgeFromPreviousNode: '从 JSX 过渡到组件',
        personalizationHooks: {
          mustRemediateConceptIds: [],
          canCompressKnownConceptIds: [],
          analogyFactIds: [],
        },
        status: 'locked' as const,
      },
    ],
  };

  const bundle = createStoredCourseBundleFromBlueprint(blueprint);
  bundle.lessons[0] = {
    courseId: 'course-react',
    nodeIndex: 0,
    title: '认识 JSX',
    teachingGoal: '理解 JSX 的基本作用',
    teachConceptIds: ['concept-jsx'],
    assessmentTargetIds: ['concept-jsx'],
    cards: [
      {
        id: 'card-jsx-1',
        title: 'JSX 是什么',
        content: 'JSX 是一种更接近 HTML 的 UI 描述语法。',
        coveredConceptIds: ['concept-jsx'],
      },
    ],
    questions: [],
  };

  const runtimeCourse = deriveCourseTreeFromStoredCourseBundle(bundle);

  assert.deepEqual(bundle.blueprint.nodes.map((node) => node.index), [0, 1]);
  assert.deepEqual(bundle.treeView.nodes.map((node) => node.index), [0, 1]);
  assert.equal(runtimeCourse.nodes[0].title, '认识 JSX');
  assert.equal(runtimeCourse.nodes[0].cards?.[0]?.title, 'JSX 是什么');
  assert.equal(runtimeCourse.nodes[1].title, '理解组件');
});

test('clearLegacyLearningData removes old storage keys before v2 storage boots', () => {
  const data = new Map<string, string>([
    ['ai-learning-data', '{"legacy":true}'],
    ['userMemory', '{"version":1}'],
    ['userMemoryV2', '{"version":2}'],
    ['ai-learning-data-v2', '{"courses":[]}'],
  ]);

  const storage = {
    removeItem(key: string) {
      data.delete(key);
    },
  };

  clearLegacyLearningData(storage);

  assert.equal(data.has('ai-learning-data'), false);
  assert.equal(data.has('userMemory'), false);
  assert.equal(data.has('userMemoryV2'), false);
  assert.equal(data.has('ai-learning-data-v2'), true);
});

test('system course recommendations expose two preset guides and activation writes course into storage', () => {
  const recommendations = getSystemCourseRecommendations();
  assert.equal(recommendations.length, 2);
  assert.equal(recommendations.some((item) => item.title === '人人都该懂的 AI 课'), true);
  assert.equal(recommendations.some((item) => item.title === '普通人应该如何理财'), true);

  const storageMap = new Map<string, string>();
  const fakeStorage = {
    getItem(key: string) {
      return storageMap.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storageMap.set(key, value);
    },
    removeItem(key: string) {
      storageMap.delete(key);
    },
  };

  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
  (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;

  try {
    const course = activateSystemCourse('system-ai-for-everyone');
    const storedData = getStoredData();

    assert.equal(course?.courseId, 'system-ai-for-everyone');
    assert.equal(storedData.courses.some((item) => item.courseId === 'system-ai-for-everyone'), true);
    assert.equal(storedData.currentCourseId, 'system-ai-for-everyone');
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }

    if (originalLocalStorage === undefined) {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    }
  }
});

test('appendEventToMemoryStoreV3 projects question and chat events into concept and topic views', () => {
  let store = createEmptyMemoryStoreV3({
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      workSummary: ['做过 React 后台项目'],
      educationSummary: [],
      analogyExperiences: ['负责过埋点分析和实验设计'],
      learningStyle: '实践型',
      technicalLevel: '业务级',
      valuePriorities: ['效率提升'],
      summary: '前端和数据分析经验',
    },
  });

  store = appendEventToMemoryStoreV3(store, {
    type: 'question_answered',
    topic: 'Agent',
    courseId: 'course-agent',
    occurredAt: 1,
    payload: {
      conceptId: 'concept-tool-use',
      conceptName: '工具调用',
      question: '什么时候必须调用工具？',
      isCorrect: false,
    },
  });

  store = appendEventToMemoryStoreV3(store, {
    type: 'chat_user_message',
    topic: 'Agent',
    courseId: 'course-agent',
    occurredAt: 2,
    payload: {
      question: '我还是分不清工具调用和工作流编排',
      confusionConceptId: 'concept-tool-use',
      confusionConceptName: '工具调用',
      explanationStyles: ['分步拆解'],
    },
  });

  assert.equal(store.projections.conceptProjections.some((item) => item.conceptId === 'concept-tool-use' && item.recentErrors >= 1), true);
  assert.equal(store.projections.topicProjections.some((item) => item.topic === 'Agent' && item.riskConceptIds.includes('concept-tool-use')), true);
  assert.equal(store.profile.preferences.some((item) => item.value === '分步拆解'), true);
});

test('getPlanningMemoryPayload can read MemoryStoreV3 projections directly', () => {
  const store = createEmptyMemoryStoreV3({
    name: '小王',
    targetJob: 'AI 产品经理',
    workExperience: [],
    education: [],
    insights: {
      workSummary: ['做过 React 后台项目'],
      educationSummary: [],
      analogyExperiences: ['负责过埋点分析和实验设计'],
      learningStyle: '实践型' as const,
      technicalLevel: '业务级' as const,
      valuePriorities: ['效率提升'],
      summary: '前端和数据分析经验',
    },
  });

  // 通过事件注入答题行为（创建 topicProjection）
  const storeWithEvent = appendEventToMemoryStoreV3(store, {
    type: 'question_answered',
    topic: 'Agent',
    courseId: 'course-agent',
    occurredAt: Date.now(),
    payload: {
      conceptId: 'concept-tool-use',
      conceptName: '工具调用',
      question: '什么时候必须调用工具？',
      isCorrect: false,
    },
  });

  const payload = getPlanningMemoryPayload('Agent', storeWithEvent);

  // 答错事件应导致工具调用被标记为 riskConcept
  assert.equal(payload.riskConcepts.includes('工具调用'), true);
  // 事件后 topicProjection 应该有 estimatedLevel
  assert.equal(typeof payload.learnerSnapshot.estimatedLevel, 'string');
});

test('validateCourseBlueprint accepts a blueprint that covers must-cover concepts and dependencies', () => {
  const blueprint = {
    courseId: 'course-agent',
    topic: 'Agent',
    learnerPositioning: {
      estimatedLevel: 'beginner' as const,
    },
    courseGoal: '理解 Agent 的核心结构',
    globalConcepts: [
      { id: 'concept-agent-definition', name: 'Agent 基本定义', aliases: ['什么是 Agent'] },
      { id: 'concept-tool-use', name: '工具调用', aliases: ['外部工具调用'] },
    ],
    nodes: [
      {
        index: 0,
        title: '先建立 Agent 基本框架',
        teachingGoal: '理解 Agent 定义',
        teachConceptIds: ['concept-agent-definition'],
        prerequisiteConceptIds: [],
        assessmentTargetIds: ['concept-agent-definition'],
        bridgeFromPreviousNode: '无',
        personalizationHooks: {
          mustRemediateConceptIds: [],
          canCompressKnownConceptIds: [],
          analogyFactIds: [],
        },
        cardCount: 8,
        status: 'available' as const,
      },
      {
        index: 1,
        title: '搞清工具调用为什么必要',
        teachingGoal: '理解工具调用边界',
        teachConceptIds: ['concept-tool-use'],
        prerequisiteConceptIds: ['concept-agent-definition'],
        assessmentTargetIds: ['concept-tool-use'],
        bridgeFromPreviousNode: '从定义过渡到执行',
        personalizationHooks: {
          mustRemediateConceptIds: ['concept-tool-use'],
          canCompressKnownConceptIds: [],
          analogyFactIds: [],
        },
        cardCount: 9,
        status: 'locked' as const,
      },
    ],
    coverage: {
      introducedConceptIds: ['concept-agent-definition', 'concept-tool-use'],
      assessedConceptIds: ['concept-agent-definition', 'concept-tool-use'],
      remediatedConceptIds: ['concept-tool-use'],
    },
    generationNotes: {
      compressedKnownConceptIds: [],
      emphasizedRiskConceptIds: ['concept-tool-use'],
      selectedAnalogyFactIds: [],
    },
  };

  const result = validateCourseBlueprint(blueprint, {
    mustCoverConceptIds: ['concept-tool-use'],
    riskConceptIds: ['concept-tool-use'],
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test('validateCourseBlueprint rejects empty concept coverage and generic node titles', () => {
  const blueprint = {
    courseId: 'course-agent',
    topic: 'Agent',
    learnerPositioning: {
      estimatedLevel: 'beginner' as const,
    },
    courseGoal: '理解 Agent 的核心结构',
    globalConcepts: [
      { id: 'concept-tool-use', name: '工具调用', aliases: ['外部工具调用'] },
    ],
    nodes: [
      {
        index: 0,
        title: '进阶篇',
        teachingGoal: '理解工具调用边界',
        teachConceptIds: [],
        prerequisiteConceptIds: [],
        assessmentTargetIds: [],
        bridgeFromPreviousNode: '无',
        personalizationHooks: {
          mustRemediateConceptIds: [],
          canCompressKnownConceptIds: [],
          analogyFactIds: [],
        },
        cardCount: 8,
        status: 'available' as const,
      },
    ],
    coverage: {
      introducedConceptIds: [],
      assessedConceptIds: [],
      remediatedConceptIds: [],
    },
    generationNotes: {
      compressedKnownConceptIds: [],
      emphasizedRiskConceptIds: [],
      selectedAnalogyFactIds: [],
    },
  };

  const result = validateCourseBlueprint(blueprint, {
    mustCoverConceptIds: ['concept-tool-use'],
    riskConceptIds: ['concept-tool-use'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.issues.some((item) => item.includes('teachConceptIds')), true);
  assert.equal(result.issues.some((item) => item.includes('mustCoverConceptIds')), true);
  assert.equal(result.issues.some((item) => item.includes('空泛标题')), true);
});

test('validateCourseBlueprint accepts lightweight blueprint without assessment and coverage metadata', () => {
  const blueprint = {
    courseId: 'course-ai-basic',
    topic: 'AI 基础',
    learnerPositioning: {
      estimatedLevel: 'beginner' as const,
    },
    courseGoal: '理解 AI 产品的核心概念与使用边界',
    globalConcepts: [
      { id: 'concept-llm', name: '大语言模型', aliases: ['LLM'] },
      { id: 'concept-prompt', name: '提示词', aliases: [] },
    ],
    nodes: [
      {
        index: 0,
        title: '先理解 AI 为什么会说话',
        teachingGoal: '建立对大语言模型的基础认知',
        teachConceptIds: ['concept-llm'],
        prerequisiteConceptIds: [],
        bridgeFromPreviousNode: '从最核心的概念开始。',
        cardCount: 6,
        status: 'available' as const,
      },
      {
        index: 1,
        title: '再看提示词为什么重要',
        teachingGoal: '理解输入质量如何影响输出',
        teachConceptIds: ['concept-prompt'],
        prerequisiteConceptIds: ['concept-llm'],
        bridgeFromPreviousNode: '理解模型后，再看人如何与模型沟通。',
        cardCount: 6,
        status: 'locked' as const,
      },
    ],
  };

  const result = validateCourseBlueprint(blueprint, {
    mustCoverConceptIds: ['concept-prompt'],
    riskConceptIds: ['concept-prompt'],
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test('validateNodeLesson accepts explicit concept coverage and target concept binding', () => {
  const lesson = {
    courseId: 'course-agent',
    nodeIndex: 1,
    title: '搞清工具调用为什么必要',
    teachingGoal: '理解工具调用边界',
    teachConceptIds: ['concept-tool-use'],
    assessmentTargetIds: ['concept-tool-use'],
    cards: [
      {
        id: 'card-1',
        title: '为什么需要工具调用',
        content: '工具调用让 Agent 能访问模型参数外的信息。',
        imageUrl: null,
        coveredConceptIds: ['concept-tool-use'],
      },
    ],
    questions: [
      {
        id: 'q-1',
        type: 'single' as const,
        question: '什么时候应该调用工具？',
        options: ['A. 需要外部信息时', 'B. 任何时候都调用'],
        answer: 'A',
        cardId: 'card-1',
        targetConceptId: 'concept-tool-use',
      },
    ],
  };

  const result = validateNodeLesson(lesson, {
    teachConceptIds: ['concept-tool-use'],
    assessmentTargetIds: ['concept-tool-use'],
    riskConceptIds: ['concept-tool-use'],
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test('validateNodeLesson rejects missing coveredConceptIds and invalid target concept ids', () => {
  const lesson = {
    courseId: 'course-agent',
    nodeIndex: 1,
    title: '搞清工具调用为什么必要',
    teachingGoal: '理解工具调用边界',
    teachConceptIds: ['concept-tool-use'],
    assessmentTargetIds: ['concept-tool-use'],
    cards: [
      {
        id: 'card-1',
        title: '为什么需要工具调用',
        content: '工具调用让 Agent 能访问模型参数外的信息。',
        imageUrl: null,
        coveredConceptIds: [],
      },
    ],
    questions: [
      {
        id: 'q-1',
        type: 'single' as const,
        question: '什么时候应该调用工具？',
        options: ['A. 需要外部信息时', 'B. 任何时候都调用'],
        answer: 'A',
        cardId: 'card-missing',
        targetConceptId: 'concept-non-existent',
      },
    ],
  };

  const result = validateNodeLesson(lesson, {
    teachConceptIds: ['concept-tool-use'],
    assessmentTargetIds: ['concept-tool-use'],
    riskConceptIds: ['concept-tool-use'],
  });

  assert.equal(result.passed, false);
  assert.equal(result.issues.some((item) => item.includes('coveredConceptIds')), true);
  assert.equal(result.issues.some((item) => item.includes('targetConceptId')), true);
  assert.equal(result.issues.some((item) => item.includes('cardId')), true);
});

test('new blueprint prompt injects structured planning signals', () => {
  const coursePrompt = buildCompactCourseBlueprintPrompt('Agent', {
    learnerSnapshot: {
      estimatedLevel: 'beginner',
      confidence: 0.82,
      targetGoal: '希望课程服务于 AI 产品经理相关成长',
    },
    mustCoverConceptIds: ['concept-tool-use'],
    mustCoverConceptNames: ['工具调用'],
    skippableConceptIds: ['concept-react-basic'],
    skippableConceptNames: ['基础前端组件概念'],
    riskConceptIds: ['concept-tool-use'],
    riskConceptNames: ['工具调用'],
    analogyFacts: [{ id: 'fact-1', text: '负责过埋点分析和实验设计' }],
    recentEpisodes: [{ topic: 'Agent', summary: '上一门 Agent 课程已完成 3/6 节' }],
  });

  assert.match(coursePrompt, /课程目录大纲/);
  assert.match(coursePrompt, /工具调用/);
  assert.doesNotMatch(coursePrompt, /generationNotes/);
  assert.doesNotMatch(coursePrompt, /coverage/);
  assert.doesNotMatch(coursePrompt, /assessmentTargetIds/);
});
