// lib/learning-v2/storage.ts
// V2 课程与章节学习流的持久化
// 依据 docs/architecture/v2_课程生成逻辑.md §6.1.1（每章独立 key、写入失败不静默丢数据）
// 课程级容器挂在 StoredDataV2.v2Courses；章节级 NodeLessonV2 用独立 localStorage key。

import type {
  ChapterTreeStatus,
  CourseBlueprintV2,
  CourseTreeViewV2,
  NodeLessonV2,
  StoredCourseV2,
} from '@/types/learning-v2';
import {
  getStoredDataV2,
  saveStoredDataV2,
  getV2ChapterStorageKey,
  notifyStorageWriteFailure,
} from '@/lib/storage';
import { archiveCompletedLesson } from './archive';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

// ---- 课程级：v2Courses 容器 ----

/**
 * 由蓝图派生章节目录视图。
 * 无前置依赖的章节可用，其余锁定；已完成章节标记 completed。
 */
export function deriveCourseTreeViewV2(
  courseId: string,
  blueprint: CourseBlueprintV2,
  completedChapterIds: readonly string[] = [],
): CourseTreeViewV2 {
  const completed = new Set(completedChapterIds);
  const chapters = [...blueprint.chapters]
    .sort((a, b) => a.index - b.index)
    .map((chapter): CourseTreeViewV2['chapters'][number] => {
      let status: ChapterTreeStatus;
      if (completed.has(chapter.chapterId)) {
        status = 'completed';
      } else if (chapter.prerequisites.every((id) => completed.has(id))) {
        status = 'available';
      } else {
        status = 'locked';
      }
      return { chapterId: chapter.chapterId, index: chapter.index, title: chapter.title, status };
    });
  return { courseId, topic: blueprint.topic, totalChapters: chapters.length, chapters };
}

/** 创建 V2 课程空壳：蓝图落定后生成存储容器（P0 验收项「空壳可创建」） */
export function createStoredCourseV2(
  courseId: string,
  blueprint: CourseBlueprintV2,
  now: number = Date.now(),
): StoredCourseV2 {
  return {
    courseId,
    blueprint,
    treeView: deriveCourseTreeViewV2(courseId, blueprint),
    createdAt: now,
  };
}

/** 纯函数：按 courseId 查找 */
export function findStoredCourseV2(
  courses: readonly StoredCourseV2[],
  courseId: string,
): StoredCourseV2 | null {
  return courses.find((course) => course.courseId === courseId) ?? null;
}

/** 纯函数：upsert，返回新数组 */
export function upsertStoredCourseV2List(
  courses: readonly StoredCourseV2[],
  course: StoredCourseV2,
): StoredCourseV2[] {
  const rest = courses.filter((item) => item.courseId !== course.courseId);
  return [...rest, course];
}

export function getStoredCourseV2(courseId: string): StoredCourseV2 | null {
  if (typeof window === 'undefined') return null;
  return findStoredCourseV2(getStoredDataV2().v2Courses ?? [], courseId);
}

export function saveStoredCourseV2(course: StoredCourseV2): boolean {
  if (typeof window === 'undefined') return false;
  const data = getStoredDataV2();
  const next = { ...data, v2Courses: upsertStoredCourseV2List(data.v2Courses ?? [], course) };
  return saveStoredDataV2(next);
}

// ---- 章节级：每章独立 key ----

/**
 * 只写入、不提示（配额兜底流程内部用）。
 * @param storage 可注入存储（测试用），默认 window.localStorage
 */
export function trySaveNodeLessonV2(
  courseId: string,
  lesson: NodeLessonV2,
  storage?: StorageLike | null,
): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(getV2ChapterStorageKey(courseId, lesson.chapterId), JSON.stringify(lesson));
    return true;
  } catch {
    return false;
  }
}

/**
 * 持久化章节学习流到独立 key；写入失败提示用户，不静默丢数据（§6.1.1）。
 */
export function saveNodeLessonV2(
  courseId: string,
  lesson: NodeLessonV2,
  storage?: StorageLike | null,
): boolean {
  if (trySaveNodeLessonV2(courseId, lesson, storage)) return true;
  notifyStorageWriteFailure(
    `V2 章节学习流 ${lesson.chapterId}`,
    new Error('写入失败（可能是存储配额不足）'),
  );
  return false;
}

export interface QuotaFallbackResult {
  saved: boolean;
  /** 为腾出配额而被压缩归档的章节 id（按 index 升序） */
  archivedChapterIds: string[];
  /** P5.1：服务端乐观锁冲突（409），调用方提示用户决策 */
  conflict?: boolean;
}

/**
 * 带配额兜底的持久化（§6.1.1 存储治理）：
 * 写入失败 → 按蓝图章节 index 升序找「已完成 && 未归档」且非当前章节 →
 * 归档压缩并保存 → 重试原写入；循环直到成功或候选耗尽，仍失败才提示用户。
 */
export function saveNodeLessonV2WithQuotaFallback(
  courseId: string,
  lesson: NodeLessonV2,
  blueprint: CourseBlueprintV2,
  storage?: StorageLike | null,
  now: number = Date.now(),
): QuotaFallbackResult {
  const target = resolveStorage(storage);
  const archivedChapterIds: string[] = [];
  if (!target) return { saved: false, archivedChapterIds };
  if (trySaveNodeLessonV2(courseId, lesson, target)) {
    return { saved: true, archivedChapterIds };
  }

  const candidates = [...blueprint.chapters]
    .sort((a, b) => a.index - b.index)
    .map((chapter) => chapter.chapterId)
    .filter((id) => id !== lesson.chapterId);

  for (const candidateId of candidates) {
    const old = loadNodeLessonV2(courseId, candidateId, target);
    if (!old || old.runtime.status !== 'completed' || old.archived) continue;
    const archived = archiveCompletedLesson(old, now);
    if (!trySaveNodeLessonV2(courseId, archived, target)) continue; // 压缩后仍写不进，跳过该章
    archivedChapterIds.push(candidateId);
    if (trySaveNodeLessonV2(courseId, lesson, target)) {
      return { saved: true, archivedChapterIds };
    }
  }

  // 候选耗尽：压缩历史章节也腾不出空间，才提示用户
  notifyStorageWriteFailure(
    `V2 章节学习流 ${lesson.chapterId}`,
    new Error('存储配额不足，压缩历史章节后仍写入失败'),
  );
  return { saved: false, archivedChapterIds };
}

/** 恢复章节学习流；协议版本不符或数据损坏返回 null（由调用方决定重建） */
export function loadNodeLessonV2(
  courseId: string,
  chapterId: string,
  storage?: StorageLike | null,
): NodeLessonV2 | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(getV2ChapterStorageKey(courseId, chapterId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NodeLessonV2;
    if (parsed.protocolVersion !== 2 || parsed.chapterId !== chapterId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 删除章节学习流（归档/清理用） */
export function deleteNodeLessonV2(
  courseId: string,
  chapterId: string,
  storage?: StorageLike | null,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.removeItem(getV2ChapterStorageKey(courseId, chapterId));
  } catch {
    // 删除失败无副作用，忽略
  }
}
