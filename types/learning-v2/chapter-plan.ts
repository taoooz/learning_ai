// types/learning-v2/chapter-plan.ts
// V2 章节计划：章节目标 → 3～7 个短任务的拆分契约
// 依据 docs/architecture/v2_课程生成逻辑.md §2.2

import type { GenerationMeta } from './generation-meta';

export type ChapterPlanStatus = 'draft' | 'active' | 'completed' | 'superseded';

export type TaskTeachingPattern =
  | 'explain'
  | 'worked_example'
  | 'compare'
  | 'process'
  | 'derive'
  | 'practice'
  | 'case_analysis'
  | 'recap';

export type TaskEvidencePolicy = 'none' | 'self_report' | 'checkpoint';

export type TaskOrigin = 'initial' | 'remediation' | 'extension' | 'user_requested';

export type PlannedTaskStatus = 'planned' | 'prefetched' | 'active' | 'completed' | 'skipped';

export interface PlannedTask {
  taskId: string;
  order: number;
  title: string;
  objectiveId: string;
  taskGoal: string;
  observableOutcome: string;
  conceptKeys: string[];
  prerequisiteTaskIds: string[];
  teachingPattern: TaskTeachingPattern;
  expectedMinutes: number;
  evidencePolicy: TaskEvidencePolicy;
  origin: TaskOrigin;
  status: PlannedTaskStatus;
}

export interface ChapterPlan {
  chapterId: string;
  planId: string;
  planVersion: number;
  objectiveIds: string[];
  tasks: PlannedTask[];
  status: ChapterPlanStatus;
  createdAt: number;
  updatedAt: number;
  generationMeta: GenerationMeta;
  /** P4：已应用的计划补丁数（每章上限 MAX_PLAN_PATCHES_PER_CHAPTER） */
  appliedPatchCount?: number;
}

// ---- 计划校验结果（拦截项见文档 §2.2「计划校验必须拦截」） ----

export interface PlanValidationIssue {
  code: string;
  taskId?: string;
  message: string;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: PlanValidationIssue[];
  warnings: PlanValidationIssue[];
}

// ---- P4 动态调度：计划补丁 ----

/** 补丁操作白名单（§P4）：只允许未展示任务的结构化调整 */
export type PlanPatchOperationType =
  | 'insert_task'      // 插入前置/补救任务
  | 'skip_task'        // 压缩：跳过冗余任务（基于强先验证据）
  | 'reorder_tasks'    // 重排剩余任务顺序
  | 'adjust_depth';    // 调整任务深度（简要/详细）

export interface PlanPatchOperation {
  type: PlanPatchOperationType;
  /** insert_task 新任务数据（其余操作为目标 taskId） */
  newTask?: PlannedTask;
  /** 目标任务（skip/reorder/adjust_depth） */
  targetTaskIds: string[];
  /** reorder: 新顺序（仅剩余任务的 taskId 序列） */
  newOrder?: string[];
  /** adjust_depth: 目标深度 */
  depth?: 'brief' | 'standard' | 'detailed';
}

/** 计划补丁：版本化、可追溯、可拒绝旧结果（P4 §完成定义） */
export interface ChapterPlanPatch {
  patchId: string;
  /** 补丁基于的计划版本（应用时必须与当前 planVersion 一致） */
  basePlanVersion: number;
  operations: PlanPatchOperation[];
  /** 用户可见的简短调整说明（非技术化） */
  summary: string;
  /** 触发原因代码 */
  reasonCode: 'STRONG_PRIOR_EVIDENCE' | 'USER_REQUESTED_DEPTH' | 'DEPENDENCY_DISCOVERED' | 'REMEDIATION_GAP';
  confidence: number;
  createdAt: number;
}

/** 每章动态调整上限（§P4「每章动态调整次数有上限」） */
export const MAX_PLAN_PATCHES_PER_CHAPTER = 2;
/** 高影响调整（insert/skip）的置信度阈值 */
export const HIGH_IMPACT_CONFIDENCE_THRESHOLD = 0.8;
