import {
  appendEventToMemoryStoreV3,
  createDefaultUserMemory,
  decayUserMemory,
  isMemoryStoreV3,
  mergeProfileIntoMemory,
  migrateMemoryToV3,
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
  UserMemory,
  UserProfile,
} from '@/types/course';

const USER_MEMORY_KEY = 'userMemory';
const USER_MEMORY_V3_KEY = 'userMemoryV3';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type CreateMemoryRepositoryOptions = {
  storage?: StorageLike;
  getProfile?: () => UserProfile | null;
  initialMemory?: UserMemory | MemoryStoreV3 | null;
};

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function createMemoryRepository(options: CreateMemoryRepositoryOptions = {}) {
  const storage = getStorage(options.storage);
  const getProfile = options.getProfile || getUserProfile;
  const initialMemory = options.initialMemory;

  function getLegacyMemory(): UserMemory {
    const profile = getProfile();

    if (initialMemory && !isMemoryStoreV3(initialMemory)) {
      return decayUserMemory(mergeProfileIntoMemory(initialMemory, profile));
    }

    if (!storage) {
      return createDefaultUserMemory(profile);
    }

    try {
      const raw = storage.getItem(USER_MEMORY_KEY);
      if (!raw) {
        return createDefaultUserMemory(profile);
      }

      const parsed = JSON.parse(raw) as UserMemory;
      return decayUserMemory(mergeProfileIntoMemory(parsed, profile));
    } catch {
      return createDefaultUserMemory(profile);
    }
  }

  function saveLegacyMemory(memory: UserMemory): void {
    if (!storage) return;

    const nextMemory = {
      ...memory,
      lastUpdated: Date.now(),
      version: (memory.version || 0) + 1,
    };

    storage.setItem(USER_MEMORY_KEY, JSON.stringify(nextMemory));

    // 同步写入 V3：将 legacy memory 迁移后合并到现有 V3 存储
    try {
      const existingV3Raw = storage.getItem(USER_MEMORY_V3_KEY);
      const existingV3 = existingV3Raw
        ? JSON.parse(existingV3Raw) as MemoryStoreV3
        : null;

      if (existingV3 && isMemoryStoreV3(existingV3)) {
        // V3 已存在：更新 profile（stableFacts + goals）
        const newV3 = migrateMemoryToV3(nextMemory, getProfile());
        const updatedV3: MemoryStoreV3 = {
          ...existingV3,
          profile: newV3.profile,
          updatedAt: Math.max(existingV3.updatedAt, nextMemory.lastUpdated),
        };
        storage.setItem(USER_MEMORY_V3_KEY, JSON.stringify(updatedV3));
      }
      // V3 不存在时不主动创建，等下次读取时自动迁移
    } catch {
      // V3 写入失败不影响 V1 的正常保存
    }
  }

  function getMemoryStoreV3(): MemoryStoreV3 {
    if (initialMemory) {
      return migrateMemoryToV3(initialMemory, getProfile());
    }

    if (!storage) return migrateMemoryToV3(getLegacyMemory(), getProfile());

    try {
      const raw = storage.getItem(USER_MEMORY_V3_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MemoryStoreV3;
        if (isMemoryStoreV3(parsed)) {
          return parsed;
        }
      }
    } catch {
      // 损坏数据回退迁移
    }

    const migrated = migrateMemoryToV3(getLegacyMemory(), getProfile());
    saveMemoryStoreV3(migrated);
    return migrated;
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
    getLegacyMemory,
    saveLegacyMemory,
    getMemoryStoreV3,
    saveMemoryStoreV3,
    appendMemoryEvent,
    getPlanningPayload,
    getTeachingPayload,
    getChatPayload,
  };
}
