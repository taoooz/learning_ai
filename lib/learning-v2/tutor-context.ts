// lib/learning-v2/tutor-context.ts
// P2 流内答疑最小请求上下文构造（设计文档 §3.2）
// 只发送：课程主题、本章标题与教学目标、当前任务信息、当前任务已完成展示的内容块
// （拼接后 ≤6000 字符）、当前任务最近 3 组已完成问答（问题 ≤300 字符 / 回答 ≤1200 字符）、
// 当前问题与稳定幂等键。
// 严禁发送整门课程对象、V1 聊天全量历史或模型思维过程。
// 载荷契约与 python-agent/schemas/tutor.py InlineTutorRequest 逐字段对齐（严格模式拒收多余字段）

import type { LearningContentBlock, NodeLessonV2 } from '@/types/learning-v2';

/** 当前任务已展示内容总字符上限（设计文档 §3.2 固定上限） */
export const TUTOR_VISIBLE_CONTENT_LIMIT = 6000;
/** 单条问题字符上限 */
export const TUTOR_QUESTION_CHAR_LIMIT = 300;
/** 单条回答字符上限 */
export const TUTOR_ANSWER_CHAR_LIMIT = 1200;
/** 最近问答保留组数 */
export const TUTOR_RECENT_QA_COUNT = 3;

export interface InlineTutorChapterInfo {
  title: string;
  teachingGoal: string;
}

export interface InlineTutorTaskInfo {
  taskId: string;
  title: string;
  taskDescription: string;
}

/** 一组历史问答（已按字符上限截断） */
export interface InlineTutorQA {
  question: string;
  answer: string;
}

/** 流内答疑请求载荷：最小上下文契约，严禁扩展为课程全量对象 */
export interface InlineTutorRequestPayload {
  mode: 'inline_tutor';
  courseTopic: string;
  chapter: InlineTutorChapterInfo;
  task: InlineTutorTaskInfo;
  visibleContent: string;
  recentInlineQA: InlineTutorQA[];
  question: { questionId: string; text: string };
  idempotencyKey: string;
}

export interface BuildInlineTutorContextArgs {
  courseTopic: string;
  chapter: InlineTutorChapterInfo;
  task: InlineTutorTaskInfo;
  lesson: NodeLessonV2;
  questionId: string;
  question: string;
  idempotencyKey: string;
}

/** 按字符上限截断：截断点落在代理对中间时退后一位，避免产生半截字符 */
function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/** 内容块文本化：Tutor 回答只参考已展示块的文本内容（第一版 4 种块全覆盖） */
function contentBlockToText(block: LearningContentBlock): string {
  switch (block.type) {
    case 'markdown':
      return block.markdown;
    case 'key_point':
      return [block.title, ...block.points].filter((part) => Boolean(part)).join('\n');
    case 'example':
      return [block.title, block.context, block.content, block.takeaway]
        .filter((part) => Boolean(part))
        .join('\n');
    case 'comparison':
      return [block.columns, ...block.rows].map((row) => row.join(' | ')).join('\n');
  }
}

/** 提取当前任务已完成展示的内容块，拼接后按上限截断（设计文档 §3.2） */
function extractVisibleContent(lesson: NodeLessonV2, taskId: string): string {
  const texts: string[] = [];
  for (const item of lesson.streamItems) {
    if (item.type !== 'task_content' || item.taskId !== taskId || item.status !== 'complete') {
      continue;
    }
    for (const block of item.blocks) {
      const text = contentBlockToText(block).trim();
      if (text) texts.push(text);
    }
  }
  return truncateText(texts.join('\n\n'), TUTOR_VISIBLE_CONTENT_LIMIT);
}

/**
 * 提取当前任务最近若干组已完成问答（设计文档 §3.2）。
 * 只取回答已完成的组；排除本次正在提问的 questionId，
 * 避免重试场景下与 question 字段自引用重复。
 */
function extractRecentInlineQA(
  lesson: NodeLessonV2,
  taskId: string,
  currentQuestionId: string,
): InlineTutorQA[] {
  const pairs: Array<{ sequence: number; qa: InlineTutorQA }> = [];
  for (const item of lesson.streamItems) {
    if (item.type !== 'user_question' || item.taskId !== taskId) continue;
    if (item.questionId === currentQuestionId) continue;
    const answerItem = lesson.streamItems.find(
      (candidate) => candidate.type === 'tutor_answer' && candidate.questionId === item.questionId,
    );
    if (!answerItem || answerItem.type !== 'tutor_answer' || answerItem.status !== 'complete') {
      continue;
    }
    const answer = answerItem.blocks
      .map((block) => block.markdown)
      .join('\n\n')
      .trim();
    if (!answer) continue;
    pairs.push({
      sequence: item.sequence,
      qa: {
        question: truncateText(item.text, TUTOR_QUESTION_CHAR_LIMIT),
        answer: truncateText(answer, TUTOR_ANSWER_CHAR_LIMIT),
      },
    });
  }
  return pairs
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-TUTOR_RECENT_QA_COUNT)
    .map((entry) => entry.qa);
}

/**
 * 构造流内答疑请求载荷（纯函数）。
 * 入参 lesson 只用于提取当前任务的最小上下文，不整体进入请求。
 */
export function buildInlineTutorContext(args: BuildInlineTutorContextArgs): InlineTutorRequestPayload {
  return {
    mode: 'inline_tutor',
    courseTopic: args.courseTopic,
    chapter: { title: args.chapter.title, teachingGoal: args.chapter.teachingGoal },
    task: {
      taskId: args.task.taskId,
      title: args.task.title,
      taskDescription: args.task.taskDescription,
    },
    visibleContent: extractVisibleContent(args.lesson, args.task.taskId),
    recentInlineQA: extractRecentInlineQA(args.lesson, args.task.taskId, args.questionId),
    question: {
      questionId: args.questionId,
      text: truncateText(args.question.trim(), TUTOR_QUESTION_CHAR_LIMIT),
    },
    idempotencyKey: args.idempotencyKey,
  };
}
