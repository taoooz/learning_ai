// lib/learning-v2/dispatch.ts
// 当前课程容器读取与读时自愈：只识别 StoredCourse，不再做 V1/V2 协议分发。

import type { StoredData } from '@/types/course';
import type { StoredCourse } from '@/types/learning-v2';
import { getStoredData } from '@/lib/storage';
import { deriveCourseTreeView } from '@/lib/learning-v2/storage';
import { getLessonRepository, getLessonStoreMode } from '@/lib/learning-v2/lesson-repository';
import { isSameCourseTreeView, refreshCourseTreeView } from '@/lib/learning-v2/chapter-complete';

/** 按 courseId 查找当前课程容器（纯函数，便于测试）。 */
export function resolveStoredCourseFromData(
  data: StoredData,
  courseId: string,
): StoredCourse | null {
  return data.courses.find((course) => course.courseId === courseId) ?? null;
}

/** 按 courseId 查找课程容器（SSR 无 window 时返回 null）。 */
export function resolveStoredCourse(courseId: string): StoredCourse | null {
  if (typeof window === 'undefined') return null;
  return resolveStoredCourseFromData(getStoredData(), courseId);
}

/**
 * 读取用于渲染的课程容器。
 * local：沿用同步 localStorage 路径；server：以服务端课程为主，并用各章真实状态自愈 treeView。
 * server miss 时回退本地缓存，保证短暂网络故障不把用户挡在课程外。
 */
export async function loadRenderableStoredCourse(
  courseId: string,
): Promise<StoredCourse | null> {
  if (getLessonStoreMode() !== 'server') {
    const course = resolveStoredCourse(courseId);
    if (!course) return null;
    const refreshed = refreshCourseTreeView(course);
    if (!isSameCourseTreeView(refreshed, course.treeView)) {
      const { saveStoredCourse } = await import('./storage');
      saveStoredCourse({ ...course, treeView: refreshed });
    }
    return { ...course, treeView: refreshed };
  }

  const repository = getLessonRepository();
  const course = await repository.loadCourse(courseId);
  if (!course) return resolveStoredCourse(courseId);

  // 章节数量小，以正确性优先；必要时再增加批量端点。
  const completedChapterIds = await Promise.all(
    course.blueprint.chapters.map(async (chapter) => {
      const lesson = await repository.loadLesson(courseId, chapter.chapterId);
      return lesson?.runtime.status === 'completed' ? chapter.chapterId : null;
    }),
  );
  const refreshed = deriveCourseTreeView(
    courseId,
    course.blueprint,
    completedChapterIds.filter((id): id is string => Boolean(id)),
  );
  const nextCourse: StoredCourse = { ...course, treeView: refreshed };
  if (!isSameCourseTreeView(refreshed, course.treeView)) {
    await repository.saveCourse(nextCourse);
  }
  return nextCourse;
}

/** 创建课程：server 模式先写服务端，成功后写入本地缓存；失败不落半成品。 */
export async function createAndSaveStoredCourse(course: StoredCourse): Promise<boolean> {
  if (getLessonStoreMode() !== 'server') {
    const { saveStoredCourse } = await import('./storage');
    return saveStoredCourse(course);
  }
  const saved = await getLessonRepository().saveCourse(course);
  if (saved) {
    const { saveStoredCourse } = await import('./storage');
    const cached = saveStoredCourse(course);
    if (!cached) {
      console.warn('[Learning] 服务端课程已保存，但本地缓存写入失败');
    }
  }
  return saved;
}
