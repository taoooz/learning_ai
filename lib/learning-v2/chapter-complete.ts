// lib/learning-v2/chapter-complete.ts
// V2 章节完成、解锁与读时自愈
// 依据 docs/architecture/v2_课程生成逻辑.md §6.1.1（treeView 只是缓存）与 §9（归档压缩）
// P1a 运行时只在 localStorage：完成/解锁全部在前端闭环，chapters/complete 端点推迟 P5

import type { CourseTreeViewV2, NodeLessonV2, StoredCourseV2 } from '@/types/learning-v2';
import { deriveCourseTreeViewV2, getStoredCourseV2, loadNodeLessonV2, saveStoredCourseV2 } from './storage';

/**
 * 章节是否可完成：所有章节状态停在边界，且计划任务全部完成/跳过。
 * 状态机转换（awaiting_user→completing→completed）由 hook 侧 transitionChapter 强制。
 */
export function canCompleteChapter(lesson: NodeLessonV2): boolean {
  if (lesson.runtime.status !== 'awaiting_user') return false;
  const { completedTaskIds, skippedTaskIds } = lesson.runtime;
  return lesson.chapterPlan.tasks.every(
    (task) => completedTaskIds.includes(task.taskId) || skippedTaskIds.includes(task.taskId),
  );
}

/**
 * 章节完成后刷新课程主对象：以各章 lesson 真实状态重派生 treeView（解锁下一章）。
 * 走读时自愈同一条派生路径，主对象写失败也不影响 lesson 侧事实——课程页会再次自愈。
 */
export function completeChapterV2(courseId: string, chapterId: string): boolean {
  const course = getStoredCourseV2(courseId);
  if (!course) return false;
  const lesson = loadNodeLessonV2(courseId, chapterId);
  if (!lesson || lesson.runtime.status !== 'completed') return false;
  const treeView = refreshCourseTreeViewV2(course);
  return saveStoredCourseV2({ ...course, treeView });
}

/**
 * 读时自愈：扫描各章 lesson 容器的真实 runtime.status，重新派生章节树。
 * 主对象上的 treeView 只当缓存——若出现「写 lesson 成功、写主对象失败」，
 * 仅靠主对象会永久锁死下一章；以 lesson 实际状态为准即可恢复。
 */
export function refreshCourseTreeViewV2(course: StoredCourseV2): CourseTreeViewV2 {
  const completedChapterIds: string[] = [];
  for (const chapter of course.blueprint.chapters) {
    const lesson = loadNodeLessonV2(course.courseId, chapter.chapterId);
    if (lesson && lesson.runtime.status === 'completed') {
      completedChapterIds.push(chapter.chapterId);
    }
  }
  return deriveCourseTreeViewV2(course.courseId, course.blueprint, completedChapterIds);
}

/** 比较两棵章节树是否一致（章节数 + 每章 id 与状态） */
export function isSameCourseTreeView(a: CourseTreeViewV2, b: CourseTreeViewV2): boolean {
  if (a.chapters.length !== b.chapters.length) return false;
  return a.chapters.every(
    (chapter, i) =>
      chapter.chapterId === b.chapters[i].chapterId && chapter.status === b.chapters[i].status,
  );
}
