// lib/learning-v2/course-list.ts
// 首页「最近学习」的课程清单：只读当前课程容器 v2Courses，派生进度与下一章。

import type { StoredCourseV2 } from '@/types/learning-v2';
import { getStoredDataV2, getV2ChapterStorageKey, saveStoredDataV2 } from '@/lib/storage';
import { getLessonRepository } from './lesson-repository';

export interface CourseListEntry {
  courseId: string;
  topic: string;
  totalChapters: number;
  completedChapters: number;
  /** 0–100 的完成度 */
  percent: number;
  /** 下一章标题；全部完成时为 null */
  nextChapterTitle: string | null;
  createdAt: number;
}

/** 把 V2 课程容器映射为首页卡片所需字段（纯函数） */
export function toCourseListEntry(course: StoredCourseV2): CourseListEntry {
  const chapters = [...course.treeView.chapters].sort((a, b) => a.index - b.index);
  const totalChapters = chapters.length;
  const completedChapters = chapters.filter((chapter) => chapter.status === 'completed').length;
  const nextChapter = chapters.find((chapter) => chapter.status !== 'completed') ?? null;

  return {
    courseId: course.courseId,
    topic: course.treeView.topic,
    totalChapters,
    completedChapters,
    percent: totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0,
    nextChapterTitle: nextChapter?.title ?? null,
    createdAt: course.createdAt,
  };
}

/** 读取全部 V2 课程，按创建时间升序（页面自行决定倒序展示） */
export function listCoursesV2(): CourseListEntry[] {
  if (typeof window === 'undefined') return [];
  const courses = getStoredDataV2().v2Courses;
  return [...courses].sort((a, b) => a.createdAt - b.createdAt).map(toCourseListEntry);
}

export function getCourseTopicV2(courseId: string): string | null {
  if (typeof window === 'undefined') return null;
  const course = (getStoredDataV2().v2Courses).find((item) => item.courseId === courseId);
  return course?.treeView.topic ?? null;
}

/** 纯函数：从课程列表中移除指定课程 */
export function removeCourseFromList(
  courses: readonly StoredCourseV2[],
  courseId: string,
): StoredCourseV2[] {
  return courses.filter((course) => course.courseId !== courseId);
}

/**
 * 删除课程：server 模式先删服务端数据；随后移除本地容器 + 清掉各章学习流 key。
 * 服务端删除失败时仍清本地缓存（beta 产品允许用户重新拉取/重建）。
 */
export async function deleteCourseV2(courseId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const target = (getStoredDataV2().v2Courses)
    .find((course) => course.courseId === courseId) ?? null;

  // local 模式这里会移除本地课程容器；server 模式只删服务端数据。
  await getLessonRepository().deleteCourse(courseId);

  const current = getStoredDataV2();
  saveStoredDataV2({
    ...current,
    v2Courses: removeCourseFromList(current.v2Courses, courseId),
  });

  for (const chapter of target?.blueprint.chapters ?? []) {
    try {
      window.localStorage.removeItem(getV2ChapterStorageKey(courseId, chapter.chapterId));
    } catch {
      // 单章清理失败无副作用
    }
  }
}
