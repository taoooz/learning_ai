// lib/learning-v2/checkpoint-generation.ts
// Checkpoint 生成失败通知的纯函数：统一文案、重试判定与局部清理，便于测试。

import type { NodeLesson, SystemNoticeItem } from '@/types/learning-v2';

export const CHECKPOINT_GENERATION_FAILED_MESSAGE =
  '理解检查生成失败，可重新生成；本章也可直接完成，但不会产生掌握记录。';

export function isCheckpointGenerationFailure(item: SystemNoticeItem): boolean {
  return item.code === 'CHECKPOINT_GENERATION_FAILED';
}

export function canRetryCheckpointGeneration(
  item: SystemNoticeItem,
  hasRetryHandler: boolean,
): boolean {
  return (
    isCheckpointGenerationFailure(item) &&
    item.retryable !== false &&
    !!item.taskId &&
    hasRetryHandler
  );
}

/** 只清除目标任务的失败通知，保留其他任务和 Tutor 的系统消息。 */
export function clearCheckpointGenerationNotice(
  lesson: NodeLesson,
  taskId: string,
  now = Date.now(),
): NodeLesson {
  return {
    ...lesson,
    streamItems: lesson.streamItems.filter(
      (item) => !(
        item.type === 'system_notice' &&
        isCheckpointGenerationFailure(item) &&
        item.taskId === taskId
      ),
    ),
    updatedAt: now,
  };
}
