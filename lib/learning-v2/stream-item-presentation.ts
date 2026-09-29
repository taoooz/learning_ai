// lib/learning-v2/stream-item-presentation.ts
// 学习流条目的展示规则。容器仍保留完整 system_notice（审计/恢复），
// 这里只决定 UI 是否展示：错误一旦被成功重试解决，不再惊扰用户。

import type {
  LearningStreamItem,
  NodeLessonV2,
  SystemNoticeItem,
  TaskContentItem,
  TutorAnswerItem,
} from '@/types/learning-v2';

function isTaskNoticeResolved(item: SystemNoticeItem, lesson: NodeLessonV2): boolean {
  if (!item.taskId) return false;
  return lesson.streamItems.some(
    (streamItem): streamItem is TaskContentItem =>
      streamItem.type === 'task_content' &&
      streamItem.taskId === item.taskId &&
      streamItem.status === 'complete',
  );
}

function isTutorNoticeResolved(item: SystemNoticeItem, lesson: NodeLessonV2): boolean {
  if (!item.questionId) return false;
  return lesson.streamItems.some(
    (streamItem): streamItem is TutorAnswerItem =>
      streamItem.type === 'tutor_answer' &&
      streamItem.questionId === item.questionId &&
      streamItem.status === 'complete',
  );
}

/** 错误通知对应的请求已成功完成时，UI 应隐藏该通知。 */
export function isResolvedErrorNotice(
  item: LearningStreamItem,
  lesson: NodeLessonV2,
): boolean {
  if (item.type !== 'system_notice' || item.tone !== 'error') return false;
  return isTaskNoticeResolved(item, lesson) || isTutorNoticeResolved(item, lesson);
}
