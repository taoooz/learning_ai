// lib/memory-client.ts
// 客户端只提交画像输入与场景标识；Memory 内容由服务端生成和读取。

import type { UserProfile } from '@/types/course';

export async function ingestProfileMemory(
  profile: UserProfile | null,
  options: { throwOnError?: boolean } = {},
): Promise<boolean> {
  if (!profile) return false;
  try {
    const response = await fetch('/api/user/memory/profile-ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });
    if (!response.ok && options.throwOnError) {
      const data = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(data?.message || '画像记忆保存失败');
    }
    return response.ok;
  } catch (error) {
    console.warn('[MemoryV4] 画像导入失败:', error);
    if (options.throwOnError) throw error;
    return false;
  }
}

export async function getServerProfile(): Promise<UserProfile | null> {
  try {
    const response = await fetch('/api/user/memory/profile', { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json() as { profile?: UserProfile | null };
    return data.profile && typeof data.profile === 'object' ? data.profile : null;
  } catch {
    return null;
  }
}
