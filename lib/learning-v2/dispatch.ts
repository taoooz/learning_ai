// lib/learning-v2/dispatch.ts
// 当前课程容器读取与读时自愈：只识别 StoredCourseV2，不再做 V1/V2 协议分发。

import type { StoredDataV2 } from '@/types/course';
import type { StoredCourseV2 } from '@/types/learning-v2';
import { getStoredDataV2 } from '@/lib/storage';
import { deriveCourseTreeViewV2 } from '@/lib/learning-v2/storage';
import { getLessonRepository, getLessonStoreMode } from '@/lib/learning-v2/lesson-repository';
import { isSameCourseTreeView, refreshCourseTreeViewV2 } from '@/lib/learning-v2/chapter-complete';

/** 按 courseId 查找当前课程容器（纯函数，便于测试）。 */
export function resolveStoredCourseFromData(
  data: StoredDataV2,
  courseId: string,
): StoredCourseV2 | null {
  return data.v2Courses.find((course) => course.courseId === courseId) ?? null;
}

/** 按 courseId 查找课程容器（SSR 无 window 时返回 null）。 */
export function resolveStoredCourse(courseId: string): StoredCourseV2 | null {
  if (typeof window === 'undefined') return null;
  return resolveStoredCourseFromData(getStoredDataV2(), courseId);
}

/**
 * 读取用于渲染的课程容器。
 * local：沿用同步 localStorage 路径；server：以服务端课程为主，并用各章真实状态自愈 treeView。
 * server miss 时回退本地缓存，保证短暂网络故障不把用户挡在课程外。
 */
export async function loadRenderableStoredCourse(
  courseId: string,
): Promise<StoredCourseV2 | null> {
  if (getLessonStoreMode() !== 'server') {
    const course = resolveStoredCourse(courseId);
    if (!course) return null;
    const refreshed = refreshCourseTreeViewV2(course);
    if (!isSameCourseTreeView(refreshed, course.treeView)) {
      const { saveStoredCourseV2 } = await import('./storage');
      saveStoredCourseV2({ ...course, treeView: refreshed });
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
  const refreshed = deriveCourseTreeViewV2(
    courseId,
    course.blueprint,
    completedChapterIds.filter((id): id is string => Boolean(id)),
  );
  const nextCourse: StoredCourseV2 = { ...course, treeView: refreshed };
  if (!isSameCourseTreeView(refreshed, course.treeView)) {
    await repository.saveCourse(nextCourse);
  }
  return nextCourse;
}

/** 创建课程：server 模式先写服务端，成功后写入本地缓存；失败不落半成品。 */
export async function createAndSaveStoredCourseV2(course: StoredCourseV2): Promise<boolean> {
  if (getLessonStoreMode() !== 'server') {
    const { saveStoredCourseV2 } = await import('./storage');
    return saveStoredCourseV2(course);
  }
  const saved = await getLessonRepository().saveCourse(course);
  if (saved) {
    const { saveStoredCourseV2 } = await import('./storage');
    const cached = saveStoredCourseV2(course);
    if (!cached) {
      console.warn('[LearningV2] 服务端课程已保存，但本地缓存写入失败');
    }
  }
  return saved;
}
