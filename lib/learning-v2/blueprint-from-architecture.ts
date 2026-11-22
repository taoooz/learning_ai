// 把 CourseArchitecture 编译成当前稳定的 CourseBlueprint 协议。
// 模型负责课程设计，本模块只做确定性映射、引用检查和默认值补齐。

import type {
  CourseArchitecture,
  ConceptTargetDepth,
} from '@/types/learning-v2/course-architecture';
import type {
  ChapterDefinition,
  CourseBlueprint,
  EvidenceRequirement,
  LearningObjective,
  ObjectiveImportance,
} from '@/types/learning-v2/blueprint';
import type { OutlineLearnerPositioning } from '@/types/outline';
import { inferIntentType, normalizeEstimatedLevel } from './blueprint-map';

export const BLUEPRINT_ARCHITECTURE_COMPILER_VERSION = 'course-architecture-compiler-v1';

export interface CompileCourseArchitectureInput {
  courseId: string;
  architecture: CourseArchitecture;
  learner: OutlineLearnerPositioning;
  modelVersion?: string;
  now?: number;
}

const DEPTH_RANK: Record<ConceptTargetDepth, number> = {
  skip: 0,
  refresh: 1,
  understand: 2,
  apply: 3,
  transfer: 4,
};

function objectiveImportance(depths: ConceptTargetDepth[]): ObjectiveImportance {
  const maxDepth = Math.max(...depths.map((depth) => DEPTH_RANK[depth]));
  if (maxDepth >= DEPTH_RANK.apply) return 'core';
  if (maxDepth >= DEPTH_RANK.understand) return 'supporting';
  return 'optional';
}

function evidenceRequirement(mode: CourseArchitecture['chapters'][number]['assessmentMode']): EvidenceRequirement {
  if (mode === 'checkpoint') return 'demonstration';
  if (mode === 'self_report') return 'self_report';
  return 'exposure';
}

function assertArchitectureReferences(architecture: CourseArchitecture): void {
  const conceptIds = new Set<string>();
  for (const concept of architecture.conceptGraph) {
    if (conceptIds.has(concept.conceptId)) throw new Error(`概念 ID 重复：${concept.conceptId}`);
    conceptIds.add(concept.conceptId);
  }
  const chapterIds = new Set<string>();
  for (const chapter of architecture.chapters) {
    if (chapterIds.has(chapter.chapterId)) throw new Error(`章节 ID 重复：${chapter.chapterId}`);
    chapterIds.add(chapter.chapterId);
  }
  for (const chapter of architecture.chapters) {
    for (const conceptId of chapter.conceptIds) {
      if (!conceptIds.has(conceptId)) throw new Error(`章节 ${chapter.chapterId} 引用了不存在的概念：${conceptId}`);
    }
    for (const prerequisite of chapter.prerequisites) {
      if (!chapterIds.has(prerequisite)) throw new Error(`章节 ${chapter.chapterId} 的前置章节不存在：${prerequisite}`);
    }
  }
}

export function compileCourseArchitecture(input: CompileCourseArchitectureInput): CourseBlueprint {
  const { courseId, architecture, learner } = input;
  const now = input.now ?? Date.now();
  assertArchitectureReferences(architecture);

  const conceptById = new Map(architecture.conceptGraph.map((concept) => [concept.conceptId, concept]));
  const objectiveIdByChapter = new Map(
    architecture.chapters.map((chapter, index) => [chapter.chapterId, `obj-${index + 1}`]),
  );

  const courseObjectives: LearningObjective[] = architecture.chapters.map((chapter) => {
    const depths = chapter.conceptIds.map((id) => conceptById.get(id)?.targetDepth ?? 'skip');
    return {
      objectiveId: objectiveIdByChapter.get(chapter.chapterId)!,
      description: chapter.roleInCourse,
      observableOutcome: chapter.deliverable,
      importance: objectiveImportance(depths),
      evidenceRequirement: evidenceRequirement(chapter.assessmentMode),
      conceptKeys: chapter.conceptIds.map((id) => conceptById.get(id)?.label).filter((label): label is string => Boolean(label)),
    };
  });

  // 课程必须至少有一个 core 目标；全部为 refresh/understand 时提升最后一个非空目标。
  if (!courseObjectives.some((objective) => objective.importance === 'core') && courseObjectives.length > 0) {
    courseObjectives[courseObjectives.length - 1].importance = 'core';
  }

  const chapters: ChapterDefinition[] = architecture.chapters.map((chapter, index) => ({
    chapterId: chapter.chapterId,
    index: index + 1,
    title: chapter.title,
    objectiveIds: [objectiveIdByChapter.get(chapter.chapterId)!],
    prerequisites: chapter.prerequisites,
    teachingGoal: chapter.roleInCourse,
    completionCriteria: [chapter.deliverable],
  }));

  const goalText = [
    architecture.thesis.targetCapability,
    ...architecture.thesis.learningDelta,
    ...architecture.chapters.map((chapter) => chapter.deliverable),
  ].join('，');

  return {
    blueprintId: `bp-${courseId}`,
    protocolVersion: 2,
    topic: architecture.courseTopic,
    intentType: inferIntentType(goalText),
    mission: {
      why: architecture.thesis.learningDelta[0] || architecture.thesis.targetCapability,
      targetScenario: architecture.thesis.targetCapability,
      successCriteria: architecture.chapters.map((chapter) => chapter.deliverable),
      constraints: [],
      outOfScope: architecture.thesis.nonGoals,
    },
    learnerStartingPoint: {
      estimatedLevel: normalizeEstimatedLevel(learner.estimatedLevel),
      confirmedKnowledge: learner.skipBasics ?? [],
      likelyGaps: learner.likelyGaps ?? [],
      excludedTopics: learner.skipBasics ?? [],
      levelConfidence: learner.levelConfidence,
      backgroundSummary: learner.backgroundSummary,
      preferredExampleDomains: learner.preferredExampleDomains?.length
        ? learner.preferredExampleDomains
        : architecture.examplePolicy.preferredDomains,
      personalExampleLimit: learner.personalExampleLimit ?? architecture.examplePolicy.personalExampleLimit,
    },
    courseObjectives,
    chapters,
    createdAt: now,
    promptVersion: BLUEPRINT_ARCHITECTURE_COMPILER_VERSION,
    modelVersion: input.modelVersion || 'course-architecture-derived',
  };
}
