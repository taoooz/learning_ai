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
