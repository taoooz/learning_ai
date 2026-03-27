export type GenerationFlow = 'course-blueprint' | 'node-lesson';

export type GenerationStageStatus = 'success' | 'error' | 'timeout';

export interface GenerationStageMetric {
  name: string;
  status: GenerationStageStatus;
  durationMs: number;
}

export interface GenerationMeta {
  flow: GenerationFlow;
  status: 'success' | 'error';
  totalMs: number;
  refineTriggered: boolean;
  startedAt: number;
  finishedAt: number;
  stages: GenerationStageMetric[];
  extra?: Record<string, unknown>;
  error?: {
    kind: 'timeout' | 'runtime';
    stage?: string;
    message: string;
  };
}

export class GenerationTimeoutError extends Error {
  stage: string;
  timeoutMs: number;

  constructor(stage: string, timeoutMs: number) {
    super(`${stage} timed out after ${timeoutMs}ms`);
    this.name = 'GenerationTimeoutError';
    this.stage = stage;
    this.timeoutMs = timeoutMs;
  }
}

export interface GenerationTrace {
  flow: GenerationFlow;
  startedAt: number;
  refineTriggered: boolean;
  stages: GenerationStageMetric[];
  markRefineTriggered: () => void;
}

export function createGenerationTrace(flow: GenerationFlow): GenerationTrace {
  return {
    flow,
    startedAt: Date.now(),
    refineTriggered: false,
    stages: [],
    markRefineTriggered() {
      this.refineTriggered = true;
    },
  };
}

export async function withGenerationStage<T>(
  trace: GenerationTrace,
  name: string,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();

  try {
    const result = await task();
    trace.stages.push({
      name,
      status: 'success',
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    trace.stages.push({
      name,
      status: error instanceof GenerationTimeoutError ? 'timeout' : 'error',
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function withGenerationTimeout<T>(
  stage: string,
  timeoutMs: number,
  task: Promise<T>,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new GenerationTimeoutError(stage, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function finalizeGenerationSuccess(
  trace: GenerationTrace,
  options?: { extra?: Record<string, unknown> },
): GenerationMeta {
  const finishedAt = Date.now();
  return {
    flow: trace.flow,
    status: 'success',
    totalMs: finishedAt - trace.startedAt,
    refineTriggered: trace.refineTriggered,
    startedAt: trace.startedAt,
    finishedAt,
    stages: trace.stages,
    extra: options?.extra,
  };
}

export function finalizeGenerationError(trace: GenerationTrace, error: unknown): GenerationMeta {
  const finishedAt = Date.now();
  return {
    flow: trace.flow,
    status: 'error',
    totalMs: finishedAt - trace.startedAt,
    refineTriggered: trace.refineTriggered,
    startedAt: trace.startedAt,
    finishedAt,
    stages: trace.stages,
    error: error instanceof GenerationTimeoutError
      ? {
        kind: 'timeout',
        stage: error.stage,
        message: error.message,
      }
      : {
        kind: 'runtime',
        message: error instanceof Error ? error.message : 'Unknown generation error',
      },
  };
}

export function logGenerationMeta(scope: string, meta: GenerationMeta): void {
  console.log(`[${scope}] Meta`, JSON.stringify(meta));
}
