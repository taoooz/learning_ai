// lib/learning-v2/engagement.ts
// V2 参与信号采集（计划 T8）：轻量埋点，供后续学习行为分析
// 原则：绝不阻断教学——写失败静默；独立 key 环形 500 条，不并入课程主对象

import { getV2CourseEngagementKey } from '../storage';

export type EngagementEventType =
  | 'chapter_opened' // 进入章节学习页
  | 'chapter_continued' // 边界处点「继续学习/完成本章」
  | 'task_completed' // 单任务流式完成
  | 'chapter_completed' // 章节收尾完成
  | 'prefetch_hit' // 边界继续时命中预取缓存（零等待）
  | 'prefetch_missed' // 边界继续时未命中预取（无缓存/在途/版本不匹配）
  | 'recap_completed' // 章节 Recap 完成（含本地兜底）
  | 'tutor_question_submitted' // P2 流内答疑：用户提交问题（含入队与立即回答）
  | 'tutor_answer_completed' // P2 流内答疑：回答完成终态
  | 'tutor_answer_failed' // P2 流内答疑：回答失败终态（含本地合成失败）
  | 'exited'; // 离开章节学习页（卸载）

export interface EngagementEvent {
  eventType: EngagementEventType;
  chapterId?: string;
  taskId?: string;
  /** 事件发生时间戳（ms） */
  at: number;
}

/** 环形上限：每课程最多保留最近 500 条，防无限增长 */
const MAX_EVENTS_PER_COURSE = 500;

/** 追加一条参与信号；任何异常静默吞掉（埋点不能反过来影响教学主流程） */
export function recordEngagementEvent(
  courseId: string,
  event: Omit<EngagementEvent, 'at'>,
): void {
  try {
    if (typeof window === 'undefined') return;
    const events = readEngagementEvents(courseId);
    events.push({ ...event, at: Date.now() });
    const trimmed = events.slice(-MAX_EVENTS_PER_COURSE);
    window.localStorage.setItem(getV2CourseEngagementKey(courseId), JSON.stringify(trimmed));
  } catch {
    // 存储满/隐私模式等：静默
  }
}

/** 读取某课程的参与信号（损坏数据归一为空数组） */
export function readEngagementEvents(courseId: string): EngagementEvent[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(getV2CourseEngagementKey(courseId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EngagementEvent[]) : [];
  } catch {
    return [];
  }
}
