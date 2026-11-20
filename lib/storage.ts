// lib/storage.ts
import type {
  StoredDataV2,
  StoredRecommendation,
  UserProfile,
} from '../types/course';

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
export function getV2ChapterStorageKey(courseId: string, chapterId: string): string {
  return `${getUserStorageKey()}:course:${courseId}:chapter:${chapterId}`;
}

/**
 * 课程参与信号的独立存储 key（不并入课程主对象，写失败静默）。
 */
export function getV2CourseEngagementKey(courseId: string): string {
  return `${getUserStorageKey()}:course:${courseId}:engagement`;
}

const defaultDataV2: StoredDataV2 = {
  v2Courses: [],
  userProfile: null,
  recommendations: [],
};

export function getStoredDataV2(): StoredDataV2 {
  if (typeof window === 'undefined') return defaultDataV2;
  const userKey = getUserStorageKey();
  try {
    const raw = localStorage.getItem(userKey);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredDataV2;
      return {
        v2Courses: Array.isArray(parsed.v2Courses) ? parsed.v2Courses : [],
        userProfile: parsed.userProfile ?? null,
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      };
    }
    return defaultDataV2;
  } catch {
    return defaultDataV2;
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

export function saveStoredDataV2(data: StoredDataV2): boolean {
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
  const data = getStoredDataV2();
  return data.userProfile;
}

export function saveUserProfile(profile: UserProfile): void {
  const data = getStoredDataV2();
  data.userProfile = profile;
  saveStoredDataV2(data);
}

export function getRecommendations(): StoredRecommendation[] {
  const data = getStoredDataV2();
  return data.recommendations || [];
}

export function saveRecommendations(recommendations: Omit<StoredRecommendation, 'createdAt'>[]): void {
  const data = getStoredDataV2();
  data.recommendations = recommendations.map((r) => ({
    ...r,
    createdAt: Date.now(),
  }));
  saveStoredDataV2(data);
}
