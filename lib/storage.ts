// lib/storage.ts
import type {
  StoredData,
  StoredRecommendation,
  UserProfile,
} from '../types/course';
import type { StoredCourse } from '../types/learning-v2';

export { getSystemCourseRecommendations } from '@/lib/data/system-courses';
export type { SystemCourseRecommendation } from '@/lib/data/system-courses';

const USER_DATA_STORAGE_PREFIX = 'ai-learning-data-v2';
const AUTH_STORAGE_KEY = 'ai-learning-auth';

// 获取当前用户邀请码（从 localStorage）
export function getCurrentUserInviteCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const { inviteCode } = JSON.parse(stored);
      return inviteCode || null;
    }
  } catch {}
  return null;
}

// 获取当前用户的存储 key
function getUserStorageKey(): string {
  const inviteCode = getCurrentUserInviteCode();
  return inviteCode ? `${USER_DATA_STORAGE_PREFIX}:${inviteCode}` : USER_DATA_STORAGE_PREFIX;
}

/**
 * 章节学习流的独立存储 key（每章独立，不并入课程主对象）。
 */
export function getChapterStorageKey(courseId: string, chapterId: string): string {
  return `${getUserStorageKey()}:course:${courseId}:chapter:${chapterId}`;
}

/**
 * 课程参与信号的独立存储 key（不并入课程主对象，写失败静默）。
 */
export function getCourseEngagementKey(courseId: string): string {
  return `${getUserStorageKey()}:course:${courseId}:engagement`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 当前课程容器的最小结构守卫；旧树形课程或损坏数据不会进入渲染链路。 */
export function isStoredCourse(value: unknown): value is StoredCourse {
  if (!isRecord(value)) return false;
  const blueprint = value.blueprint;
  const treeView = value.treeView;
  if (!isRecord(blueprint) || !isRecord(treeView)) return false;
  if (blueprint.protocolVersion !== 2) return false;
  if (typeof value.courseId !== 'string' || !value.courseId.trim()) return false;
  if (typeof blueprint.topic !== 'string' || !blueprint.topic.trim()) return false;
  if (!Array.isArray(blueprint.chapters) || !Array.isArray(blueprint.courseObjectives)) return false;
  if (!isRecord(blueprint.mission)) return false;
  if (typeof treeView.topic !== 'string' || !Array.isArray(treeView.chapters)) return false;
  if (typeof treeView.totalChapters !== 'number') return false;
  if (typeof value.createdAt !== 'number') return false;

  return treeView.chapters.every((chapter) => (
    isRecord(chapter)
    && typeof chapter.chapterId === 'string'
    && typeof chapter.index === 'number'
    && typeof chapter.title === 'string'
    && (chapter.status === 'locked' || chapter.status === 'available' || chapter.status === 'completed')
  ));
}

const defaultStoredData: StoredData = {
  courses: [],
  userProfile: null,
  recommendations: [],
};

export function getStoredData(): StoredData {
  if (typeof window === 'undefined') return defaultStoredData;
  const userKey = getUserStorageKey();
  try {
    const raw = localStorage.getItem(userKey);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredData;
      return {
        courses: Array.isArray(parsed.courses) ? parsed.courses.filter(isStoredCourse) : [],
        userProfile: parsed.userProfile ?? null,
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      };
    }
    return defaultStoredData;
  } catch {
    return defaultStoredData;
  }
}

export const STORAGE_WRITE_FAILED_EVENT = 'storage-write-failed';

let lastStorageFailureNotifyAt = 0;

/**
 * 存储写失败统一通知（配额满时每次保存都会抛错，源头节流 30s 避免事件风暴）
 * UI 层通过监听 STORAGE_WRITE_FAILED_EVENT 展示全局提示
 */
export function notifyStorageWriteFailure(context: string, error: unknown): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastStorageFailureNotifyAt < 30_000) return;
  lastStorageFailureNotifyAt = now;
  console.error(`[storage] ${context} 写入失败:`, error);
  window.dispatchEvent(new CustomEvent(STORAGE_WRITE_FAILED_EVENT, { detail: { context } }));
}

export function saveStoredData(data: StoredData): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(getUserStorageKey(), JSON.stringify(data));
    return true;
  } catch (error) {
    notifyStorageWriteFailure('学习数据', error);
    return false;
  }
}

export function getUserProfile(): UserProfile | null {
  const data = getStoredData();
  return data.userProfile;
}

export function saveUserProfile(profile: UserProfile): void {
  const data = getStoredData();
  data.userProfile = profile;
  saveStoredData(data);
}

export function getRecommendations(): StoredRecommendation[] {
  const data = getStoredData();
  return data.recommendations || [];
}

export function saveRecommendations(recommendations: Omit<StoredRecommendation, 'createdAt'>[]): void {
  const data = getStoredData();
  data.recommendations = recommendations.map((r) => ({
    ...r,
    createdAt: Date.now(),
  }));
  saveStoredData(data);
}
