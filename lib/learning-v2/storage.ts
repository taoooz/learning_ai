// lib/learning-v2/storage.ts
// V2 课程与章节学习流的持久化
// 依据 docs/architecture/v2_课程生成逻辑.md §6.1.1（每章独立 key、写入失败不静默丢数据）
// 课程级容器挂在 StoredData.courses；章节级 NodeLesson 用独立 localStorage key。

import type {
  ChapterTreeStatus,
  CourseBlueprint,
  CourseTreeView,
  NodeLesson,
  StoredCourse,
} from '@/types/learning-v2';
import {
  getStoredData,
  saveStoredData,
  getChapterStorageKey,
  notifyStorageWriteFailure,
} from '@/lib/storage';
import { archiveCompletedLesson } from './archive';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

// ---- 课程级：courses 容器 ----

/**
 * 由蓝图派生章节目录视图。
 * 无前置依赖的章节可用，其余锁定；已完成章节标记 completed。
 */
export function deriveCourseTreeView(
  courseId: string,
  blueprint: CourseBlueprint,
  completedChapterIds: readonly string[] = [],
): CourseTreeView {
  const completed = new Set(completedChapterIds);
  const chapters = [...blueprint.chapters]
    .sort((a, b) => a.index - b.index)
    .map((chapter): CourseTreeView['chapters'][number] => {
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
export function createStoredCourse(
  courseId: string,
  blueprint: CourseBlueprint,
  now: number = Date.now(),
): StoredCourse {
  return {
    courseId,
    blueprint,
    treeView: deriveCourseTreeView(courseId, blueprint),
    createdAt: now,
  };
}

/** 纯函数：按 courseId 查找 */
export function findStoredCourse(
  courses: readonly StoredCourse[],
  courseId: string,
): StoredCourse | null {
  return courses.find((course) => course.courseId === courseId) ?? null;
}

/** 纯函数：upsert，返回新数组 */
export function upsertStoredCourseList(
  courses: readonly StoredCourse[],
  course: StoredCourse,
): StoredCourse[] {
  const rest = courses.filter((item) => item.courseId !== course.courseId);
  return [...rest, course];
}

export function getStoredCourse(courseId: string): StoredCourse | null {
  if (typeof window === 'undefined') return null;
  return findStoredCourse(getStoredData().courses, courseId);
}

export function saveStoredCourse(course: StoredCourse): boolean {
  if (typeof window === 'undefined') return false;
  const data = getStoredData();
  const next = { ...data, courses: upsertStoredCourseList(data.courses, course) };
  return saveStoredData(next);
}

// ---- 章节级：每章独立 key ----

/**
 * 只写入、不提示（配额兜底流程内部用）。
 * @param storage 可注入存储（测试用），默认 window.localStorage
 */
export function trySaveNodeLesson(
  courseId: string,
  lesson: NodeLesson,
  storage?: StorageLike | null,
): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(getChapterStorageKey(courseId, lesson.chapterId), JSON.stringify(lesson));
    return true;
  } catch {
    return false;
  }
}

/**
 * 持久化章节学习流到独立 key；写入失败提示用户，不静默丢数据（§6.1.1）。
 */
export function saveNodeLesson(
  courseId: string,
  lesson: NodeLesson,
  storage?: StorageLike | null,
): boolean {
  if (trySaveNodeLesson(courseId, lesson, storage)) return true;
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
  /** P5.1：服务端返回的最新 revision；冲突恢复与下一次 CAS 更新需要 */
  serverUpdatedAt?: number;
}

/**
 * 带配额兜底的持久化（§6.1.1 存储治理）：
 * 写入失败 → 按蓝图章节 index 升序找「已完成 && 未归档」且非当前章节 →
 * 归档压缩并保存 → 重试原写入；循环直到成功或候选耗尽，仍失败才提示用户。
 */
export function saveNodeLessonWithQuotaFallback(
  courseId: string,
  lesson: NodeLesson,
  blueprint: CourseBlueprint,
  storage?: StorageLike | null,
  now: number = Date.now(),
): QuotaFallbackResult {
  const target = resolveStorage(storage);
  const archivedChapterIds: string[] = [];
  if (!target) return { saved: false, archivedChapterIds };
  if (trySaveNodeLesson(courseId, lesson, target)) {
    return { saved: true, archivedChapterIds };
  }

  const candidates = [...blueprint.chapters]
    .sort((a, b) => a.index - b.index)
    .map((chapter) => chapter.chapterId)
    .filter((id) => id !== lesson.chapterId);

  for (const candidateId of candidates) {
    const old = loadNodeLesson(courseId, candidateId, target);
    if (!old || old.runtime.status !== 'completed' || old.archived) continue;
    const archived = archiveCompletedLesson(old, now);
    if (!trySaveNodeLesson(courseId, archived, target)) continue; // 压缩后仍写不进，跳过该章
    archivedChapterIds.push(candidateId);
    if (trySaveNodeLesson(courseId, lesson, target)) {
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
export function loadNodeLesson(
  courseId: string,
  chapterId: string,
  storage?: StorageLike | null,
): NodeLesson | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(getChapterStorageKey(courseId, chapterId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NodeLesson;
    if (parsed.protocolVersion !== 2 || parsed.chapterId !== chapterId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 删除章节学习流（归档/清理用） */
export function deleteNodeLesson(
  courseId: string,
  chapterId: string,
  storage?: StorageLike | null,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.removeItem(getChapterStorageKey(courseId, chapterId));
  } catch {
    // 删除失败无副作用，忽略
  }
}
