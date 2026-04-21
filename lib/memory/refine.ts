// lib/memory/refine.ts — LLM 驱动的记忆精炼
// 分析最近对话，返回结构化洞察并应用到 MemoryStore

import type { MemoryRefineResult, MemoryStoreV3 } from '@/types/course';
import { createMemoryRepository } from '@/lib/memory';
import { normalizeConceptKey } from './aggregator';

/** 调用 /api/memory/refine 获取 LLM 精炼结果 */
export async function fetchMemoryRefine(
  recentMessages: Array<{ role: string; content: string }>,
  memoryStore: MemoryStoreV3,
): Promise<MemoryRefineResult> {
  // 构建最近事件摘要（给 LLM 更多上下文）
  const recentEvents = memoryStore.events.slice(0, 5);
  const eventsSummary = recentEvents
    .map((e) => {
      switch (e.type) {
        case 'question_answered':
          return `答题：${e.payload.isCorrect ? '正确' : '错误'} - ${e.payload.conceptName || e.topic}`;
        case 'node_completed':
          return `完成节点：${e.payload.nodeTitle || e.topic}`;
        case 'course_generated':
          return `生成课程：${e.topic}`;
        default:
          return null;
      }
    })
    .filter(Boolean)
    .join('；');

  try {
    const response = await fetch('/api/memory/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recentMessages,
        currentSummary: memoryStore.learningSummary || null,
        conceptCount: memoryStore.projections.conceptProjections.length,
        topicCount: memoryStore.projections.topicProjections.length,
        recentEventsSummary: eventsSummary,
      }),
    });

    if (!response.ok) {
      console.warn('[Memory Refine] 请求失败，跳过:', response.status);
      return { summary: null, preferenceUpdates: [], conceptCorrections: [] };
    }

    return await response.json();
  } catch (error) {
    console.warn('[Memory Refine] 网络错误，跳过:', error);
    return { summary: null, preferenceUpdates: [], conceptCorrections: [] };
  }
}

/** 将精炼结果应用到 MemoryStore */
export function applyRefineResult(
  result: MemoryRefineResult,
  memoryStore: MemoryStoreV3,
): MemoryStoreV3 {
  let updated = { ...memoryStore };

  // 1. 更新 learningSummary
  if (result.summary) {
    updated = {
      ...updated,
      learningSummary: {
        ...result.summary,
        updatedAt: Date.now(),
      },
    };
  }

  // 2. 应用偏好更新
  if (result.preferenceUpdates && result.preferenceUpdates.length > 0) {
    const preferences = [...updated.profile.preferences];
    for (const update of result.preferenceUpdates) {
      const existing = preferences.find(
        (p) => p.kind === update.kind && p.value === update.value,
      );
      if (existing) {
        existing.confidence = Math.max(existing.confidence, update.confidence);
        existing.updatedAt = Date.now();
      } else {
        preferences.unshift({
          id: `preference:${update.kind}:${update.value}`,
          kind: update.kind,
          value: update.value,
          confidence: update.confidence,
          source: 'chat',
          updatedAt: Date.now(),
        });
      }
    }
    updated = {
      ...updated,
      profile: { ...updated.profile, preferences: preferences.slice(0, 12) },
    };
  }

  // 3. 应用概念修正
  if (result.conceptCorrections && result.conceptCorrections.length > 0) {
    const concepts = updated.projections.conceptProjections.map((c) => ({ ...c }));
    for (const correction of result.conceptCorrections) {
      const conceptId = normalizeConceptKey(correction.concept);
      const existing = concepts.find(
        (c) => c.topic === correction.topic && c.conceptId === conceptId,
      );
      if (existing && Math.abs(existing.masteryScore - correction.correctedMastery) > 0.15) {
        existing.masteryScore = correction.correctedMastery;
        existing.misconceptionHints = [
          ...existing.misconceptionHints.slice(0, 2),
          correction.reason.slice(0, 30),
        ].slice(0, 3);
        existing.updatedAt = Date.now();
      }
    }
    updated = {
      ...updated,
      projections: { ...updated.projections, conceptProjections: concepts },
    };
  }

  updated.updatedAt = Date.now();
  return updated;
}

/** 完整的精炼流程：调用 LLM → 应用结果 → 持久化 */
export async function refineAndApply(
  recentMessages: Array<{ role: string; content: string }>,
): Promise<void> {
  const repository = createMemoryRepository();
  const memoryStore = repository.getMemoryStoreV3();

  // 早期退出：对话太少
  const userMsgs = recentMessages.filter((m) => m.role === 'user');
  if (userMsgs.length < 3) return;

  // 早期退出：最近5分钟内已精炼过
  if (memoryStore.learningSummary) {
    const timeSinceLastRefine = Date.now() - memoryStore.learningSummary.updatedAt;
    if (timeSinceLastRefine < 5 * 60 * 1000) return;
  }

  const result = await fetchMemoryRefine(recentMessages, memoryStore);

  // 没有有意义的更新
  if (!result.summary && (!result.preferenceUpdates || result.preferenceUpdates.length === 0)) {
    return;
  }

  const updated = applyRefineResult(result, memoryStore);
  repository.saveMemoryStoreV3(updated);
}
