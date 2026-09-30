// lib/learning-v2/checkpoint-gate.ts
// 章末理解检查闸门：最后一个任务完成前，必须先完成 Checkpoint。

import type { NodeLessonV2 } from '@/types/learning-v2';

export type CheckpointGateReason =
  | 'generating'
  | 'awaiting_answer'
  | 'remediation_required';

export interface ChapterCheckpointGate {
  blocked: boolean;
  reason?: CheckpointGateReason;
}

/**
 * 判断当前边界是否允许完成本章。
 *
 * 规则：
 * - 只有最后一个任务且 evidencePolicy=checkpoint 时启用闸门；
 * - 检查题未生成 → blocked=generating；
 * - 检查题未提交 → blocked=awaiting_answer；
 * - 首次答错且 nextAction=remediate_here → blocked=remediation_required；
 * - 二次错误 nextAction=continue，允许完成但保留 not_demonstrated 证据；
 * - Checkpoint 生成失败会写入 CHECKPOINT_GENERATION_FAILED 通知，此时不永久锁死章节。
 */
export function evaluateChapterCheckpointGate(lesson: NodeLessonV2): ChapterCheckpointGate {
  const sortedTasks = [...lesson.chapterPlan.tasks].sort((a, b) => a.order - b.order);
  const finalTask = sortedTasks.at(-1);
  if (!finalTask || finalTask.evidencePolicy !== 'checkpoint') return { blocked: false };

  const checkpointItem = lesson.streamItems.find(
    (item) => item.type === 'checkpoint' && item.taskId === finalTask.taskId,
  );

  if (!checkpointItem) {
    const generationFailed = lesson.streamItems.some(
      (item) =>
        item.type === 'system_notice' &&
        item.code === 'CHECKPOINT_GENERATION_FAILED' &&
        item.taskId === finalTask.taskId,
    );
    return generationFailed
      ? { blocked: false }
      : { blocked: true, reason: 'generating' };
  }

  if (checkpointItem.type === 'checkpoint') {
    if (!checkpointItem.evaluation) {
      return { blocked: true, reason: 'awaiting_answer' };
    }
    if (checkpointItem.evaluation.nextAction === 'remediate_here') {
      return { blocked: true, reason: 'remediation_required' };
    }
  }

  return { blocked: false };
}
