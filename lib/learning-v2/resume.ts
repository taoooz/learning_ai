// lib/learning-v2/resume.ts
// 刷新恢复决策：纯函数，依据 lesson 运行时状态决定下一步动作
// 九分支对应计划 T7：①无 lesson→生成计划 ②completed→完成卡 ③planning 无内容→最小 order 任务
// ④awaiting_user→渲染已有+边界 ⑤流式残留→新 attempt ⑥failed→重试 ⑦脏 pendingRequest→忽略
// ⑧损坏 null 由 storage 归一为 null（等同①）⑨章节 locked 在页面层重定向，不进此函数

import type { NodeLessonV2 } from '@/types/learning-v2';

export type ResumeAction =
  | { kind: 'generate_plan' }
  | { kind: 'render_completed' }
  | { kind: 'render_boundary'; taskId: string }
  | { kind: 'start_task'; taskId: string; attempt: number };

/**
 * 根据 lesson 当前状态决定恢复动作。
 * 原则：进行中的任务（generating/streaming/partial_paused）一律视为中断，
 * 用新 attempt 重新生成（确定性 itemId 会 upsert 覆盖半截块），不做断点续传。
 */
export function decideResumeAction(lesson: NodeLessonV2 | null): ResumeAction {
  // ①⑧ 无 lesson（含损坏被归一为 null）：从头生成计划
  if (!lesson) return { kind: 'generate_plan' };

  const runtime = lesson.runtime;

  // ② 章节已完成：直接渲染完成卡
  if (runtime.status === 'completed') return { kind: 'render_completed' };

  // ②-bis（P1b）：completing 异步缝隙（Recap 生成中刷新）→ 回末任务边界，
  // 用户再点「完成本章」即走 finishChapter 重入路径。
  // 与下方兜底分支形态相同，但兜底依赖「全部任务已完成」才到达这里，
  // 此分支须显式前置并有测试保证，否则 completing 无自转换会造成收尾死锁。
  if (runtime.status === 'completing') {
    const lastCompleted = lastCompletedTaskId(lesson);
    if (lastCompleted) return { kind: 'render_boundary', taskId: lastCompleted };
    return { kind: 'generate_plan' }; // completing 但无任何完成任务：异常态，重来
  }

  // ⑥ 当前任务失败：以新 attempt 重新生成（hook 侧自动执行一次）
  if (runtime.currentTaskStatus === 'failed' && runtime.currentTaskId) {
    return { kind: 'start_task', taskId: runtime.currentTaskId, attempt: nextAttempt(lesson) };
  }

  // ④ 停在任务边界：渲染已有内容 + 边界按钮
  if (
    runtime.status === 'awaiting_user' &&
    runtime.currentTaskId &&
    runtime.completedTaskIds.includes(runtime.currentTaskId)
  ) {
    return { kind: 'render_boundary', taskId: runtime.currentTaskId };
  }

  // ⑤ 流式/生成残留视为中断：对 currentTaskId 发新 attempt
  if (
    runtime.currentTaskId &&
    (runtime.currentTaskStatus === 'streaming' ||
      runtime.currentTaskStatus === 'generating' ||
      runtime.currentTaskStatus === 'partial_paused')
  ) {
    return { kind: 'start_task', taskId: runtime.currentTaskId, attempt: nextAttempt(lesson) };
  }

  // ③ planning 且无进行中任务：从计划中最小 order 的 planned 任务开始（首次请求，attempt 1）
  if (runtime.status === 'planning') {
    const firstTask = firstUnfinishedTask(lesson);
    if (firstTask) return { kind: 'start_task', taskId: firstTask, attempt: 1 };
    return { kind: 'generate_plan' }; // 计划为空等异常：重新生成计划
  }

  // 兜底：找下一个未完成任务；全部完成则回到末任务边界等用户收尾
  const nextTask = firstUnfinishedTask(lesson);
  if (nextTask) return { kind: 'start_task', taskId: nextTask, attempt: 1 };
  const lastCompleted = lastCompletedTaskId(lesson);
  if (lastCompleted) return { kind: 'render_boundary', taskId: lastCompleted };
  return { kind: 'generate_plan' };
}

/** 中断恢复的下一 attempt：以 pendingRequest 记录的 attempt 为基线 +1，至少 2 */
function nextAttempt(lesson: NodeLessonV2): number {
  return Math.max((lesson.runtime.pendingRequest?.attempt ?? 1) + 1, 2);
}

/** 计划中第一个未完成/未跳过的任务（按 order 升序） */
function firstUnfinishedTask(lesson: NodeLessonV2): string | null {
  const { runtime, chapterPlan } = lesson;
  const sorted = [...chapterPlan.tasks].sort((a, b) => a.order - b.order);
  for (const task of sorted) {
    if (runtime.completedTaskIds.includes(task.taskId)) continue;
    if (runtime.skippedTaskIds.includes(task.taskId)) continue;
    return task.taskId;
  }
  return null;
}

/** 最后完成的任务 id（按计划 order），用于「全部完成但未收尾」的兜底边界 */
function lastCompletedTaskId(lesson: NodeLessonV2): string | null {
  const { runtime, chapterPlan } = lesson;
  const sorted = [...chapterPlan.tasks].sort((a, b) => a.order - b.order);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (runtime.completedTaskIds.includes(sorted[i].taskId)) return sorted[i].taskId;
  }
  return null;
}
