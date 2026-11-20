// lib/learning-v2/lesson-repository.ts
// P5.1 存储抽象层（设计文档 §2）：LessonRepository 接口 + Local 实现
// 后端无关：hook/业务层只依赖本接口，Server 实现按 p5-服务端持久化迁移设计.md §3 插入
// 切换由 NEXT_PUBLIC_LESSON_STORE 控制，默认 local（零行为变化）

import type { CourseBlueprint, NodeLesson, StoredCourse } from '@/types/learning-v2';
import type { EngagementEvent } from './engagement';
import {
  getStoredData,
  saveStoredData,
} from '@/lib/storage';
import {
  getStoredCourse,
  loadNodeLesson,
  saveNodeLessonWithQuotaFallback,
  saveStoredCourse,
  type QuotaFallbackResult,
} from './storage';

export interface LessonRepository {
  loadCourse(courseId: string): Promise<StoredCourse | null>;
  saveCourse(course: StoredCourse): Promise<boolean>;
  deleteCourse(courseId: string): Promise<boolean>;
  loadLesson(courseId: string, chapterId: string): Promise<NodeLesson | null>;
  /**
   * expectedUpdatedAt 必须是「最后一次读到的服务端 revision」；server 模式用于乐观锁。
   * 返回 saved=false = 配额失败/冲突且归档后仍失败（调用方走用户可见恢复路径）。
   */
  saveLesson(
    courseId: string,
    chapterId: string,
    lesson: NodeLesson,
    blueprint: CourseBlueprint,
    expectedUpdatedAt?: number | null,
  ): Promise<QuotaFallbackResult>;
  appendEngagement(courseId: string, events: EngagementEvent[]): Promise<void>;
}

export type LessonStoreMode = 'local' | 'server';

/** 当前仓库模式；server 时课程主对象与章节容器以服务端为主。 */
export function getLessonStoreMode(): LessonStoreMode {
  return process.env.NEXT_PUBLIC_LESSON_STORE === 'server' ? 'server' : 'local';
}

/** localStorage 实现：现有函数的薄 Promise 包装（保持现有行为与 SSR 安全） */
export class LocalLessonRepository implements LessonRepository {
  async loadCourse(courseId: string): Promise<StoredCourse | null> {
    return getStoredCourse(courseId);
  }

  async saveCourse(course: StoredCourse): Promise<boolean> {
    return saveStoredCourse(course);
  }

  async deleteCourse(courseId: string): Promise<boolean> {
    const data = getStoredData();
    const courses = data.courses;
    if (!courses.some((course) => course.courseId === courseId)) return false;
    return saveStoredData({
      ...data,
      courses: courses.filter((course) => course.courseId !== courseId),
    });
  }

  async loadLesson(courseId: string, chapterId: string): Promise<NodeLesson | null> {
    return loadNodeLesson(courseId, chapterId);
  }

  async saveLesson(
    courseId: string,
    _chapterId: string,
    lesson: NodeLesson,
    blueprint: CourseBlueprint,
  ): Promise<QuotaFallbackResult> {
    return saveNodeLessonWithQuotaFallback(courseId, lesson, blueprint);
  }

  async appendEngagement(): Promise<void> {
    // 本地实现：参与信号已由 recordEngagementEvent 同步写入（engagement.ts），无需额外处理
  }
}

/**
 * 服务端实现（P5.1）：走 /api/user/* 代理（鉴权由代理层完成）
 * 设计文档 §3 API 契约；409 乐观锁冲突原样上抛给调用方决策
 */
export class ServerLessonRepository implements LessonRepository {
  private courseSaveQueue: Promise<unknown> = Promise.resolve();

  async loadCourse(courseId: string): Promise<StoredCourse | null> {
    const response = await fetch('/api/user/courses', { method: 'GET' });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body.ok) return null;
    const courses = body.courses as StoredCourse[];
    return courses.find((c) => c.courseId === courseId) ?? null;
  }

  saveCourse(course: StoredCourse): Promise<boolean> {
    // 同一客户端内串行 read-modify-write，避免课程自愈与章节完成互相覆盖。
    const operation = async (): Promise<boolean> => {
      const listResponse = await fetch('/api/user/courses', { method: 'GET' });
      const courses: StoredCourse[] = listResponse.ok
        ? (await listResponse.json()).courses ?? []
        : [];
      const next = [...courses.filter((c) => c.courseId !== course.courseId), course];
      const response = await fetch('/api/user/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courses: next }),
      });
      return response.ok;
    };
    this.courseSaveQueue = this.courseSaveQueue.then(operation, operation);
    return this.courseSaveQueue as Promise<boolean>;
  }

  async deleteCourse(courseId: string): Promise<boolean> {
    const response = await fetch(
      `/api/user/courses?courseId=${encodeURIComponent(courseId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) return false;
    const body = await response.json().catch(() => null) as { ok?: unknown; existed?: unknown } | null;
    return Boolean(body?.ok) && body?.existed === true;
  }

  async loadLesson(courseId: string, chapterId: string): Promise<NodeLesson | null> {
    const response = await fetch(
      `/api/user/lessons?courseId=${encodeURIComponent(courseId)}&chapterId=${encodeURIComponent(chapterId)}`,
    );
    if (!response.ok) return null;
    const body = await response.json();
    return body.ok ? (body.lesson as NodeLesson | null) : null;
  }

  async saveLesson(
    courseId: string,
    chapterId: string,
    lesson: NodeLesson,
    _blueprint: CourseBlueprint,
    expectedUpdatedAt?: number | null,
  ): Promise<QuotaFallbackResult> {
    const response = await fetch('/api/user/lessons', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId,
        chapterId,
        lesson,
        expectUpdatedAt: expectedUpdatedAt ?? undefined,
      }),
    });
    if (response.status === 409) {
      const body = await response.json().catch(() => null) as { serverUpdatedAt?: unknown } | null;
      const serverUpdatedAt = typeof body?.serverUpdatedAt === 'number' ? body.serverUpdatedAt : undefined;
      return { saved: false, archivedChapterIds: [], conflict: true, serverUpdatedAt };
    }
    const body = response.ok ? await response.json().catch(() => null) as { serverUpdatedAt?: unknown } | null : null;
    return {
      saved: response.ok,
      archivedChapterIds: [],
      serverUpdatedAt: typeof body?.serverUpdatedAt === 'number' ? body.serverUpdatedAt : undefined,
    };
  }

  async appendEngagement(courseId: string, events: EngagementEvent[]): Promise<void> {
    // fire-and-forget：失败静默（设计文档 §5 离线降级）
    try {
      await fetch('/api/user/engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, events }),
      });
    } catch {
      // 静默：埋点不阻断教学
    }
  }
}

/** 仓库单例：按环境变量切换（NEXT_PUBLIC_LESSON_STORE=server|local，默认 local） */
let repositoryInstance: LessonRepository | null = null;

export function getLessonRepository(): LessonRepository {
  if (!repositoryInstance) {
    const mode = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_LESSON_STORE : undefined;
    repositoryInstance = mode === 'server' ? new ServerLessonRepository() : new LocalLessonRepository();
  }
  return repositoryInstance;
}

/** 测试专用：注入自定义仓库 */
export function setLessonRepository(repo: LessonRepository | null): void {
  repositoryInstance = repo;
}

/** local 模式兼容：为服务端权威 Checkpoint 同步当前课程/章节影子快照。 */
export async function syncLearningAuthoritySnapshot(
  courseId: string,
  chapterId: string,
  lesson: NodeLesson,
): Promise<boolean> {
  const localCourse = getStoredCourse(courseId);
  if (!localCourse) return false;
  const coursesResponse = await fetch('/api/user/courses', { method: 'GET' });
  const coursesBody = coursesResponse.ok
    ? await coursesResponse.json().catch(() => null) as { courses?: StoredCourse[] } | null
    : null;
  const courses = coursesBody?.courses ?? [];
  const nextCourses = [...courses.filter((course) => course.courseId !== courseId), localCourse];
  const courseSave = await fetch('/api/user/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courses: nextCourses }),
  });
  if (!courseSave.ok) return false;
  const lessonSave = await fetch('/api/user/lessons', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, chapterId, lesson }),
  });
  return lessonSave.ok;
}
