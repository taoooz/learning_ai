// lib/learning-v2/checkpoint-ops.ts
// P3a Checkpoint 客户端纯函数：检查是否需要 checkpoint、upsert checkpoint 条目、评估结果写入

import type {
  CheckpointDefinition,
  CheckpointEvaluation,
  CheckpointItem,
  LearningEvidence,
  NodeLessonV2,
} from '@/types/learning-v2';

/** 查找当前任务已有的 checkpoint 条目 */
export function findCheckpointForTask(
  lesson: NodeLessonV2,
  taskId: string,
): CheckpointItem | undefined {
  return lesson.streamItems.find(
    (item): item is CheckpointItem => item.type === 'checkpoint' && item.taskId === taskId,
  );
}

/** 当前任务是否需要 Checkpoint（evidencePolicy=checkpoint 且尚无条目） */
export function needsCheckpoint(
  lesson: NodeLessonV2,
  taskId: string,
): boolean {
  const task = lesson.chapterPlan.tasks.find((t) => t.taskId === taskId);
  if (!task || task.evidencePolicy !== 'checkpoint') return false;
  return !findCheckpointForTask(lesson, taskId);
}

/** upsert CheckpointItem 到学习流（幂等：同 checkpointId 不重复） */
export function upsertCheckpointItem(
  lesson: NodeLessonV2,
  checkpoint: CheckpointDefinition,
  now: number,
): NodeLessonV2 {
  const existing = lesson.streamItems.find(
    (item): item is CheckpointItem =>
      item.type === 'checkpoint' && item.checkpoint.checkpointId === checkpoint.checkpointId,
  );
  if (existing) return lesson;
  const item: CheckpointItem = {
    itemId: `checkpoint:${checkpoint.checkpointId}`,
    type: 'checkpoint',
    taskId: checkpoint.taskId,
    sequence: lesson.runtime.latestSequence + 1,
    createdAt: now,
    checkpoint,
    status: 'pending',
  };
  return {
    ...lesson,
    streamItems: [...lesson.streamItems, item],
    runtime: {
      ...lesson.runtime,
      latestSequence: item.sequence,
      status: lesson.runtime.status === 'awaiting_user' ? 'checking' : lesson.runtime.status,
      lastActiveAt: now,
    },
    updatedAt: now,
  };
}

/** 写入评估结果到 checkpoint 条目 + 回到 awaiting_user */
export function applyCheckpointEvaluation(
  lesson: NodeLessonV2,
  checkpointId: string,
  submissionAnswer: string | string[],
  evaluation: CheckpointEvaluation,
  now: number,
): NodeLessonV2 {
  const item = lesson.streamItems.find(
    (existing): existing is CheckpointItem =>
      existing.type === 'checkpoint' && existing.checkpoint.checkpointId === checkpointId,
  );
  if (!item) return lesson;

  const attempt = (item.submission?.attempt ?? 0) + 1;
  const updated: CheckpointItem = {
    ...item,
    submission: { checkpointId, answer: submissionAnswer, attempt },
    evaluation,
    status: 'evaluated',
  };

  return {
    ...lesson,
    streamItems: lesson.streamItems.map((s) => (s === item ? updated : s)),
    runtime: {
      ...lesson.runtime,
      status: lesson.runtime.status === 'checking' ? 'awaiting_user' : lesson.runtime.status,
      lastActiveAt: now,
    },
    updatedAt: now,
  };
}

/** 从已完成章节的 checkpoint 条目提取学习证据（章节完成时聚合用） */
export function collectEvidence(lesson: NodeLessonV2): LearningEvidence[] {
  const evidence: LearningEvidence[] = [];
  for (const item of lesson.streamItems) {
    if (item.type !== 'checkpoint' || !item.evaluation) continue;
    if (item.evaluation.outcome === 'skipped') continue;
    evidence.push({
      objectiveId: item.checkpoint.objectiveId,
      checkpointId: item.checkpoint.checkpointId,
      outcome: item.evaluation.outcome,
      score: item.evaluation.score,
      attempt: item.submission?.attempt ?? 1,
      recordedAt: item.createdAt,
    });
  }
  return evidence;
}
