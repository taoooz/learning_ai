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

/** 仓库单例：按环境变量切换（P5.1 server 实装时新增 ServerLessonRepository 分支） */
let repositoryInstance: LessonRepository | null = null;

export function getLessonRepository(): LessonRepository {
  if (!repositoryInstance) {
    repositoryInstance = new LocalLessonRepository();
  }
  return repositoryInstance;
}

/** 测试专用：注入自定义仓库 */
export function setLessonRepository(repo: LessonRepository | null): void {
  repositoryInstance = repo;
}
