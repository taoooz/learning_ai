export const PROMPT_LAB_STAGE_IDS = [
  'outline_initial',
  'outline_answer',
  'architect_chapters',
  'architect_meta',
  'architect_review',
  'chapter_plan',
  'chapter_plan_review',
  'task_search_decision',
  'task_content',
] as const;

export type PromptLabStageId = typeof PROMPT_LAB_STAGE_IDS[number];

export type PromptLabFieldType = 'text' | 'textarea' | 'json' | 'boolean' | 'number' | 'select';

export interface PromptLabFieldDefinition {
  key: string;
  label: string;
  type: PromptLabFieldType;
  hint?: string;
  rows?: number;
  options?: Array<{ label: string; value: string }>;
  advanced?: boolean;
}

export interface PromptLabStageDefinition {
  id: PromptLabStageId;
  title: string;
  group: '课程级' | '章节级';
  description: string;
  fields: PromptLabFieldDefinition[];
  nextStage?: PromptLabStageId;
}

export interface PromptLabRunConfig {
  toolsEnabled: boolean;
  maxTokens: number;
  maxSearches: number;
  maxIterations: number;
  reasoningEffort: string;
}

export interface PromptLabCompileResult {
  stage: PromptLabStageId;
  systemPrompt: string;
  userMessage: string;
  history: Array<{ role: string; content: string }>;
  config: PromptLabRunConfig;
}

export interface PromptLabValidation {
  valid: boolean;
  errors: Array<string | Record<string, unknown>>;
  warnings: Array<string | Record<string, unknown>>;
}

export interface PromptLabParsedEvent {
  type: 'parsed';
  parsed: unknown;
  validation: PromptLabValidation;
  toolResults: Array<{ tool?: string; result: string }>;
}

export interface PromptLabToolEvent {
  type: 'tool_call' | 'tool_result';
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
}

export interface PromptLabMetrics {
  elapsedMs: number;
  finishReason: string | null;
}

export type PromptLabSSEEvent =
  | { type: 'thinking'; message: string }
  | { type: 'content_delta'; content: string }
  | PromptLabToolEvent
  | PromptLabParsedEvent
  | ({ type: 'metrics' } & PromptLabMetrics)
  | { type: 'error'; message: string };

export interface PromptLabLastRun {
  thinking: string;
  content: string;
  parsed?: unknown;
  validation?: PromptLabValidation;
  toolResults: Array<{ tool?: string; result: string }>;
  metrics?: PromptLabMetrics;
  error?: string;
  startedAt?: number;
}

export type PromptLabInputValue = string | boolean | number;

export interface PromptLabStageState {
  inputs: Record<string, PromptLabInputValue>;
  systemPrompt: string;
  userMessage: string;
  promptDirty: boolean;
  config: PromptLabRunConfig;
  lastRun?: PromptLabLastRun;
}

export interface PromptLabSession {
  version: 1;
  activeStage: PromptLabStageId;
  stages: Partial<Record<PromptLabStageId, PromptLabStageState>>;
  artifacts: Record<string, unknown>;
}
