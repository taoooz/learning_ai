// lib/learning-v2/lesson-repository.ts
// P5.1 存储抽象层（设计文档 §2）：LessonRepository 接口 + Local 实现
// 后端无关：hook/业务层只依赖本接口，Server 实现按 p5-服务端持久化迁移设计.md §3 插入
// 切换由 NEXT_PUBLIC_LESSON_STORE 控制，默认 local（零行为变化）

import type { CourseBlueprintV2, NodeLessonV2, StoredCourseV2 } from '@/types/learning-v2';
import type { EngagementEvent } from './engagement';
import {
  getStoredCourseV2,
  loadNodeLessonV2,
  saveNodeLessonV2WithQuotaFallback,
  saveStoredCourseV2,
  type QuotaFallbackResult,
} from './storage';

export interface LessonRepository {
  loadCourse(courseId: string): Promise<StoredCourseV2 | null>;
  saveCourse(course: StoredCourseV2): Promise<boolean>;
  loadLesson(courseId: string, chapterId: string): Promise<NodeLessonV2 | null>;
  /** 返回 saved=false = 配额失败且归档后仍失败（调用方走既有用户提示路径） */
  saveLesson(courseId: string, chapterId: string, lesson: NodeLessonV2, blueprint: CourseBlueprintV2): Promise<QuotaFallbackResult>;
  appendEngagement(courseId: string, events: EngagementEvent[]): Promise<void>;
}

/** localStorage 实现：现有函数的薄 Promise 包装（保持现有行为与 SSR 安全） */
export class LocalLessonRepository implements LessonRepository {
  async loadCourse(courseId: string): Promise<StoredCourseV2 | null> {
    return getStoredCourseV2(courseId);
  }

  async saveCourse(course: StoredCourseV2): Promise<boolean> {
    return saveStoredCourseV2(course);
  }

  async loadLesson(courseId: string, chapterId: string): Promise<NodeLessonV2 | null> {
    return loadNodeLessonV2(courseId, chapterId);
  }

  async saveLesson(
    courseId: string,
    _chapterId: string,
    lesson: NodeLessonV2,
    blueprint: CourseBlueprintV2,
  ): Promise<QuotaFallbackResult> {
    return saveNodeLessonV2WithQuotaFallback(courseId, lesson, blueprint);
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
  async loadCourse(courseId: string): Promise<StoredCourseV2 | null> {
    const response = await fetch('/api/user/courses', { method: 'GET' });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body.ok) return null;
    const courses = body.courses as StoredCourseV2[];
    return courses.find((c) => c.courseId === courseId) ?? null;
  }

  async saveCourse(course: StoredCourseV2): Promise<boolean> {
    // 全量保存账户课程列表：先读后写（课程列表低频写入，可接受）
    const listResponse = await fetch('/api/user/courses', { method: 'GET' });
    const courses: StoredCourseV2[] = listResponse.ok
      ? (await listResponse.json()).courses ?? []
      : [];
    const next = [...courses.filter((c) => c.courseId !== course.courseId), course];
    const response = await fetch('/api/user/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courses: next }),
    });
    return response.ok;
  }

  async loadLesson(courseId: string, chapterId: string): Promise<NodeLessonV2 | null> {
    const response = await fetch(
      `/api/user/lessons?courseId=${encodeURIComponent(courseId)}&chapterId=${encodeURIComponent(chapterId)}`,
    );
    if (!response.ok) return null;
    const body = await response.json();
    return body.ok ? (body.lesson as NodeLessonV2 | null) : null;
  }

  async saveLesson(
    courseId: string,
    chapterId: string,
    lesson: NodeLessonV2,
  ): Promise<QuotaFallbackResult> {
    const response = await fetch('/api/user/lessons', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId,
        chapterId,
        lesson,
        expectUpdatedAt: lesson.updatedAt,
      }),
    });
    if (response.status === 409) {
      // 乐观锁冲突：设计文档 §5 第一版策略——交给调用方提示用户决策
      console.warn('[ServerLessonRepository] 409 冲突：服务端数据更新');
      return { saved: false, archivedChapterIds: [], conflict: true };
    }
    return { saved: response.ok, archivedChapterIds: [] };
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
