// types/learning-v2/events.ts
// V2 SSE 事件协议：统一外壳 + 任务事件 + Tutor 事件 + 通用事件
// 依据 docs/architecture/v2_课程生成逻辑.md §5 与 docs/architecture/p2-流内答疑第一阶段设计.md §2.2
// P2 范围说明：Tutor 回答事件已引入；请求错误仍用 request_error，传输收尾仍用 request_completed
// P2 四意图：tutor_completed 载荷携带 action（教学动作分类），供 UI 与持久化使用

import type {
  GeneratedTask,
  LearningContentBlock,
  MarkdownBlock,
  SourceRef,
} from './learning-stream';

export type TaskSseEventType =
  | 'task_started'
  | 'content_block_started'
  | 'content_block_delta'
  | 'content_block_completed'
  | 'sources_ready'
  | 'task_completed';

/** Tutor 回答事件类型（P2 流内答疑，设计文档 §2.2） */
export type TutorSseEventType =
  | 'tutor_started'
  | 'tutor_block_started'
  | 'tutor_block_delta'
  | 'tutor_block_completed'
  | 'tutor_completed';

export type CommonSseEventType = 'request_warning' | 'request_error' | 'request_completed';

export type LearningSseEventType = TaskSseEventType | TutorSseEventType | CommonSseEventType;

/** 统一事件外壳：所有学习流请求共用 */
export interface LearningSseEvent<T = unknown> {
  eventId: string;
  requestId: string;
  type: LearningSseEventType;
  courseId: string;
  chapterId: string;
  taskId?: string;
  /** Tutor 事件携带（设计文档 §2.2 守卫字段）；任务事件不带 */
  questionId?: string;
  planVersion: number;
  /** 单请求内严格递增；客户端按 eventId 去重（§5 规则） */
  sequence: number;
  timestamp: number;
  payload: T;
}

// ---- 任务事件载荷 ----

export interface TaskStartedPayload {
  taskId: string;
  title: string;
}

export interface ContentBlockStartedPayload {
  blockId: string;
  blockType: LearningContentBlock['type'];
}

export interface ContentBlockDeltaPayload {
  blockId: string;
  /** markdown 文本增量 */
  delta: string;
}

export interface ContentBlockCompletedPayload {
  block: LearningContentBlock;
}

export interface SourcesReadyPayload {
  sources: SourceRef[];
}

export interface TaskCompletedPayload {
  task: GeneratedTask;
}

// ---- Tutor 事件载荷（P2 流内答疑） ----

/** P2 教学动作四意图（§2.6.2） */
export type TutorActionType =
  | 'answer_inline'
  | 'expand_current'
  | 'switch_explanation'
  | 'proceed';

export type TutorReasonCode =
  | 'LOCAL_QUESTION'
  | 'NEEDS_EXAMPLE'
  | 'NEEDS_MORE_DETAIL'
  | 'EXPLANATION_MISMATCH'
  | 'USER_READY';

export interface TutorAction {
  type: TutorActionType;
  reasonCode: TutorReasonCode;
}

/** Tutor 回答开始：与问题绑定，后续事件经 questionId/requestId 守卫 */
export interface TutorStartedPayload {
  questionId: string;
}

/** Tutor 块开始：第一版固定单个 markdown 块 */
export interface TutorBlockStartedPayload {
  blockId: string;
}

export interface TutorBlockDeltaPayload {
  blockId: string;
  /** markdown 文本增量 */
  delta: string;
}

export interface TutorBlockCompletedPayload {
  block: MarkdownBlock;
}

/** Tutor 回答完成：携带定稿的全部 markdown 块与教学动作分类 */
export interface TutorCompletedPayload {
  questionId: string;
  blocks: MarkdownBlock[];
  action: TutorAction;
}

// ---- 通用事件载荷 ----

export interface RequestWarningPayload {
  code: string;
  message: string;
}

/** 稳定 code + 可展示 message + retryable，不向用户暴露内部堆栈（§5 规则） */
export interface RequestErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

/** 仅表示传输完成，不等于业务对象已持久化（§5 规则） */
export interface RequestCompletedPayload {
  requestId: string;
}
