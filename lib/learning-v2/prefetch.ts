// lib/learning-v2/prefetch.ts
// 单任务预取纯函数（P1b，文档 §6.1）
// 规则：只预取当前任务之后的一个任务，绑定 planId + planVersion + taskId（§2.3）；
// 预取失败静默丢弃不打扰阅读；废弃预取不进学习流；
// 异步结果消费前校验版本，不匹配判 live，预取事件绝不写入 streamItems（§13）

import type { LearningSseEvent, NodeLessonV2 } from '@/types/learning-v2';

/** 内存预取缓存条目（hook ref 持有，不落盘；P4 计划补丁落地前不写 runtime） */
export interface PrefetchCacheEntry {
  taskId: string;
  planId: string;
  planVersion: number;
  events: LearningSseEvent[];
  complete: boolean;
}

/**
 * 判断当前是否可启动预取，返回待预取任务 id；不可则返回 null。
 * 条件：边界等待态（章节与当前任务均 awaiting_user）+ 存在下一任务（末任务边界返回 null）
 * + 该任务尚无缓存。
 */
export function canStartPrefetch(
  lesson: NodeLessonV2,
  phase: string,
  cacheHas: (taskId: string) => boolean,
): string | null {
  if (phase !== 'boundary') return null;
  const { runtime } = lesson;
  if (runtime.status !== 'awaiting_user' || runtime.currentTaskStatus !== 'awaiting_user') {
    return null;
  }
  const sortedTasks = [...lesson.chapterPlan.tasks].sort((a, b) => a.order - b.order);
  const currentIndex = sortedTasks.findIndex((task) => task.taskId === runtime.currentTaskId);
  const nextTask = currentIndex >= 0 ? sortedTasks[currentIndex + 1] : undefined;
  if (!nextTask) return null;
  if (cacheHas(nextTask.taskId)) return null;
  return nextTask.taskId;
}

/**
 * 重编号：把预取事件的 sequence 平移到 startSequence 起，
 * 使重放条目排序键严格大于全部既有条目。
 * 只变换未落盘的预取事件外壳，不改写任何已有记录。
 */
export function renumberSseEvents(
  events: LearningSseEvent[],
  startSequence: number,
): LearningSseEvent[] {
  return events.map((event, index) => ({ ...event, sequence: startSequence + index }));
}

export type PrefetchConsumption =
  | { kind: 'replay'; events: LearningSseEvent[] }
  | { kind: 'live' };

/**
 * 边界点「继续」时裁决预取消费方式：
 * - 命中（缓存完整 且 taskId/planId/planVersion 全匹配）→ replay，返回重编号后的事件序列
 * - 未命中（无缓存 / 仍在途 / 版本或任务不匹配）→ live，交给即时生成
 */
export function resolvePrefetchConsumption(
  lesson: NodeLessonV2,
  entry: PrefetchCacheEntry | null | undefined,
  expectedTaskId: string,
): PrefetchConsumption {
  if (!entry || !entry.complete) return { kind: 'live' };
  if (entry.taskId !== expectedTaskId) return { kind: 'live' };
  if (entry.planId !== lesson.chapterPlan.planId) return { kind: 'live' };
  if (entry.planVersion !== lesson.chapterPlan.planVersion) return { kind: 'live' };
  return {
    kind: 'replay',
    events: renumberSseEvents(entry.events, lesson.runtime.latestSequence + 1),
  };
}
