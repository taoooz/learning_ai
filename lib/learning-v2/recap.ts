// lib/learning-v2/recap.ts
// 章节 Recap 本地兜底（文档 §7：降级必须可识别）
// Recap 端点彻底失败时确定性拼装；三个能力证据字段恒为空数组——
// P1 阶段无任何掌握度证据（画像文档 §7.1 红线），LLM 与服务端都不得产出

import type { ChapterRecap, NodeLessonV2 } from '@/types/learning-v2';

/**
 * 本地兜底 Recap：keyTakeaways 取各已完成任务的 boundaryPrompt.takeaway（按计划 order）。
 * 不产出 recommendedReview/nextChapterPreview（无可靠来源，宁缺毋滥）。
 */
export function buildLocalFallbackRecap(lesson: NodeLessonV2): ChapterRecap {
  const takeawayByTaskId = new Map<string, string>();
  for (const item of lesson.streamItems) {
    if (item.type !== 'task_content') continue;
    const takeaway = item.boundaryPrompt?.takeaway?.trim();
    if (takeaway) takeawayByTaskId.set(item.taskId, takeaway);
  }

  const keyTakeaways = [...lesson.chapterPlan.tasks]
    .sort((a, b) => a.order - b.order)
    .filter((task) => lesson.runtime.completedTaskIds.includes(task.taskId))
    .map((task) => takeawayByTaskId.get(task.taskId))
    .filter((takeaway): takeaway is string => Boolean(takeaway));

  return {
    chapterId: lesson.chapterId,
    keyTakeaways,
    demonstratedObjectives: [],
    fragileObjectives: [],
    unresolvedQuestions: [],
    degraded: true,
  };
}
