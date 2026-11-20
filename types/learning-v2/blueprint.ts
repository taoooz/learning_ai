// types/learning-v2/blueprint.ts
// V2 课程蓝图：整门课的稳定契约
// 依据 docs/architecture/v2_课程生成逻辑.md §2.1
// P0 范围说明：仅定义 P1 实际消费的类型，Evidence/Checkpoint 推迟到 P3 前定稿

import type { CourseGlossaryTerm, CourseReference } from './course-reference';
import type { CourseTeachingState } from './teaching-state';

export type LearningIntentType =
  | 'conceptual_understanding'
  | 'skill_mastery'
  | 'problem_solving'
  | 'fast_review';

export type LearnerEstimatedLevel = 'beginner' | 'intermediate' | 'advanced';

export interface LearnerStartingPoint {
  estimatedLevel: LearnerEstimatedLevel;
  confirmedKnowledge: string[];
  likelyGaps: string[];
  excludedTopics: string[];
}

export type ObjectiveImportance = 'core' | 'supporting' | 'optional';

export type EvidenceRequirement = 'exposure' | 'self_report' | 'demonstration';

export interface LearningObjective {
  objectiveId: string;
  description: string;
  observableOutcome: string;
  importance: ObjectiveImportance;
  evidenceRequirement: EvidenceRequirement;
  conceptKeys: string[];
}

export interface ChapterDefinition {
  chapterId: string;
  index: number;
  title: string;
  objectiveIds: string[];
  prerequisites: string[];
  teachingGoal: string;
  completionCriteria: string[];
}

/**
 * 课程使命：这门课为什么存在，以及完成时如何判断。
 * 使命属于课程契约，不写入全局用户记忆；长期目标与偏好由 memory 层维护。
 */
export interface CourseMission {
  /** 用户真实动机；避免“了解 X”这类抽象表述 */
  why: string;
  /** 学完后要面对的真实场景 */
  targetScenario: string;
  /** 可观察完成标准 */
  successCriteria: string[];
  /** 时间、预算、学习方式等约束 */
  constraints: string[];
  /** 当前明确不追的相邻主题 */
  outOfScope: string[];
}

export interface CourseBlueprintV2 {
  blueprintId: string;
  protocolVersion: 2;
  topic: string;
  intentType: LearningIntentType;
  targetScenario: string;
  /** V2 课程使命。旧课程缺省时按 targetScenario/successCriteria 兼容读取。 */
  mission?: CourseMission;
  learnerStartingPoint: LearnerStartingPoint;
  courseObjectives: LearningObjective[];
  successCriteria: string[];
  chapters: ChapterDefinition[];
  createdAt: number;
  promptVersion: string;
  modelVersion: string;
}

// ---- 课程级存储与目录视图（章节列表渲染消费） ----

export type ChapterTreeStatus = 'locked' | 'available' | 'completed';

export interface ChapterTreeViewItem {
  chapterId: string;
  index: number;
  title: string;
  status: ChapterTreeStatus;
}

export interface CourseTreeViewV2 {
  courseId: string;
  topic: string;
  totalChapters: number;
  chapters: ChapterTreeViewItem[];
}

/**
 * V2 课程存储容器：挂在全局存储 StoredDataV2.v2Courses 下。
 * blueprint 不携带 courseId（协议见文档 §2.1），课程实例与蓝图的关联在存储层维护。
 */
export interface StoredCourseV2 {
  courseId: string;
  blueprint: CourseBlueprintV2;
  treeView: CourseTreeViewV2;
  /** 课程参考资料；由章节完成后的学习内容确定性沉淀 */
  references?: CourseReference[];
  /** 课程统一术语表；后续任务 prompt 可复用，保证术语一致 */
  glossary?: CourseGlossaryTerm[];
  /** 课程级教学状态：待反馈材料、可复用素材和课程内备注 */
  teachingState?: CourseTeachingState;
  createdAt: number;
}
