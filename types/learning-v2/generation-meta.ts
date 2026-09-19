// types/learning-v2/generation-meta.ts
// V2 生成元信息：所有模型生成物（蓝图/计划/任务/Recap）共用的溯源字段
// 依据 docs/architecture/v2_项目综述.md P0「建立生成阶段、耗时、错误和版本日志」

export interface GenerationMeta {
  promptVersion: string;
  modelVersion: string;
  generatedAt: number;
  /** 生成耗时（毫秒），日志观测用 */
  durationMs?: number;
  /** 是否降级产物（模型失败后的兜底内容） */
  degraded?: boolean;
  /** P5 可观测性：token 用量（来自 LLM usage 字段；流式调用暂不采集） */
  tokenUsage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
