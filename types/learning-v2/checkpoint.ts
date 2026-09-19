// types/learning-v2/checkpoint.ts
// P3 证据型理解检查：Checkpoint 定义、提交、评估与学习证据
// 依据 docs/architecture/v2_课程生成逻辑.md §2.7 + v2_项目综述.md P3 范围
// P3a 范围：结构化类型（scenario_choice / sequence）先上线，程序判分；
// 开放式类型（self_explanation / micro_practice / error_diagnosis）待回归样本验证后启用

import type { GenerationMeta } from './generation-meta';

/** P3a 结构化题型（程序可判分）；开放式类型 P3b 按回归验证结果启用 */
export type CheckpointKind = 'scenario_choice' | 'sequence';

/** Checkpoint 评估结果（§2.7） */
export type CheckpointOutcome = 'demonstrated' | 'partial' | 'not_demonstrated' | 'skipped';

/** 评估后的推荐动作 */
export type CheckpointNextAction = 'continue' | 'remediate_here' | 'insert_remediation_task';

/** 学习证据：区分能力证据（demonstration）与行为信号/自我报告 */
export interface LearningEvidence {
  objectiveId: string;
  checkpointId: string;
  outcome: CheckpointOutcome;
  score?: number;
  /** 补救前取得的证据轮次（1 = 首次，2 = 补救后） */
  attempt: number;
  recordedAt: number;
}

/** Checkpoint 题目定义（Python 生成，SSE 下发） */
export interface CheckpointDefinition {
  checkpointId: string;
  objectiveId: string;
  taskId: string;
  conceptKeys: string[];
  kind: CheckpointKind;
  /** 题目描述 */
  prompt: string;
  /** scenario_choice 的选项 */
  options?: Array<{ id: string; text: string }>;
  /** sequence 题的选项（按乱序展示，用户排序后提交 id 序列） */
  sequenceItems?: Array<{ id: string; text: string }>;
  /** 正确答案：scenario_choice 为选项 id；sequence 为 id 有序数组 */
  correctAnswer: string | string[];
  /** 补救提示（首次回答错误后展示） */
  remediationHint: string;
  estimatedSeconds: number;
  generationMeta: GenerationMeta;
}

/** 用户提交的答案 */
export interface CheckpointSubmission {
  checkpointId: string;
  /** scenario_choice: optionId；sequence: id 有序数组 */
  answer: string | string[];
  attempt: number;
}

/** 服务端评估结果 */
export interface CheckpointEvaluation {
  checkpointId: string;
  outcome: CheckpointOutcome;
  score?: number;
  /** 结构化题固定 1.0（程序判分，确定性） */
  confidence: number;
  feedback: string;
  nextAction: CheckpointNextAction;
  /** 是否正确（结构化题程序判分唯一确定） */
  correct: boolean;
  /** 正确答案（回答错误时展示） */
  correctAnswer?: string | string[];
}

/** Checkpoint 学习流条目：承载定义 + 用户答案 + 评估结果 */
export interface CheckpointItem {
  itemId: string;
  sequence: number;
  createdAt: number;
  type: 'checkpoint';
  taskId: string;
  checkpoint: CheckpointDefinition;
  /** 用户最近一次提交的答案（重试覆盖） */
  submission?: CheckpointSubmission;
  /** 最近一次评估结果 */
  evaluation?: CheckpointEvaluation;
  status: 'pending' | 'submitted' | 'evaluated';
}

// ---- API 载荷 ----

/** POST /api/learning/v2/checkpoints/evaluate 请求 */
export interface CheckpointEvaluateRequest {
  courseId: string;
  chapterId: string;
  taskId: string;
  checkpointId: string;
  answer: string | string[];
  attempt: number;
  idempotencyKey: string;
}

/** POST /api/learning/v2/checkpoints/evaluate 响应 */
export interface CheckpointEvaluateResponse {
  evaluation: CheckpointEvaluation;
  generationMeta: GenerationMeta;
}

/** 生成 Checkpoint 请求（任务完成后按 objectiveId 生成） */
export interface CheckpointGenerateRequest {
  courseId: string;
  chapterId: string;
  taskId: string;
  objectiveId: string;
  taskContentSummary: string;
  idempotencyKey: string;
}
