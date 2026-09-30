// lib/memory/learning-records.ts
// Checkpoint 证据 → 用户记忆投影：课程层保留原始 evidence，
// 这里只在章节完成时生成可跨课程复用的 ConceptState 更新事件。

import type { MemoryEvent } from '@/types/course';
import type { NodeLessonV2 } from '@/types/learning-v2';

/**
 * 把章节 Checkpoint 证据转换成 memory events。
 * 规则：只投影有评估结果的检查；概念缺失时回退到 objectiveId，
 * 不把“内容被覆盖”当作掌握。
 */
export function buildCheckpointMemoryEvents(
  lesson: NodeLessonV2,
  topic: string,
  courseId: string,
  now: number,
): MemoryEvent[] {
  const checkpointItems = lesson.streamItems.filter(
    (item) => item.type === 'checkpoint' && item.evaluation,
  );

  const events: MemoryEvent[] = [];
  for (const item of checkpointItems) {
    if (item.type !== 'checkpoint' || !item.evaluation) continue;
    const concepts = item.checkpoint.conceptKeys.length
      ? item.checkpoint.conceptKeys
      : [item.checkpoint.objectiveId];

    for (const concept of concepts) {
      events.push({
        type: 'checkpoint_evaluated',
        topic,
        courseId,
        occurredAt: now,
        payload: {
          conceptId: concept,
          conceptName: concept,
          objectiveId: item.checkpoint.objectiveId,
          checkpointId: item.checkpoint.checkpointId,
          outcome: item.evaluation.outcome,
          isCorrect: item.evaluation.correct,
          attempt: item.submission?.attempt ?? 0,
          prompt: item.checkpoint.prompt,
          feedback: item.evaluation.feedback,
        },
      });
    }
  }

  return events;
}
