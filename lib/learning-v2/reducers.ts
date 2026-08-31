// lib/learning-v2/reducers.ts
// V2 学习流归约器：SSE 事件 → NodeLessonV2
// 依据 docs/architecture/v2_课程生成逻辑.md §2.5 / §5 / §6.3
// 幂等保证：所有 Item 以确定性 itemId upsert，重复应用同一事件不产生重复条目；
// 版本守卫：planVersion/chapterId 不匹配的事件直接丢弃（旧版本结果拒绝写入）

import type {
  ChapterPlan,
  ChapterRecap,
  ChapterRecapItem,
  ChapterRuntimeState,
  ContentBlockCompletedPayload,
  ContentBlockDeltaPayload,
  ContentBlockStartedPayload,
  LearningSseEvent,
  LearningStreamItem,
  NodeLessonV2,
  RequestCompletedPayload,
  RequestErrorPayload,
  RequestWarningPayload,
  SourcesReadyPayload,
  SystemNoticeItem,
  TaskCompletedPayload,
  TaskContentItem,
  TaskStartedPayload,
} from '@/types/learning-v2';
import { canTransitionChapter } from './state-machine';

// ---- 初始状态 ----

export function createInitialRuntime(now: number): ChapterRuntimeState {
  return {
    status: 'not_started',
    currentTaskId: null,
    currentTaskStatus: 'idle',
    completedTaskIds: [],
    skippedTaskIds: [],
    latestSequence: 0,
    lastActiveAt: now,
  };
}

/**
 * 创建 V2 章节空壳：计划落定后的初始容器（P0 验收项「空壳可创建」）。
 * 入参已携带 ChapterPlan，说明已进入计划阶段，故初始章节状态为 planning
 * （状态机要求 planning → learning，首个 task_started 事件据此推进到 learning）。
 */
export function createInitialNodeLessonV2(
  chapterId: string,
  plan: ChapterPlan,
  now: number,
): NodeLessonV2 {
  return {
    protocolVersion: 2,
    chapterId,
    chapterPlan: plan,
    runtime: { ...createInitialRuntime(now), status: 'planning' },
    streamItems: [],
    evidence: [],
    updatedAt: now,
  };
}

// ---- 确定性 itemId（幂等 upsert 的键） ----

export function taskContentItemId(taskId: string, planVersion: number): string {
  return `tc:${taskId}:v${planVersion}`;
}

export function taskTransitionItemId(fromTaskId: string, toTaskId: string): string {
  return `tt:${fromTaskId}:${toTaskId}`;
}

export function systemNoticeItemId(eventId: string): string {
  return `sn:${eventId}`;
}

export function chapterRecapItemId(chapterId: string): string {
  return `rc:${chapterId}`;
}

// ---- 内部工具 ----

function upsertItem(items: LearningStreamItem[], item: LearningStreamItem): LearningStreamItem[] {
  const index = items.findIndex((existing) => existing.itemId === item.itemId);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

function findTaskContentItem(
  items: LearningStreamItem[],
  taskId: string,
  planVersion: number,
): TaskContentItem | undefined {
  const itemId = taskContentItemId(taskId, planVersion);
  const found = items.find((item) => item.itemId === itemId);
  return found?.type === 'task_content' ? found : undefined;
}

/** 追加系统通知（无 SSE 事件时也可用，如存储写入失败提示） */
export function appendSystemNotice(
  lesson: NodeLessonV2,
  notice: { tone: SystemNoticeItem['tone']; message: string; code?: string },
  now: number,
): NodeLessonV2 {
  const item: SystemNoticeItem = {
    itemId: systemNoticeItemId(`local-${now}-${lesson.runtime.latestSequence + 1}`),
    type: 'system_notice',
    chapterId: lesson.chapterId,
    planVersion: lesson.chapterPlan.planVersion,
    sequence: lesson.runtime.latestSequence + 1,
    createdAt: now,
    status: 'complete',
    tone: notice.tone,
    message: notice.message,
    code: notice.code,
  };
  return {
    ...lesson,
    streamItems: [...lesson.streamItems, item],
    runtime: { ...lesson.runtime, latestSequence: item.sequence, lastActiveAt: now },
    updatedAt: now,
  };
}

/**
 * 应用章节 Recap（P1b）：写 lesson.recap + 幂等 upsert recap 条目。
 * 幂等键为确定性 `rc:{chapterId}`：重复应用复用已有条目的 sequence，
 * 不产生重复条目也不造成 sequence 漂移。
 */
export function applyChapterRecap(
  lesson: NodeLessonV2,
  recap: ChapterRecap,
  now: number,
): NodeLessonV2 {
  const itemId = chapterRecapItemId(lesson.chapterId);
  const existing = lesson.streamItems.find((item) => item.itemId === itemId);
  const sequence = existing?.sequence ?? lesson.runtime.latestSequence + 1;
  const item: ChapterRecapItem = {
    itemId,
    type: 'chapter_recap',
    chapterId: lesson.chapterId,
    planVersion: lesson.chapterPlan.planVersion,
    sequence,
    createdAt: existing?.createdAt ?? now,
    status: 'complete',
    recap,
  };
  return {
    ...lesson,
    streamItems: upsertItem(lesson.streamItems, item),
    recap,
    runtime: {
      ...lesson.runtime,
      latestSequence: Math.max(lesson.runtime.latestSequence, sequence),
      lastActiveAt: now,
    },
    updatedAt: now,
  };
}

// ---- 主归约函数 ----

/**
 * 将单个 SSE 事件应用到章节学习容器上，返回新容器（纯函数）。
 * 不接受的事件（章节/版本不匹配）原样返回。
 */
export function applyLearningSseEvent(
  lesson: NodeLessonV2,
  event: LearningSseEvent,
): NodeLessonV2 {
  if (event.chapterId !== lesson.chapterId) return lesson;
  if (event.planVersion !== lesson.chapterPlan.planVersion) return lesson;

  switch (event.type) {
    case 'task_started':
      return applyTaskStarted(lesson, event);
    case 'content_block_started':
      return applyContentBlockStarted(lesson, event);
    case 'content_block_delta':
      return applyContentBlockDelta(lesson, event);
    case 'content_block_completed':
      return applyContentBlockCompleted(lesson, event);
    case 'sources_ready':
      return applySourcesReady(lesson, event);
    case 'task_completed':
      return applyTaskCompleted(lesson, event);
    case 'request_warning':
      return applyRequestWarning(lesson, event);
    case 'request_error':
      return applyRequestError(lesson, event);
    case 'request_completed':
      return applyRequestCompleted(lesson, event);
    default:
      return lesson;
  }
}

type TaskEvent = LearningSseEvent & { taskId: string };

function requireTaskId(event: LearningSseEvent): TaskEvent | null {
  return event.taskId ? (event as TaskEvent) : null;
}

function applyTaskStarted(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const taskEvent = requireTaskId(event);
  if (!taskEvent) return lesson;
  const payload = taskEvent.payload as TaskStartedPayload;
  const { runtime } = lesson;
  const now = taskEvent.timestamp;

  // 上一任务已完成且切换到新任务时，记录过渡轨迹
  let streamItems = lesson.streamItems;
  const previousTaskId = runtime.currentTaskId;
  if (
    previousTaskId &&
    previousTaskId !== payload.taskId &&
    runtime.completedTaskIds.includes(previousTaskId)
  ) {
    streamItems = upsertItem(streamItems, {
      itemId: taskTransitionItemId(previousTaskId, payload.taskId),
      type: 'task_transition',
      chapterId: lesson.chapterId,
      planVersion: lesson.chapterPlan.planVersion,
      sequence: taskEvent.sequence,
      createdAt: now,
      status: 'complete',
      fromTaskId: previousTaskId,
      toTaskId: payload.taskId,
    });
  }

  const existing = findTaskContentItem(streamItems, payload.taskId, taskEvent.planVersion);
  // 缺陷 A 修复：重试/中断恢复发新 attempt 时，半截旧块（status 非 complete）必须先清空，
  // 否则新流式 delta 会拼到旧内容上（python 端 blockId 固定为 "b1"）。
  // 以非 complete 为条件可同时覆盖失败重试与流式残留恢复；
  // P2 partial_paused 断点续传届时另走机制，不复用此重置路径。
  const base: TaskContentItem = existing
    ? existing.status !== 'complete'
      ? { ...existing, blocks: [], boundaryPrompt: undefined, sourceRefs: undefined }
      : existing
    : {
        itemId: taskContentItemId(payload.taskId, taskEvent.planVersion),
        type: 'task_content',
        chapterId: lesson.chapterId,
        taskId: payload.taskId,
        planVersion: taskEvent.planVersion,
        sequence: taskEvent.sequence,
        createdAt: now,
        status: 'streaming',
        title: payload.title,
        blocks: [],
      };
  streamItems = upsertItem(streamItems, { ...base, status: 'streaming', title: payload.title });

  const nextStatus = canTransitionChapter(runtime.status, 'learning') ? 'learning' : runtime.status;
  return {
    ...lesson,
    streamItems,
    runtime: {
      ...runtime,
      status: nextStatus,
      currentTaskId: payload.taskId,
      currentTaskStatus: 'streaming',
      latestSequence: Math.max(runtime.latestSequence, taskEvent.sequence),
      lastActiveAt: now,
      pendingRequest: {
        requestId: taskEvent.requestId,
        kind: 'task',
        status: 'streaming',
        attempt:
          runtime.pendingRequest && runtime.pendingRequest.requestId === taskEvent.requestId
            ? runtime.pendingRequest.attempt
            : (runtime.pendingRequest?.attempt ?? 0) + 1,
        startedAt: runtime.pendingRequest?.requestId === taskEvent.requestId
          ? runtime.pendingRequest.startedAt
          : now,
      },
    },
    updatedAt: now,
  };
}

function applyContentBlockStarted(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const taskEvent = requireTaskId(event);
  if (!taskEvent) return lesson;
  const payload = taskEvent.payload as ContentBlockStartedPayload;
  const item = findTaskContentItem(lesson.streamItems, taskEvent.taskId, event.planVersion);
  if (!item || item.status !== 'streaming') return lesson;

  // 只有 markdown 块支持增量；其余块类型在完成事件中一次性落定
  if (payload.blockType !== 'markdown') {
    return touchSequence(lesson, event);
  }
  if (item.blocks.some((block) => block.blockId === payload.blockId)) {
    return touchSequence(lesson, event);
  }
  const nextItem: TaskContentItem = {
    ...item,
    blocks: [...item.blocks, { type: 'markdown', blockId: payload.blockId, markdown: '' }],
  };
  return {
    ...lesson,
    streamItems: upsertItem(lesson.streamItems, nextItem),
    runtime: {
      ...lesson.runtime,
      latestSequence: Math.max(lesson.runtime.latestSequence, event.sequence),
      lastActiveAt: event.timestamp,
    },
    updatedAt: event.timestamp,
  };
}

function applyContentBlockDelta(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const taskEvent = requireTaskId(event);
  if (!taskEvent) return lesson;
  const payload = taskEvent.payload as ContentBlockDeltaPayload;
  const item = findTaskContentItem(lesson.streamItems, taskEvent.taskId, event.planVersion);
  if (!item || item.status !== 'streaming') return lesson;

  const blockIndex = item.blocks.findIndex(
    (block) => block.type === 'markdown' && block.blockId === payload.blockId,
  );
  const blocks = [...item.blocks];
  if (blockIndex === -1) {
    blocks.push({ type: 'markdown', blockId: payload.blockId, markdown: payload.delta });
  } else {
    const existing = blocks[blockIndex];
    if (existing.type !== 'markdown') return touchSequence(lesson, event);
    blocks[blockIndex] = { ...existing, markdown: existing.markdown + payload.delta };
  }
  const nextItem: TaskContentItem = { ...item, blocks };
  return {
    ...lesson,
    streamItems: upsertItem(lesson.streamItems, nextItem),
    runtime: {
      ...lesson.runtime,
      latestSequence: Math.max(lesson.runtime.latestSequence, event.sequence),
      lastActiveAt: event.timestamp,
    },
    updatedAt: event.timestamp,
  };
}

function applyContentBlockCompleted(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const taskEvent = requireTaskId(event);
  if (!taskEvent) return lesson;
  const payload = taskEvent.payload as ContentBlockCompletedPayload;
  const item = findTaskContentItem(lesson.streamItems, taskEvent.taskId, event.planVersion);
  if (!item || item.status !== 'streaming') return lesson;

  const block = payload.block;
  const blockIndex = item.blocks.findIndex((b) => b.blockId === block.blockId);
  const blocks = [...item.blocks];
  if (blockIndex === -1) {
    blocks.push(block);
  } else {
    blocks[blockIndex] = block;
  }
  const nextItem: TaskContentItem = { ...item, blocks };
  return {
    ...lesson,
    streamItems: upsertItem(lesson.streamItems, nextItem),
    runtime: {
      ...lesson.runtime,
      latestSequence: Math.max(lesson.runtime.latestSequence, event.sequence),
      lastActiveAt: event.timestamp,
    },
    updatedAt: event.timestamp,
  };
}

function applySourcesReady(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const taskEvent = requireTaskId(event);
  if (!taskEvent) return lesson;
  const payload = taskEvent.payload as SourcesReadyPayload;
  const item = findTaskContentItem(lesson.streamItems, taskEvent.taskId, event.planVersion);
  if (!item || item.status !== 'streaming') return touchSequence(lesson, event);
  const nextItem: TaskContentItem = { ...item, sourceRefs: payload.sources };
  return {
    ...lesson,
    streamItems: upsertItem(lesson.streamItems, nextItem),
    runtime: {
      ...lesson.runtime,
      latestSequence: Math.max(lesson.runtime.latestSequence, event.sequence),
      lastActiveAt: event.timestamp,
    },
    updatedAt: event.timestamp,
  };
}

function applyTaskCompleted(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const taskEvent = requireTaskId(event);
  if (!taskEvent) return lesson;
  const payload = taskEvent.payload as TaskCompletedPayload;
  const { runtime } = lesson;
  const now = taskEvent.timestamp;
  const taskId = payload.task.taskId;

  const existing = findTaskContentItem(lesson.streamItems, taskId, taskEvent.planVersion);
  const item: TaskContentItem = {
    itemId: taskContentItemId(taskId, taskEvent.planVersion),
    type: 'task_content',
    chapterId: lesson.chapterId,
    taskId,
    planVersion: taskEvent.planVersion,
    sequence: existing?.sequence ?? taskEvent.sequence,
    createdAt: existing?.createdAt ?? now,
    status: 'complete',
    title: payload.task.title,
    blocks: payload.task.blocks,
    boundaryPrompt: payload.task.boundaryPrompt,
    sourceRefs: payload.task.sourceRefs,
  };

  const completedTaskIds = runtime.completedTaskIds.includes(taskId)
    ? runtime.completedTaskIds
    : [...runtime.completedTaskIds, taskId];
  const nextStatus = canTransitionChapter(runtime.status, 'awaiting_user')
    ? 'awaiting_user'
    : runtime.status;

  return {
    ...lesson,
    streamItems: upsertItem(lesson.streamItems, item),
    runtime: {
      ...runtime,
      status: nextStatus,
      currentTaskId: taskId,
      currentTaskStatus: 'awaiting_user',
      completedTaskIds,
      latestSequence: Math.max(runtime.latestSequence, taskEvent.sequence),
      lastActiveAt: now,
      pendingRequest:
        runtime.pendingRequest && runtime.pendingRequest.requestId === taskEvent.requestId
          ? undefined
          : runtime.pendingRequest,
    },
    updatedAt: now,
  };
}

function applyRequestWarning(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const payload = event.payload as RequestWarningPayload;
  return appendSystemNotice(
    {
      ...lesson,
      runtime: {
        ...lesson.runtime,
        latestSequence: Math.max(lesson.runtime.latestSequence, event.sequence),
      },
    },
    { tone: 'warning', message: payload.message, code: payload.code },
    event.timestamp,
  );
}

function applyRequestError(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const payload = event.payload as RequestErrorPayload;
  const { runtime } = lesson;

  // 失败时保留已完成块，当前任务标记失败（§7：当前任务中断保留已完成块）
  let streamItems = lesson.streamItems;
  if (event.taskId) {
    const item = findTaskContentItem(streamItems, event.taskId, event.planVersion);
    if (item && item.status === 'streaming') {
      streamItems = upsertItem(streamItems, { ...item, status: 'failed' });
    }
  }

  const withNotice = appendSystemNotice(
    {
      ...lesson,
      streamItems,
      runtime: { ...runtime, latestSequence: Math.max(runtime.latestSequence, event.sequence) },
    },
    { tone: 'error', message: payload.message, code: payload.code },
    event.timestamp,
  );

  const taskFailed =
    event.taskId != null && withNotice.runtime.currentTaskId === event.taskId;
  return {
    ...withNotice,
    runtime: {
      ...withNotice.runtime,
      currentTaskStatus: taskFailed ? 'failed' : withNotice.runtime.currentTaskStatus,
      lastActiveAt: event.timestamp,
      pendingRequest:
        runtime.pendingRequest && runtime.pendingRequest.requestId === event.requestId
          ? { ...runtime.pendingRequest, status: 'failed', errorCode: payload.code }
          : runtime.pendingRequest,
    },
    updatedAt: event.timestamp,
  };
}

function applyRequestCompleted(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const payload = event.payload as RequestCompletedPayload;
  const { runtime } = lesson;
  // request_completed 只表示传输完成，不等于已持久化：仅清理对应请求记录
  return {
    ...lesson,
    runtime: {
      ...runtime,
      latestSequence: Math.max(runtime.latestSequence, event.sequence),
      lastActiveAt: event.timestamp,
      pendingRequest:
        runtime.pendingRequest && runtime.pendingRequest.requestId === payload.requestId
          ? undefined
          : runtime.pendingRequest,
    },
    updatedAt: event.timestamp,
  };
}

/** 只推进 sequence/活跃时间，不改变内容 */
function touchSequence(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  return {
    ...lesson,
    runtime: {
      ...lesson.runtime,
      latestSequence: Math.max(lesson.runtime.latestSequence, event.sequence),
      lastActiveAt: event.timestamp,
    },
    updatedAt: event.timestamp,
  };
}
