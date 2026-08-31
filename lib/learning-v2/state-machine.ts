// lib/learning-v2/state-machine.ts
// V2 章节状态机：所有状态转换必须经过领域函数，页面组件不能直接改字符串状态
// 依据 docs/architecture/v2_课程生成逻辑.md §3.1

import type { ChapterRuntimeState, ChapterStatus, CurrentTaskStatus } from '@/types/learning-v2';

/** 章节状态合法转换表（§3.1「合法转换规则」） */
export const CHAPTER_TRANSITIONS: Record<ChapterStatus, readonly ChapterStatus[]> = {
  not_started: ['planning'],
  planning: ['learning'],
  learning: ['learning', 'awaiting_user'], // learning→learning：流式中提问导致任务 partial_paused
  awaiting_user: ['learning', 'checking', 'completing'],
  checking: ['remediating', 'awaiting_user'],
  remediating: ['awaiting_user'],
  completing: ['completed'],
  completed: [],
};

/** 当前任务状态合法转换表（§2.6.1 流中提问、§7 失败重试） */
export const TASK_STATUS_TRANSITIONS: Record<CurrentTaskStatus, readonly CurrentTaskStatus[]> = {
  idle: ['generating'],
  generating: ['streaming', 'failed'],
  streaming: ['partial_paused', 'awaiting_user', 'failed'],
  partial_paused: ['streaming', 'failed'], // 回答完成后同一任务新 attempt 恢复
  awaiting_user: ['completed', 'checking', 'generating'],
  checking: ['awaiting_user'],
  completed: [],
  failed: ['generating'], // 当前任务新 attempt 重试
};

export function canTransitionChapter(from: ChapterStatus, to: ChapterStatus): boolean {
  return CHAPTER_TRANSITIONS[from].includes(to);
}

export function canTransitionTask(from: CurrentTaskStatus, to: CurrentTaskStatus): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}

export type ChapterTransitionResult =
  | { ok: true; runtime: ChapterRuntimeState }
  | { ok: false; reason: string };

/**
 * 章节状态转换领域函数。
 * 非法转换返回 { ok: false } 并说明原因，不抛异常、不改动状态。
 */
export function transitionChapter(
  runtime: ChapterRuntimeState,
  to: ChapterStatus,
  now: number,
): ChapterTransitionResult {
  if (!canTransitionChapter(runtime.status, to)) {
    return {
      ok: false,
      reason: `非法章节状态转换：${runtime.status} → ${to}`,
    };
  }
  if (runtime.status === to) {
    // learning→learning 等自转换仅刷新活跃时间
    return { ok: true, runtime: { ...runtime, lastActiveAt: now } };
  }
  const next: ChapterRuntimeState = { ...runtime, status: to, lastActiveAt: now };
  if (to === 'learning' && runtime.status === 'not_started') {
    next.chapterStartedAt = runtime.chapterStartedAt ?? now;
  }
  return { ok: true, runtime: next };
}

export type TaskTransitionResult =
  | { ok: true; runtime: ChapterRuntimeState }
  | { ok: false; reason: string };

/** 当前任务状态转换领域函数，规则同章节转换 */
export function transitionTask(
  runtime: ChapterRuntimeState,
  to: CurrentTaskStatus,
  now: number,
): TaskTransitionResult {
  if (!canTransitionTask(runtime.currentTaskStatus, to)) {
    return {
      ok: false,
      reason: `非法任务状态转换：${runtime.currentTaskStatus} → ${to}`,
    };
  }
  return { ok: true, runtime: { ...runtime, currentTaskStatus: to, lastActiveAt: now } };
}
