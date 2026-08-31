// lib/learning-v2/archive.ts
// 已完成章节的压缩归档（文档 §6.1.1 存储治理，P1b 完成定义之一）
// 正文块替换为单条摘要块，控制 localStorage 容量；摘要用现成 takeaway，不额外调 LLM

import type { MarkdownBlock, NodeLessonV2, TaskContentItem } from '@/types/learning-v2';

/** 摘要截断长度：首个 markdown 块兜底时最多保留的字符数 */
const SUMMARY_MAX_LENGTH = 80;

/** 归档摘要块的确定性 blockId（同一任务内唯一即可） */
const ARCHIVED_SUMMARY_BLOCK_ID = 'archived-summary';

/**
 * 单任务摘要三级兜底（纯函数）：
 * ① boundaryPrompt.takeaway → ② 首个 markdown 块截断（80 字加省略号）→ ③ 任务标题
 */
export function summarizeTaskContent(item: TaskContentItem): string {
  const takeaway = item.boundaryPrompt?.takeaway?.trim();
  if (takeaway) return takeaway;

  const firstMarkdown = item.blocks.find((block) => block.type === 'markdown');
  if (firstMarkdown && firstMarkdown.type === 'markdown') {
    const text = firstMarkdown.markdown.trim();
    if (text) {
      return text.length > SUMMARY_MAX_LENGTH
        ? `${text.slice(0, SUMMARY_MAX_LENGTH)}…`
        : text;
    }
  }

  return item.title;
}

/**
 * 归档已完成章节：task_content 正文块替换为单条摘要块。
 * 保留：标题、章节计划、Recap、evidence、transition/notice/recap 等其余条目。
 * 幂等：已归档原样返回。
 */
export function archiveCompletedLesson(lesson: NodeLessonV2, now: number): NodeLessonV2 {
  if (lesson.archived) return lesson;

  const streamItems = lesson.streamItems.map((item) => {
    if (item.type !== 'task_content') return item;
    const summaryBlock: MarkdownBlock = {
      type: 'markdown',
      blockId: ARCHIVED_SUMMARY_BLOCK_ID,
      markdown: summarizeTaskContent(item),
    };
    return { ...item, blocks: [summaryBlock] };
  });

  return { ...lesson, streamItems, archived: true, updatedAt: now };
}
