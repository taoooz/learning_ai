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
    remediationAttempt: 0,
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

  // P3a：评估结果同步写入学习证据（§2.7 学习证据写入章节状态）
  const evidence: LearningEvidence = {
    objectiveId: item.checkpoint.objectiveId,
    checkpointId,
    outcome: evaluation.outcome,
    score: evaluation.score,
    attempt,
    recordedAt: now,
  };
  // 同一 checkpoint 的证据按最新覆盖（重试后以最终结果为准）
  const existingEvidence = lesson.evidence.filter((e) => e.checkpointId !== checkpointId);

  return {
    ...lesson,
    streamItems: lesson.streamItems.map((s) => (s === item ? updated : s)),
    evidence: [...existingEvidence, evidence],
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


/**
 * 补救流程（§2.7）：首次错误后 LLM 生成补救内容 + 等价不同题。
 * 补救内容写入条目、新 checkpoint 定义替换旧题、回到 pending 状态等待用户重试。
 */
export function applyRemediation(
  lesson: NodeLessonV2,
  checkpointId: string,
  remediationContent: string,
  newCheckpoint: CheckpointDefinition,
  now: number,
): NodeLessonV2 {
  const item = lesson.streamItems.find(
    (existing): existing is CheckpointItem =>
      existing.type === 'checkpoint' && existing.checkpoint.checkpointId === checkpointId,
  );
  if (!item) return lesson;

  const updated: CheckpointItem = {
    ...item,
    checkpoint: newCheckpoint,
    remediationContent,
    remediationAttempt: item.remediationAttempt + 1,
    submission: undefined,
    evaluation: undefined,
    status: 'pending',
  };

  return {
    ...lesson,
    streamItems: lesson.streamItems.map((s) => (s === item ? updated : s)),
    runtime: { ...lesson.runtime, lastActiveAt: now },
    updatedAt: now,
  };
}


/**
 * P3a Evidence 聚合（§2.7）：从学习证据中提取每个目标的最终结果，
 * 填充 Recap 的 demonstratedObjectives / fragileObjectives。
 * - 最终 outcome 为 demonstrated → demonstratedObjectives
 * - 最终 outcome 为 not_demonstrated / partial → fragileObjectives
 * - skipped → 不算证据（明确跳过，P2 Recap 红线不伪造）
 */
export function aggregateEvidenceToObjectives(
  evidence: LearningEvidence[],
): { demonstratedObjectives: string[]; fragileObjectives: string[] } {
  const latest = new Map<string, LearningEvidence>();
  for (const e of evidence) {
    const existing = latest.get(e.objectiveId);
    if (!existing || e.recordedAt >= existing.recordedAt) {
      latest.set(e.objectiveId, e);
    }
  }
  const demonstratedObjectives: string[] = [];
  const fragileObjectives: string[] = [];
  for (const [objectiveId, e] of latest) {
    if (e.outcome === 'demonstrated') demonstratedObjectives.push(objectiveId);
    else if (e.outcome === 'not_demonstrated' || e.outcome === 'partial') fragileObjectives.push(objectiveId);
  }
  return { demonstratedObjectives, fragileObjectives };
}
