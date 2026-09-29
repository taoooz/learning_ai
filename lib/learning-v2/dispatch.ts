// lib/learning-v2/dispatch.ts
// V1/V2 协议检测与课程存储分发
// 依据 docs/architecture/v2_课程生成逻辑.md §11 P0「建立 Feature Flag 和 V1/V2 渲染分发」
// §12 兼容要求：旧课程无 protocolVersion 时按 V1 处理；
// §13 禁止捷径：V1/V2 不混入同一个无版本对象，分发层返回判别联合。

import type { StoredCourseBundle, StoredDataV2 } from '@/types/course';
import type { StoredCourseV2 } from '@/types/learning-v2';
import { getStoredDataV2 } from '@/lib/storage';
import { deriveCourseTreeViewV2 } from '@/lib/learning-v2/storage';
import { getLessonRepository, getLessonStoreMode } from '@/lib/learning-v2/lesson-repository';
import { isSameCourseTreeView, refreshCourseTreeViewV2 } from '@/lib/learning-v2/chapter-complete';

export type ProtocolVersion = 1 | 2;

/**
 * 检测课程/蓝图对象的协议版本。
 * 无 protocolVersion 字段、或值不为 2 的，一律按 V1（§12）。
 */
export function detectProtocolVersion(value: unknown): ProtocolVersion {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { protocolVersion?: unknown }).protocolVersion === 2
  ) {
    return 2;
  }
  return 1;
}

/** 分发结果：判别联合，V1/V2 各走各的类型（§13） */
export type ResolvedStoredCourse =
  | { protocol: 1; course: StoredCourseBundle }
  | { protocol: 2; course: StoredCourseV2 };

/**
 * 按 courseId 查找课程存储容器（纯函数，便于测试）。
 * 优先查 v2Courses，命中返回 V2；否则回退 V1 courses；都未命中返回 null。
 */
export function resolveStoredCourseFromData(
  data: StoredDataV2,
  courseId: string,
): ResolvedStoredCourse | null {
  const v2 = (data.v2Courses ?? []).find((course) => course.courseId === courseId);
  if (v2) return { protocol: 2, course: v2 };
  const v1 = data.courses.find((course) => course.blueprint.courseId === courseId);
  if (v1) return { protocol: 1, course: v1 };
  return null;
}

/** 按 courseId 查找课程存储容器（读取全局存储，SSR 无 window 时返回 null） */
export function resolveStoredCourse(courseId: string): ResolvedStoredCourse | null {
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
): Promise<ResolvedStoredCourse | null> {
  if (getLessonStoreMode() !== 'server') {
    const resolved = resolveStoredCourse(courseId);
    if (resolved?.protocol !== 2) return resolved;
    const refreshed = refreshCourseTreeViewV2(resolved.course);
    if (!isSameCourseTreeView(refreshed, resolved.course.treeView)) {
      const { saveStoredCourseV2 } = await import('./storage');
      saveStoredCourseV2({ ...resolved.course, treeView: refreshed });
    }
    return { protocol: 2, course: { ...resolved.course, treeView: refreshed } };
  }

  const repository = getLessonRepository();
  const course = await repository.loadCourse(courseId);
  if (!course) return resolveStoredCourse(courseId);

  // 先保证服务端 treeView 与章节事实一致；章节数量小，这里以正确性优先，后续可加批量端点。
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
  return { protocol: 2, course: nextCourse };
}

/** 创建 V2 课程：server 模式先写服务端，成功后写入本地缓存；失败不降级成半 V2。 */
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
