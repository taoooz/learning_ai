import {
  appendEventToMemoryStoreV3,
  createEmptyMemoryStoreV3,
} from '@/lib/memory/aggregator';
import {
  getChatMemoryPayload,
  getPlanningMemoryPayload,
  getTeachingMemoryPayload,
} from '@/lib/memory/memory-agent';
import { getUserProfile, getStoredDataV2 } from '@/lib/storage';
import type {
  ChatMemoryPayload,
  CourseBlueprint,
  MemoryEvent,
  MemoryStoreV3,
  PlanningMemoryPayload,
  StoredCourseBundle,
  TeachingMemoryPayload,
  UserProfile,
} from '@/types/course';

const USER_MEMORY_V3_KEY = 'userMemoryV3';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type CreateMemoryRepositoryOptions = {
  storage?: StorageLike;
  getProfile?: () => UserProfile | null;
  initialMemory?: MemoryStoreV3 | null;
};

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

/**
 * 快速获取当前用户记忆快照（纯函数，非 hook）
 * 适用于非 React 组件场景（API 路由、Context 初始化等）
 */
export function getUserMemoryStoreSnapshot(): MemoryStoreV3 {
  return createMemoryRepository({ getProfile: getUserProfile }).getMemoryStoreV3();
}

export function createMemoryRepository(options: CreateMemoryRepositoryOptions = {}) {
  const storage = getStorage(options.storage);
  const getProfile = options.getProfile || getUserProfile;
  const initialMemory = options.initialMemory;

  /**
   * 将当前 profile 数据同步到 V3 存储（更新 stableFacts + goals，保留 events 和 projections）
   */
  function syncProfileToV3(): void {
    if (!storage) return;

    try {
      const existingV3Raw = storage.getItem(USER_MEMORY_V3_KEY);
      const existingV3 = existingV3Raw
        ? JSON.parse(existingV3Raw) as MemoryStoreV3
        : null;

      const freshV3 = createEmptyMemoryStoreV3(getProfile());

      if (existingV3 && existingV3.version === 3 && Array.isArray(existingV3.events)) {
        // V3 已存在：只更新 profile，保留 events 和 projections
        const updatedV3: MemoryStoreV3 = {
          ...existingV3,
          profile: freshV3.profile,
          updatedAt: Math.max(existingV3.updatedAt, Date.now()),
        };
        storage.setItem(USER_MEMORY_V3_KEY, JSON.stringify(updatedV3));
      } else {
        // V3 不存在：创建并写入
        storage.setItem(USER_MEMORY_V3_KEY, JSON.stringify(freshV3));
      }
    } catch {
      // V3 写入失败静默处理
    }
  }

  function getMemoryStoreV3(): MemoryStoreV3 {
    if (initialMemory) {
      return initialMemory;
    }

    if (!storage) return createEmptyMemoryStoreV3(getProfile());

    try {
      const raw = storage.getItem(USER_MEMORY_V3_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MemoryStoreV3;
        if (parsed && parsed.version === 3 && Array.isArray(parsed.events)) {
          return parsed;
        }
      }
    } catch {
      // 损坏数据回退到新创建
    }

    const fresh = createEmptyMemoryStoreV3(getProfile());
    saveMemoryStoreV3(fresh);
    return fresh;
  }

  function saveMemoryStoreV3(memoryStore: MemoryStoreV3): void {
    if (!storage) return;
    storage.setItem(USER_MEMORY_V3_KEY, JSON.stringify(memoryStore));
  }

  function appendMemoryEvent(event: MemoryEvent): MemoryStoreV3 {
    const next = appendEventToMemoryStoreV3(getMemoryStoreV3(), event);
    saveMemoryStoreV3(next);
    return next;
  }

  function getPlanningPayload(topic: string): PlanningMemoryPayload {
    return getPlanningMemoryPayload(topic, getMemoryStoreV3());
  }

  function getTeachingPayload(input: {
    topic: string;
    nodeTitle: string;
    nodeConcepts: string[];
    prerequisiteConcepts?: string[];
  }): TeachingMemoryPayload {
    const storedData = getStoredDataV2();
    const blueprints: CourseBlueprint[] = storedData.courses.map((b: StoredCourseBundle) => b.blueprint);

    return getTeachingMemoryPayload({
      ...input,
      blueprints,
      userMemory: getMemoryStoreV3(),
    });
  }

  function getChatPayload(input: {
    topic: string;
    currentNodeTitle?: string;
    currentQuestion?: string;
  }): ChatMemoryPayload {
    return getChatMemoryPayload({
      ...input,
      userMemory: getMemoryStoreV3(),
    });
  }

  return {
    syncProfileToV3,
    getMemoryStoreV3,
    saveMemoryStoreV3,
    appendMemoryEvent,
    getPlanningPayload,
    getTeachingPayload,
    getChatPayload,
  };
}
