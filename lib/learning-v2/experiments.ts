// lib/learning-v2/experiments.ts
// P5.5 A/B 实验框架（最小可用）：确定性账户分组 + 实验注册表
// 设计约束：
// - 分组只依赖 accountId（同一账户永远同组，跨会话稳定）
// - 未注册的实验 key 一律返回 control（防拼写错误静默扩散）
// - 曝光通过既有 engagement 埋点上报（recordEngagementEvent），复用数据保留与观测链路

import type { EngagementEventType } from './engagement';

export interface ExperimentDefinition {
  key: string;
  description: string;
  /** 变体名 → 流量权重（整数份数），总份数为分母 */
  variants: Record<string, number>;
}

/**
 * 实验注册表：当前无在跑实验（P5.5 框架先行，实验随运营需求登记）。
 * 登记新实验：在此添加定义 + 业务代码读取 assignVariant + 埋点曝光。
 */
export const EXPERIMENTS: readonly ExperimentDefinition[] = [];

/** FNV-1a 32 位哈希：无依赖、确定性、分布均匀 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type ExperimentAssignment = {
  experimentKey: string;
  variant: string;
} | null;

/**
 * 确定性分组：accountId + experimentKey 哈希取模映射到加权变体。
 * 未注册实验 / 空账户 / 无变体 → null（control 语义由调用方定义）。
 */
export function assignVariant(experimentKey: string, accountId: string): ExperimentAssignment {
  if (!accountId) return null;
  const experiment = EXPERIMENTS.find((e) => e.key === experimentKey);
  if (!experiment) return null;
  const entries = Object.entries(experiment.variants).filter(([, weight]) => weight > 0);
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const bucket = fnv1a(`${experimentKey}:${accountId}`) % total;
  let cumulative = 0;
  for (const [variant, weight] of entries) {
    cumulative += weight;
    if (bucket < cumulative) {
      return { experimentKey, variant };
    }
  }
  return { experimentKey, variant: entries[entries.length - 1][0] };
}

/** 曝光埋点事件类型（复用 engagement 链路；experiment_exposed 已加入 EngagementEventType） */
export const EXPERIMENT_EXPOSED_EVENT: EngagementEventType = 'experiment_exposed';
