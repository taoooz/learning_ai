// lib/learning-v2/task-prefetch-runtime.ts
// 任务预取的请求执行器。纯策略：不持有 React ref，不 dispatch，不触碰主流程代际。

import type { NodeLesson } from '@/types/learning-v2';
import { parseLearningSseStream } from '@/lib/learning-v2/sse-client';
import type { PrefetchCacheEntry } from './prefetch';

export interface PrefetchSlot extends PrefetchCacheEntry {
  controller: AbortController;
}

export function prefetchCacheKey(planId: string, planVersion: number, taskId: string): string {
  return `${planId}:v${planVersion}:${taskId}`;
}

export interface RunTaskPrefetchParams {
  lesson: NodeLesson;
  taskId: string;
  cache: Map<string, PrefetchSlot>;
  attempts: Map<string, number>;
  buildTaskStreamBody: (lesson: NodeLesson, taskId: string, attempt: number) => Record<string, unknown>;
  getLatestLesson: () => NodeLesson | null;
}

export async function runTaskPrefetch({
  lesson,
  taskId,
  cache,
  attempts,
  buildTaskStreamBody,
  getLatestLesson,
}: RunTaskPrefetchParams): Promise<void> {
  const { planId, planVersion } = lesson.chapterPlan;
  const key = prefetchCacheKey(planId, planVersion, taskId);
  if (cache.has(key)) return;

  const attempt = (attempts.get(taskId) ?? 0) + 1;
  attempts.set(taskId, attempt);

  const controller = new AbortController();
  cache.set(key, {
    taskId,
    planId,
    planVersion,
    events: [],
    complete: false,
    controller,
  });

  let sawTaskCompleted = false;
  try {
    const response = await fetch('/api/learning/v2/tasks/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTaskStreamBody(lesson, taskId, attempt)),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`prefetch failed: ${response.status}`);
    for await (const event of parseLearningSseStream(response)) {
      const slot = cache.get(key);
      if (!slot) return; // 已被继续/卸载消费或丢弃
      slot.events.push(event);
      if (event.type === 'task_completed') sawTaskCompleted = true;
    }
  } catch {
    cache.delete(key);
    return;
  }

  const slot = cache.get(key);
  if (!slot) return;

  const latest = getLatestLesson();
  const stillAtBoundary =
    latest != null &&
    latest.runtime.status === 'awaiting_user' &&
    latest.runtime.currentTaskId === lesson.runtime.currentTaskId &&
    latest.chapterPlan.planVersion === planVersion;

  if (sawTaskCompleted && stillAtBoundary) {
    slot.complete = true;
  } else {
    cache.delete(key);
  }
}
