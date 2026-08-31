// lib/learning-v2/tutor-queue.ts
// Tutor 问题队列（P2 流内答疑）：纯函数层，依据设计文档 §3.3
// - 同一章节的问题按提交顺序（条目 sequence）串行回答
// - 回答状态非 complete/failed 的问题（含尚无回答条目）视为未回答；
//   失败回答不入队（重试是用户显式动作，不走自动队列）
// - 自动窗口上限 3 由消费方（hook 启动逻辑）用 slice 截取，
//   纯函数层只暴露计数与排序，不删除超出窗口的问题
// 所有函数均为纯函数：不修改入参，输出完全由输入决定

import type { NodeLessonV2, TutorAnswerItem, UserQuestionItem } from '@/types/learning-v2';

/** 自动处理窗口上限：最多 3 个未回答问题进入自动处理，超出部分排队等待（§3.3） */
export const TUTOR_AUTO_WINDOW_LIMIT = 3;

/**
 * 待答问题队列：所有未回答的用户问题，按提交顺序（sequence 升序）排列。
 * 判定以配对回答条目的状态为准：无回答条目，或回答状态为 pending/streaming，
 * 均视为未回答；complete/failed 为终态，移出自动队列。
 */
export function getPendingTutorQuestions(lesson: NodeLessonV2): UserQuestionItem[] {
  const answers = new Map<string, TutorAnswerItem>();
  for (const item of lesson.streamItems) {
    if (item.type === 'tutor_answer') answers.set(item.questionId, item);
  }
  return lesson.streamItems
    .filter((item): item is UserQuestionItem => item.type === 'user_question')
    .filter((question) => {
      const answer = answers.get(question.questionId);
      return !answer || (answer.status !== 'complete' && answer.status !== 'failed');
    })
    .sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt);
}

/** 队列中最早一题（无待答问题时返回 undefined）。纯函数，不修改输入 */
export function takeNextTutorQuestion(lesson: NodeLessonV2): UserQuestionItem | undefined {
  return getPendingTutorQuestions(lesson)[0];
}

/** 未回答问题总数（含超出自动窗口的部分） */
export function countUnansweredTutorQuestions(lesson: NodeLessonV2): number {
  return getPendingTutorQuestions(lesson).length;
}
