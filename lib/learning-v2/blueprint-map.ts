// lib/learning-v2/blueprint-map.ts
// V1 TOC 结果 → V2 课程蓝图映射（过渡层）
// 依据 docs/architecture/v2_课程生成逻辑.md §2.1 蓝图契约；
// P1a 阶段不新建 V2 蓝图生成链，TOC 落库时由本模块派生蓝图（见实施计划 T1）。
// 映射产物必须通过 validateCourseBlueprintV2；不通过则调用方降级纯 V1，绝不半写。
// 后续阶段接入真实 V2 蓝图生成链后，本模块可整体替换。

import type {
  ChapterDefinition,
  CourseBlueprintV2,
  LearningIntentType,
  LearningObjective,
  LearnerEstimatedLevel,
} from '@/types/learning-v2';

/** 映射层 prompt 版本标记（区别于 LLM 生成的蓝图） */
export const BLUEPRINT_MAP_PROMPT_VERSION = 'blueprint-map-v1';
/** 映射产物无模型参与，modelVersion 显式标明派生来源 */
export const BLUEPRINT_MAP_MODEL_VERSION = 'derived-none';

export interface TocNodeInput {
  index: number;
  title: string;
  description: string;
}

export interface TocOutlineInput {
  topic: string;
  learningDirection?: string;
  learningGoal?: string;
  learnerPositioning: {
    estimatedLevel: string;
    skipBasics?: string[];
  };
}

export interface MapTocToBlueprintInput {
  courseId: string;
  courseName: string;
  description: string;
  nodes: TocNodeInput[];
  outline: TocOutlineInput;
  now?: number;
}

/**
 * 归一化 V1 水平值到 V2 枚举。
 * V1 存在中英文混合枚举（'初级'/'beginner' 等，见 types/outline.ts），未知值按 beginner。
 */
export function normalizeEstimatedLevel(value: string | undefined): LearnerEstimatedLevel {
  switch ((value ?? '').trim()) {
    case 'intermediate':
    case '中级':
      return 'intermediate';
    case 'advanced':
    case '高级':
      return 'advanced';
    case 'novice':
    case 'beginner':
    case '初级':
    case '':
    default:
      return 'beginner';
  }
}

/** 按学习诉求关键词推断意图类型（无关键词命中按概念理解） */
export function inferIntentType(text: string): LearningIntentType {
  if (/复习|速成|快速|突击/.test(text)) return 'fast_review';
  if (/解决|排障|排查|诊断|故障|问题/.test(text)) return 'problem_solving';
  if (/实操|动手|搭建|步骤|流程|怎么做/.test(text)) return 'skill_mastery';
  return 'conceptual_understanding';
}

/**
 * 将 V1 TOC 结果映射为 V2 蓝图（纯函数）。
 * 每章派生一个 core 目标，章节依赖为线性链；
 * observableOutcome/completionCriteria 用行为化模板句，保证通过蓝图校验。
 */
export function mapTocToBlueprintV2(input: MapTocToBlueprintInput): CourseBlueprintV2 {
  const { courseId, courseName, description, nodes, outline } = input;
  const now = input.now ?? Date.now();
  const goalText = [outline.learningGoal, outline.learningDirection].filter(Boolean).join('，');

  const courseObjectives: LearningObjective[] = nodes.map((node, i) => {
    const index = node.index ?? i + 1;
    return {
      objectiveId: `obj-${index}`,
      description: node.description.trim() || node.title,
      observableOutcome: `能用自己的话说明「${node.title}」的核心要点，并完成对应练习`,
      importance: 'core',
      evidenceRequirement: 'exposure',
      conceptKeys: [],
    };
  });

  const chapters: ChapterDefinition[] = nodes.map((node, i) => {
    const index = node.index ?? i + 1;
    return {
      chapterId: `ch-${index}`,
      index,
      title: node.title,
      objectiveIds: [`obj-${index}`],
      prerequisites: i > 0 ? [`ch-${nodes[i - 1].index ?? i}`] : [],
      teachingGoal: node.description.trim() || node.title,
      completionCriteria: [`能说明「${node.title}」的核心要点`, '完成本章全部学习任务'],
    };
  });

  return {
    blueprintId: `bp-${courseId}`,
    protocolVersion: 2,
    topic: courseName.trim() || outline.topic,
    intentType: inferIntentType(goalText),
    targetScenario: (description || goalText || courseName).trim(),
    learnerStartingPoint: {
      estimatedLevel: normalizeEstimatedLevel(outline.learnerPositioning.estimatedLevel),
      confirmedKnowledge: [],
      likelyGaps: [],
      excludedTopics: outline.learnerPositioning.skipBasics ?? [],
    },
    courseObjectives,
    successCriteria: [`完成全部 ${chapters.length} 个章节的学习任务`],
    chapters,
    createdAt: now,
    promptVersion: BLUEPRINT_MAP_PROMPT_VERSION,
    modelVersion: BLUEPRINT_MAP_MODEL_VERSION,
  };
}
