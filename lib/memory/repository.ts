import {
  appendEventToMemoryStoreV3,
  createDefaultUserMemory,
  decayUserMemory,
  getChatMemoryPayload,
  getPlanningMemoryPayload,
  getTeachingMemoryPayload,
  isMemoryStoreV3,
  isMemoryStoreV2,
  mergeProfileIntoMemory,
  migrateMemoryToV3,
  migrateUserMemoryToV2,
} from '@/lib/memory/aggregator';
import { getUserProfile } from '@/lib/storage';
import type {
  ChatMemoryPayload,
  MemoryEvent,
  MemoryStoreV3,
  MemoryStoreV2,
  PlanningMemoryPayload,
  TeachingMemoryPayload,
  UserMemory,
  UserProfile,
} from '@/types/course';

const USER_MEMORY_KEY = 'userMemory';
const USER_MEMORY_V2_KEY = 'userMemoryV2';
const USER_MEMORY_V3_KEY = 'userMemoryV3';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type CreateMemoryRepositoryOptions = {
  storage?: StorageLike;
  getProfile?: () => UserProfile | null;
  initialMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null;
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

    if (initialMemory && !isMemoryStoreV2(initialMemory) && !isMemoryStoreV3(initialMemory)) {
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
    storage.setItem(USER_MEMORY_V2_KEY, JSON.stringify(migrateUserMemoryToV2(nextMemory, getProfile())));
  }

  function getMemoryStore(): MemoryStoreV2 {
    if (initialMemory && !isMemoryStoreV3(initialMemory)) {
      return migrateUserMemoryToV2(initialMemory, getProfile());
    }

    if (!storage) return migrateUserMemoryToV2(getLegacyMemory(), getProfile());

    try {
      const raw = storage.getItem(USER_MEMORY_V2_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MemoryStoreV2;
        if (isMemoryStoreV2(parsed)) {
          return parsed;
        }
      }
    } catch {
      // 损坏数据回退迁移
    }

    const migrated = migrateUserMemoryToV2(getLegacyMemory(), getProfile());
    saveMemoryStore(migrated);
    return migrated;
  }

  function saveMemoryStore(memoryStore: MemoryStoreV2): void {
    if (!storage) return;
    storage.setItem(USER_MEMORY_V2_KEY, JSON.stringify(memoryStore));
  }

  function getMemoryStoreV3(): MemoryStoreV3 {
    if (initialMemory) {
      return migrateMemoryToV3(initialMemory, getProfile());
    }

    if (!storage) return migrateMemoryToV3(getMemoryStore(), getProfile());

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

    const migrated = migrateMemoryToV3(getMemoryStore(), getProfile());
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
    return getTeachingMemoryPayload({
      ...input,
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
    getMemoryStore,
    saveMemoryStore,
    getMemoryStoreV3,
    saveMemoryStoreV3,
    appendMemoryEvent,
    getPlanningPayload,
    getTeachingPayload,
    getChatPayload,
  };
}
