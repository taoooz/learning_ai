// types/learning-v2/learning-stream.ts
// V2 学习流：用户实际学习经历的持久记录
// 依据 docs/architecture/v2_课程生成逻辑.md §2.4 / §2.5
// 范围说明：
// - 内容块仅保留文档建议的第一版 4 种（Process/Visualization/Code/Reflection 后续按需扩展）
// - UserQuestionItem / TutorAnswerItem 随 P2 流内答疑引入（设计文档 §2.1）
// - SupplementalItem / CheckpointItem / CheckpointResultItem 属 P3，暂未定义
// - NodeLessonV2.evidence 用 unknown[] 占位，LearningEvidence 类型 P3 前定稿

import type { ChapterPlan } from './chapter-plan';
import type { GenerationMeta } from './generation-meta';
import type { ChapterRuntimeState } from './runtime';

// ---- 内容块（第一版 4 种） ----

export interface MarkdownBlock {
  type: 'markdown';
  blockId: string;
  markdown: string;
}

export interface KeyPointBlock {
  type: 'key_point';
  blockId: string;
  title?: string;
  points: string[];
}

export interface ExampleBlock {
  type: 'example';
  blockId: string;
  title: string;
  context: string;
  content: string;
  takeaway: string;
}

export interface ComparisonBlock {
  type: 'comparison';
  blockId: string;
  columns: string[];
  rows: string[][];
}

export type LearningContentBlock = MarkdownBlock | KeyPointBlock | ExampleBlock | ComparisonBlock;

// ---- 任务生成结果 ----

/** 任务边界提示：任务完成后展示的可带走要点与下一步预告 */
export interface TaskBoundaryPrompt {
  takeaway?: string;
  nextHint?: string;
}

/** 内容引用来源（搜索工具产出，P1b 起消费） */
export interface SourceRef {
  title: string;
  url: string;
}

export interface GeneratedTask {
  taskId: string;
  planVersion: number;
  title: string;
  blocks: LearningContentBlock[];
  boundaryPrompt: TaskBoundaryPrompt;
  sourceRefs?: SourceRef[];
  generationMeta: GenerationMeta;
}

// ---- Stream Item ----

export type StreamItemStatus = 'pending' | 'streaming' | 'complete' | 'failed' | 'superseded';

/** Tutor 条目状态（P2）：问题无流式态，回答可经历 streaming */
export type TutorItemStatus = 'pending' | 'streaming' | 'complete' | 'failed';

export interface StreamItemBase {
  itemId: string;
  type: string;
  chapterId: string;
  taskId?: string;
  planVersion: number;
  /** 显式排序键：顺序不能依赖数组写入竞态（文档 §2.5 关键规则） */
  sequence: number;
  createdAt: number;
  status: StreamItemStatus;
}

/** 任务内容：一个任务完成展示后固化的内容记录 */
export interface TaskContentItem extends StreamItemBase {
  type: 'task_content';
  taskId: string;
  title: string;
  blocks: LearningContentBlock[];
  boundaryPrompt?: TaskBoundaryPrompt;
  sourceRefs?: SourceRef[];
}

/** 任务过渡：从一个任务推进到下一个任务的轨迹标记 */
export interface TaskTransitionItem extends StreamItemBase {
  type: 'task_transition';
  fromTaskId: string;
  toTaskId: string;
}

/** 系统通知：失败提示、版本冲突说明等非教学性消息 */
export interface SystemNoticeItem extends StreamItemBase {
  type: 'system_notice';
  tone: 'info' | 'warning' | 'error';
  message: string;
  code?: string;
}

/**
 * 用户提问条目（P2 流内答疑，设计文档 §2.1）。
 * itemId 约定 `uq:{questionId}`：重复事件按确定性 itemId upsert，不产生重复条目。
 */
export interface UserQuestionItem extends StreamItemBase {
  type: 'user_question';
  taskId: string;
  questionId: string;
  text: string;
  status: 'pending' | 'complete' | 'failed';
}

/**
 * Tutor 回答条目（P2 流内答疑，设计文档 §2.1）。
 * itemId 约定 `ta:{questionId}`；第一版只允许 markdown 内容块。
 */
export interface TutorAnswerItem extends StreamItemBase {
  type: 'tutor_answer';
  taskId: string;
  questionId: string;
  blocks: Extract<LearningContentBlock, { type: 'markdown' }>[];
  status: TutorItemStatus;
  errorMessage?: string;
}

/**
 * P0–P2 学习流条目联合。
 * 完整协议还包含 SupplementalItem / CheckpointItem / CheckpointResultItem，P3 引入。
 */
export type LearningStreamItem =
  | TaskContentItem
  | TaskTransitionItem
  | SystemNoticeItem
  | ChapterRecapItem
  | UserQuestionItem
  | TutorAnswerItem;

// ---- 章节回顾 ----

/**
 * 章节回顾（Recap）。
 * 证据红线（画像文档 §7.1）：demonstratedObjectives / fragileObjectives /
 * unresolvedQuestions 是能力证据字段，P1 阶段无任何掌握度证据，
 * 一律由服务端/本地兜底确定性填空数组，LLM 不得产出；UI 对空区不渲染。
 */
export interface ChapterRecap {
  chapterId: string;
  keyTakeaways: string[];
  demonstratedObjectives: string[];
  fragileObjectives: string[];
  unresolvedQuestions: string[];
  recommendedReview?: string;
  nextChapterPreview?: string;
  /** 本地兜底生成标记（§7：降级必须可识别）；LLM 正常产出时不带此字段 */
  degraded?: boolean;
}

/** 章节回顾条目：章节完成收尾时固化到学习流（P1b 引入） */
export interface ChapterRecapItem extends StreamItemBase {
  type: 'chapter_recap';
  recap: ChapterRecap;
}

// ---- 章节学习容器 ----

/**
 * V2 章节学习容器：计划 + 运行时状态 + 学习流的聚合根。
 * 按章节独立存储（文档 §9 存储治理），不并入课程主对象。
 */
export interface NodeLessonV2 {
  protocolVersion: 2;
  chapterId: string;
  chapterPlan: ChapterPlan;
  runtime: ChapterRuntimeState;
  streamItems: LearningStreamItem[];
  /** 学习证据：类型 P3 前定稿，P0 仅预留占位，禁止写入任何内容 */
  evidence: unknown[];
  recap?: ChapterRecap;
  /** 已完成章节的压缩归档标记（§6.1.1）：正文块已替换为摘要块 */
  archived?: boolean;
  updatedAt: number;
}
