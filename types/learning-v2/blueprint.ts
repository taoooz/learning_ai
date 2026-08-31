// types/learning-v2/blueprint.ts
// V2 课程蓝图：整门课的稳定契约
// 依据 docs/architecture/v2_课程生成逻辑.md §2.1
// P0 范围说明：仅定义 P1 实际消费的类型，Evidence/Checkpoint 推迟到 P3 前定稿

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

export interface CourseBlueprintV2 {
  blueprintId: string;
  protocolVersion: 2;
  topic: string;
  intentType: LearningIntentType;
  targetScenario: string;
  learnerStartingPoint: LearnerStartingPoint;
  courseObjectives: LearningObjective[];
  successCriteria: string[];
  chapters: ChapterDefinition[];
  createdAt: number;
  promptVersion: string;
  modelVersion: string;
}

// ---- 课程级存储与目录视图（V1/V2 分发、章节列表渲染消费） ----

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
  createdAt: number;
}
