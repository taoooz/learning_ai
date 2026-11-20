// hooks/useUserMemory.ts
// Memory V4 客户端接口：服务端为权威，客户端不再读取或写入 MemoryStoreV3。

import { useCallback } from 'react';
import type { ConversationSummary } from '@/types/course';

async function parseJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export function useUserMemory() {
  const addConversationSummary = useCallback(async (courseId: string): Promise<void> => {
    try {
      await fetch('/api/user/memory/chat-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId }),
        keepalive: true,
      });
    } catch (error) {
      console.warn('[MemoryV4] 对话摘要保存失败:', error);
    }
  }, []);

  const getRecentTopics = useCallback(async (): Promise<string[]> => {
    try {
      const response = await fetch('/api/user/memory/topics', { method: 'GET', cache: 'no-store' });
      const data = await parseJson<{ ok?: boolean; topics?: Array<{ topic: string }> }>(response);
      return (data?.topics ?? []).map((item) => item.topic).filter(Boolean).slice(0, 3);
    } catch {
      return [];
    }
  }, []);

  return {
    addConversationSummary,
    getRecentTopics,
  };
}
