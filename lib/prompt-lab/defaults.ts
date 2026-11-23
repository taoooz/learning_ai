import type { UserProfile } from '@/types/course';
import type { CourseBlueprint, NodeLesson } from '@/types/learning-v2';
import type { PromptLabStageId } from '@/types/prompt-lab';
import { compileCourseArchitecture } from '@/lib/learning-v2/blueprint-from-architecture';
import { loadNodeLesson } from '@/lib/learning-v2/storage';
import { getStoredData } from '@/lib/storage';

const SAMPLE_TOPIC = '面向产品经理的推荐系统实战';

const SAMPLE_LEARNER = {
  estimatedLevel: 'intermediate',
  backgroundSummary: '有互联网产品与运营经验，接触过推荐场景但缺少系统方法。',
  skipBasics: ['推荐系统基本概念', 'CTR/CVR 基础指标'],
  likelyGaps: ['召回排序边界', '重排业务约束', '实验评估'],
  levelConfidence: 0.65,
  preferredExampleDomains: ['内容平台', '招聘推荐'],
  personalExampleLimit: 1,
};

const SAMPLE_BLUEPRINT: CourseBlueprint = {
  blueprintId: 'bp-debug-sample',
  protocolVersion: 2,
  topic: SAMPLE_TOPIC,
  intentType: 'skill_mastery',
  mission: {
    why: '把推荐业务目标翻译成召回、排序、重排与评估方案。',
    targetScenario: '能在日常产品工作中与算法团队对齐推荐链路的输入、目标与验证方式。',
    successCriteria: ['画出推荐链路责任边界', '为一个推荐问题设计离线与在线验证方案'],
    constraints: [],
    outOfScope: ['不从零推导数学公式'],
  },
  learnerStartingPoint: {
    estimatedLevel: 'intermediate',
    confirmedKnowledge: SAMPLE_LEARNER.skipBasics,
    likelyGaps: SAMPLE_LEARNER.likelyGaps,
    excludedTopics: SAMPLE_LEARNER.skipBasics,
    levelConfidence: SAMPLE_LEARNER.levelConfidence,
    backgroundSummary: SAMPLE_LEARNER.backgroundSummary,
    preferredExampleDomains: SAMPLE_LEARNER.preferredExampleDomains,
    personalExampleLimit: SAMPLE_LEARNER.personalExampleLimit,
  },
  courseObjectives: [
    {
      objectiveId: 'obj-1',
      description: '建立推荐链路的职责边界',
      observableOutcome: '能判断一个业务问题属于召回、排序、重排还是评估环节',
      importance: 'core',
      evidenceRequirement: 'demonstration',
      conceptKeys: ['召回排序边界'],
    },
    {
      objectiveId: 'obj-2',
      description: '把业务目标转成可验证实验方案',
      observableOutcome: '能写出指标、样本、实验分组与判定规则',
      importance: 'core',
      evidenceRequirement: 'demonstration',
      conceptKeys: ['实验评估'],
    },
  ],
  chapters: [
    {
      chapterId: 'ch-1',
      index: 1,
      title: '推荐链路职责边界',
      objectiveIds: ['obj-1'],
      prerequisites: [],
      teachingGoal: '建立召回、排序、重排和评估的责任边界。',
      completionCriteria: ['能判断一个业务问题落在哪个推荐环节'],
    },
    {
      chapterId: 'ch-2',
      index: 2,
      title: '推荐实验与评估',
      objectiveIds: ['obj-2'],
      prerequisites: ['ch-1'],
      teachingGoal: '把一个业务目标转成可验证的推荐实验。',
      completionCriteria: ['能写出指标、样本、分组与判定规则'],
    },
  ],
  createdAt: Date.now(),
  promptVersion: 'prompt-lab-sample',
  modelVersion: 'debug',
};

const SAMPLE_ARCHITECTURE = {
  architectureVersion: 1,
  courseTopic: SAMPLE_TOPIC,
  thesis: {
    audience: '有互联网产品经验、接触过推荐场景的学习者',
    currentBoundary: ['能描述推荐业务诉求', '还不能独立拆解召回、排序、重排与评估'],
    targetCapability: '能把推荐业务目标翻译成完整的链路与验证方案',
    learningDelta: ['从看指标到判断链路责任', '从经验决策到实验验证'],
    nonGoals: ['不推导复杂数学公式'],
  },
  conceptGraph: [
    {
      conceptId: 'c1-business-to-objective',
      label: '业务目标转译',
      targetDepth: 'apply',
      rationale: '先明确推荐系统要服务什么业务目标。',
      prerequisiteConceptIds: [],
      evidenceIds: [],
    },
    {
      conceptId: 'c2-experiment-decision',
      label: '实验与决策',
      targetDepth: 'transfer',
      rationale: '学完要能验证推荐方案是否真的有效。',
      prerequisiteConceptIds: ['c1-business-to-objective'],
      evidenceIds: [],
    },
  ],
  chapters: [
    {
      chapterId: 'ch-1',
      title: '推荐链路职责边界',
      roleInCourse: '建立召回、排序、重排和评估的诊断框架。',
      conceptIds: ['c1-business-to-objective'],
      deliverable: '能判断一个业务问题属于哪个推荐环节',
      prerequisites: [],
      assessmentMode: 'checkpoint',
    },
    {
      chapterId: 'ch-2',
      title: '推荐实验与评估',
      roleInCourse: '把业务目标转成可验证实验。',
      conceptIds: ['c2-experiment-decision'],
      deliverable: '能设计指标、样本、分组与判定规则',
      prerequisites: ['ch-1'],
      assessmentMode: 'checkpoint',
    },
  ],
  examplePolicy: {
    preferredDomains: ['内容平台', '招聘推荐'],
    personalExampleLimit: 1,
    avoidRepeatedScenarios: true,
  },
};

const SAMPLE_TASKS = [
  {
    taskId: 't1',
    order: 1,
    title: '拆开推荐链路',
    objectiveId: 'obj-1',
    taskGoal: '区分召回、排序、重排和评估各自解决的问题。',
    observableOutcome: '能判断一个推荐问题属于哪个环节。',
    conceptKeys: ['召回排序边界'],
    prerequisiteTaskIds: [],
    teachingPattern: 'compare',
    expectedMinutes: 4,
    evidencePolicy: 'none',
    origin: 'initial',
    status: 'planned',
  },
  {
    taskId: 't2',
    order: 2,
    title: '写出验证方案',
    objectiveId: 'obj-2',
    taskGoal: '把一个推荐业务目标转成可验证实验。',
    observableOutcome: '能写出指标、样本、分组与判定规则。',
    conceptKeys: ['实验评估'],
    prerequisiteTaskIds: ['t1'],
    teachingPattern: 'practice',
    expectedMinutes: 5,
    evidencePolicy: 'checkpoint',
    origin: 'initial',
    status: 'planned',
  },
];

function json(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function outlineFromBlueprint(blueprint: CourseBlueprint) {
  const learner = blueprint.learnerStartingPoint;
  return {
    learningDirection: blueprint.topic,
    learningKeypoint: blueprint.mission.why,
    learningGoal: blueprint.mission.targetScenario,
    learnerPositioning: {
      estimatedLevel: learner.estimatedLevel === 'beginner'
        ? '初级'
        : learner.estimatedLevel === 'advanced'
          ? '高级'
          : '中级',
      levelConfidence: learner.levelConfidence ?? 0.65,
      backgroundSummary: learner.backgroundSummary ?? '',
      skipBasics: learner.confirmedKnowledge,
      likelyGaps: learner.likelyGaps,
      preferredExampleDomains: learner.preferredExampleDomains ?? [],
      personalExampleLimit: learner.personalExampleLimit ?? 1,
    },
  };
}

function buildTaskRequest(
  blueprint: CourseBlueprint,
  chapterPlanOutput: Record<string, unknown>,
  teachingState: Record<string, unknown> | null,
  taskIndex = 0,
) {
  const chapterId = String(chapterPlanOutput.chapterId || blueprint.chapters[0]?.chapterId || 'ch-1');
  const chapter = blueprint.chapters.find((item) => item.chapterId === chapterId) ?? blueprint.chapters[0];
  const tasks = Array.isArray(chapterPlanOutput.tasks)
    ? chapterPlanOutput.tasks as Array<Record<string, unknown>>
    : SAMPLE_TASKS;
  const task = tasks[Math.min(taskIndex, Math.max(0, tasks.length - 1))] ?? SAMPLE_TASKS[0];
  const previousTasks = tasks
    .slice(0, taskIndex)
    .map((item) => ({
      title: String(item.title || ''),
      teachingPattern: String(item.teachingPattern || ''),
      conceptKeys: Array.isArray(item.conceptKeys) ? item.conceptKeys : [],
      exampleScenarios: [],
      takeaway: '',
    }));
  const learner = blueprint.learnerStartingPoint;

  return {
    teachingState,
    courseId: 'course-debug-prompt-lab',
    chapterId: chapter.chapterId,
    planId: `debug-plan-${chapter.chapterId}`,
    planVersion: 1,
    taskId: String(task.taskId || 't1'),
    attempt: 1,
    task: {
      taskId: String(task.taskId || 't1'),
      title: String(task.title || '拆开推荐链路'),
      taskGoal: String(task.taskGoal || '区分推荐链路各环节解决的问题。'),
      teachingPattern: String(task.teachingPattern || 'explain'),
      observableOutcome: String(task.observableOutcome || '能判断推荐问题属于哪个环节。'),
      conceptKeys: Array.isArray(task.conceptKeys) ? task.conceptKeys : [],
    },
    chapter: {
      title: chapter.title,
      teachingGoal: chapter.teachingGoal,
    },
    courseTopic: blueprint.topic,
    courseMission: blueprint.mission,
    learnerStartingPoint: {
      estimatedLevel: learner.estimatedLevel,
      confirmedKnowledge: learner.confirmedKnowledge,
      likelyGaps: learner.likelyGaps,
      excludedTopics: learner.excludedTopics,
      levelConfidence: learner.levelConfidence,
      backgroundSummary: learner.backgroundSummary,
      preferredExampleDomains: learner.preferredExampleDomains,
      personalExampleLimit: learner.personalExampleLimit ?? 1,
    },
    previousTasks,
    nextTaskTitle: tasks[taskIndex + 1]?.title ?? null,
  };
}

export interface PromptLabSnapshot {
  topic: string;
  userProfile: UserProfile | null;
  planningMemory: Record<string, unknown>;
  blueprint: CourseBlueprint;
  chapterId: string;
  teachingState: Record<string, unknown> | null;
  lesson: NodeLesson | null;
}

export function buildPromptLabSnapshot(): PromptLabSnapshot {
  const data = getStoredData();
  const latestCourse = [...data.courses].sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const blueprint = latestCourse?.blueprint ?? SAMPLE_BLUEPRINT;
  const chapterId = latestCourse?.treeView.chapters.find((chapter) => chapter.status === 'available')?.chapterId
    || latestCourse?.treeView.chapters[0]?.chapterId
    || blueprint.chapters[0]?.chapterId
    || 'ch-1';
  const lesson = latestCourse ? loadNodeLesson(latestCourse.courseId, chapterId) : null;

  return {
    topic: blueprint.topic || SAMPLE_TOPIC,
    userProfile: data.userProfile ?? null,
    planningMemory: {
      learnerSnapshot: {
        estimatedLevel: blueprint.learnerStartingPoint.estimatedLevel,
        targetGoal: blueprint.mission.targetScenario,
      },
      transferableBackground: blueprint.learnerStartingPoint.backgroundSummary
        ? [blueprint.learnerStartingPoint.backgroundSummary]
        : [],
      mustCoverConcepts: blueprint.learnerStartingPoint.likelyGaps,
      skippableBasics: blueprint.learnerStartingPoint.confirmedKnowledge,
    },
    blueprint,
    chapterId,
    teachingState: latestCourse?.teachingState ? asRecord(latestCourse.teachingState) : null,
    lesson,
  };
}

export function getPromptLabBlueprint(snapshot: PromptLabSnapshot, artifacts: Record<string, unknown>): CourseBlueprint {
  const fromArtifact = asRecord(artifacts.blueprint);
  if (fromArtifact.protocolVersion === 2 && fromArtifact.blueprintId) {
    return fromArtifact as unknown as CourseBlueprint;
  }

  const chapters = asRecord(artifacts.architect_chapters);
  const meta = asRecord(artifacts.architect_meta);
  if (chapters.chapters && meta.thesis && meta.conceptGraph && meta.examplePolicy) {
    try {
      const outlineLearner = asRecord(
        asRecord(asRecord(artifacts.outline).outline).learnerPositioning,
      );
      const compilerLearner = Object.keys(outlineLearner).length > 0
        ? outlineLearner
        : outlineFromBlueprint(snapshot.blueprint).learnerPositioning;
      const architecture = {
        architectureVersion: 1,
        courseTopic: chapters.courseTopic,
        chapters: chapters.chapters,
        ...meta,
      };
      return compileCourseArchitecture({
        courseId: 'course-debug-prompt-lab',
        architecture: architecture as never,
        learner: compilerLearner as never,
        modelVersion: 'prompt-lab',
      });
    } catch {
      return snapshot.blueprint;
    }
  }
  return snapshot.blueprint;
}

export function buildPromptLabInputs(
  stageId: PromptLabStageId,
  snapshot: PromptLabSnapshot,
  artifacts: Record<string, unknown>,
): Record<string, string | boolean | number> {
  const blueprint = getPromptLabBlueprint(snapshot, artifacts);
  const outline = asRecord(artifacts.outline).outline ?? outlineFromBlueprint(blueprint);
  const learner = asRecord(asRecord(outline).learnerPositioning);
  const chapterPlan = asRecord(artifacts.architect_chapters);
  const meta = asRecord(artifacts.architect_meta);
  const architecture = asRecord(artifacts.architecture);
  const architectureValue = Object.keys(architecture).length > 0
    ? architecture
    : {
        architectureVersion: 1,
        courseTopic: chapterPlan.courseTopic,
        chapters: chapterPlan.chapters,
        ...meta,
      };
  const architectureReady = architectureValue.chapters && architectureValue.thesis && architectureValue.conceptGraph;
  const chapterId = String(artifacts.chapterId || snapshot.chapterId);
  const chapterPlanOutput = asRecord(artifacts.chapter_plan);
  const planForTask = {
    chapterId,
    tasks: Array.isArray(chapterPlanOutput.tasks)
      ? chapterPlanOutput.tasks
      : snapshot.lesson?.chapterPlan?.tasks ?? SAMPLE_TASKS,
  };
  const taskRequest = asRecord(artifacts.task_request);
  const taskRequestValue = Object.keys(taskRequest).length > 0
    ? taskRequest
    : buildTaskRequest(blueprint, planForTask, snapshot.teachingState);
  const emptyMemory: Record<string, unknown> = {};
  const emptySources: unknown[] = [];
  const searchDecision = asRecord(artifacts.task_search_decision);
  const searchToolResults = Array.isArray(searchDecision.toolResults)
    ? searchDecision.toolResults as Array<Record<string, unknown>>
    : [];
  const searchedEvidence = searchToolResults
    .map((item) => String(item.result || '').trim())
    .filter(Boolean)
    .join('\n\n');

  switch (stageId) {
    case 'outline_initial':
      return {
        topic: snapshot.topic,
        userProfile: json(snapshot.userProfile ?? {}),
        planningMemory: json(snapshot.planningMemory),
        history: '[]',
        needsCalibration: false,
      };
    case 'outline_answer': {
      const outlineRaw = String(artifacts.outline_raw || '');
      return {
        topic: snapshot.topic,
        userProfile: json(snapshot.userProfile ?? {}),
        planningMemory: json(snapshot.planningMemory),
        answers: json([
          { questionId: '1', answer: '参与过实际推荐功能设计，但还缺少系统方法。' },
          { questionId: '2', answer: '能看懂基础指标，不能独立设计完整实验。' },
        ]),
        history: json(outlineRaw ? [{ role: 'assistant', content: outlineRaw }] : []),
        needsCalibration: false,
      };
    }
    case 'architect_chapters':
      return {
        topic: blueprint.topic,
        outline: json(outline),
        learner: json(learner),
        memoryContext: json(emptyMemory),
        evidence: '',
        sources: json(emptySources),
        allowSearch: true,
        history: '[]',
      };
    case 'architect_meta':
      return {
        topic: blueprint.topic,
        outline: json(outline),
        learner: json(learner),
        chapterPlan: json(Object.keys(chapterPlan).length ? chapterPlan : SAMPLE_ARCHITECTURE),
        memoryContext: json(emptyMemory),
        evidence: '',
        sources: json(emptySources),
        history: '[]',
      };
    case 'architect_review':
      return {
        learner: json(learner),
        architecture: json(architectureReady ? architectureValue : SAMPLE_ARCHITECTURE),
        history: '[]',
      };
    case 'chapter_plan':
      return {
        blueprint: json({ ...blueprint, teachingState: snapshot.teachingState }),
        chapterId,
        completedChapters: '[]',
        memoryContext: json(emptyMemory),
        evidence: '',
        sources: json(emptySources),
        allowSearch: true,
        history: '[]',
      };
    case 'chapter_plan_review':
      return {
        blueprint: json(blueprint),
        chapterId,
        tasks: json(planForTask.tasks),
        history: '[]',
      };
    case 'task_search_decision':
      return {
        request: json(taskRequestValue),
        evidence: '',
        sources: json(emptySources),
        history: '[]',
      };
    case 'task_content':
      return {
        request: json(taskRequestValue),
        evidence: searchedEvidence,
        sources: json(emptySources),
        memoryContext: json(emptyMemory),
        allowSearch: false,
        history: '[]',
      };
    default:
      return {};
  }
}
