// types/learning-v2/runtime.ts
// V2 章节运行时状态：章节恢复与完成判断的事实来源
// 依据 docs/architecture/v2_课程生成逻辑.md §2.5 / §3

/** 章节状态机的 8 个状态（合法转换见 §3.1，由 lib/learning-v2/state-machine.ts 强制） */
export type ChapterStatus =
  | 'not_started'
  | 'planning'
  | 'learning'
  | 'awaiting_user'
  | 'checking'
  | 'remediating'
  | 'completing'
  | 'completed';

/** 当前任务状态；`partial_paused` 用于流式生成中被打断的任务（§2.6.1） */
export type CurrentTaskStatus =
  | 'idle'
  | 'generating'
  | 'streaming'
  | 'partial_paused'
  | 'awaiting_user'
  | 'checking'
  | 'completed'
  | 'failed';

export type PendingRequestKind = 'chapter_plan' | 'task' | 'tutor' | 'checkpoint' | 'recap';

export type PendingRequestStatus = 'pending' | 'streaming' | 'failed';

export interface PendingRequest {
  requestId: string;
  kind: PendingRequestKind;
  status: PendingRequestStatus;
  attempt: number;
  startedAt: number;
  errorCode?: string;
}

/**
 * 预取任务引用：必须绑定 planId + planVersion + taskId，版本不匹配即废弃（§2.3）
 * P1b 说明：预取缓存为纯内存（hook ref），不写入 runtime/持久层——刷新后退化为
 * 即时生成即可，落盘只会制造残留陈旧标记；本类型待 P4 计划补丁落地时再启用。
 */
export interface PrefetchedTaskRef {
  taskId: string;
  planId: string;
  planVersion: number;
  prefetchedAt: number;
}

export interface ChapterRuntimeState {
  status: ChapterStatus;
  currentTaskId: string | null;
  currentTaskStatus: CurrentTaskStatus;
  completedTaskIds: string[];
  skippedTaskIds: string[];
  latestSequence: number;
  scrollAnchorItemId?: string;
  pendingRequest?: PendingRequest;
  prefetchedTask?: PrefetchedTaskRef;
  chapterStartedAt?: number;
  lastActiveAt: number;
}
