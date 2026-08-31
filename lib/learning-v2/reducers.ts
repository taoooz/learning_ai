// lib/learning-v2/reducers.ts
// V2 学习流归约器：SSE 事件 → NodeLessonV2
// 依据 docs/architecture/v2_课程生成逻辑.md §2.5 / §5 / §6.3
// 与 docs/architecture/p2-流内答疑第一阶段设计.md §2.1 / §2.2
// 幂等保证：所有 Item 以确定性 itemId upsert，重复应用同一事件不产生重复条目；
// 版本守卫：planVersion/chapterId 不匹配的事件直接丢弃（旧版本结果拒绝写入）；
// Tutor 守卫：问题/回答经 taskId + questionId 绑定，requestId 不匹配进行中请求的事件拒写

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
  TutorAnswerItem,
  TutorBlockCompletedPayload,
  TutorBlockDeltaPayload,
  TutorBlockStartedPayload,
  TutorCompletedPayload,
  TutorStartedPayload,
  UserQuestionItem,
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

export function userQuestionItemId(questionId: string): string {
  return `uq:${questionId}`;
}

export function tutorAnswerItemId(questionId: string): string {
  return `ta:${questionId}`;
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

/**
 * 追加用户提问（P2 流内答疑）：提交即入流，确定性 `uq:{questionId}` upsert。
 * 重复 questionId 原样返回，不产生重复条目、不漂移 sequence（设计文档 §2.1 / §8）。
 */
export function appendUserQuestion(
  lesson: NodeLessonV2,
  input: { taskId: string; questionId: string; text: string },
  now: number,
): NodeLessonV2 {
  const itemId = userQuestionItemId(input.questionId);
  if (lesson.streamItems.some((item) => item.itemId === itemId)) return lesson;
  const item: UserQuestionItem = {
    itemId,
    type: 'user_question',
    chapterId: lesson.chapterId,
    taskId: input.taskId,
    questionId: input.questionId,
    planVersion: lesson.chapterPlan.planVersion,
    sequence: lesson.runtime.latestSequence + 1,
    createdAt: now,
    status: 'pending',
    text: input.text,
  };
  return {
    ...lesson,
    streamItems: [...lesson.streamItems, item],
    runtime: {
      ...lesson.runtime,
      latestSequence: item.sequence,
      scrollAnchorItemId: itemId,
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
      // 携带 questionId 的错误属于 Tutor 请求，走答疑归约路径（不误伤主线任务）
      return event.questionId ? applyTutorSseEvent(lesson, event) : applyRequestError(lesson, event);
    case 'request_completed':
      return applyRequestCompleted(lesson, event);
    case 'tutor_started':
    case 'tutor_block_started':
    case 'tutor_block_delta':
    case 'tutor_block_completed':
    case 'tutor_completed':
      return applyTutorSseEvent(lesson, event);
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

// ---- Tutor 流内答疑（P2） ----

type TutorEvent = LearningSseEvent & { taskId: string; questionId: string };

function requireTutorEvent(event: LearningSseEvent): TutorEvent | null {
  return event.taskId && event.questionId ? (event as TutorEvent) : null;
}

function findUserQuestionItem(
  items: LearningStreamItem[],
  questionId: string,
): UserQuestionItem | undefined {
  const found = items.find((item) => item.itemId === userQuestionItemId(questionId));
  return found?.type === 'user_question' ? found : undefined;
}

function findTutorAnswerItem(
  items: LearningStreamItem[],
  questionId: string,
): TutorAnswerItem | undefined {
  const found = items.find((item) => item.itemId === tutorAnswerItemId(questionId));
  return found?.type === 'tutor_answer' ? found : undefined;
}

/** Tutor 守卫：问题必须已入流且归属事件携带的任务（设计文档 §2.2 守卫字段） */
function requireTutorQuestion(
  lesson: NodeLessonV2,
  event: LearningSseEvent,
): { tutorEvent: TutorEvent; question: UserQuestionItem } | null {
  const tutorEvent = requireTutorEvent(event);
  if (!tutorEvent) return null;
  const question = findUserQuestionItem(lesson.streamItems, tutorEvent.questionId);
  if (!question || question.taskId !== tutorEvent.taskId) return null;
  return { tutorEvent, question };
}

/** 过期请求守卫：已有进行中的 Tutor 请求且 requestId 不匹配时拒写（设计文档 §6） */
function isStaleTutorRequest(lesson: NodeLessonV2, event: LearningSseEvent): boolean {
  const pending = lesson.runtime.pendingRequest;
  return !!pending && pending.kind === 'tutor' && pending.requestId !== event.requestId;
}

/**
 * 应用 Tutor 事件（P2）：统一守卫后按事件类型归约。
 * 守卫顺序：外壳（章节/版本）→ 任务与问题绑定 → 载荷一致性 → 进行中请求 requestId。
 * 任何一环不匹配原样返回，不污染当前章节（设计文档 §2.2 / §5）。
 */
export function applyTutorSseEvent(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  if (event.chapterId !== lesson.chapterId) return lesson;
  if (event.planVersion !== lesson.chapterPlan.planVersion) return lesson;

  switch (event.type) {
    case 'tutor_started':
      return applyTutorStarted(lesson, event);
    case 'tutor_block_started':
      return applyTutorBlockStarted(lesson, event);
    case 'tutor_block_delta':
      return applyTutorBlockDelta(lesson, event);
    case 'tutor_block_completed':
      return applyTutorBlockCompleted(lesson, event);
    case 'tutor_completed':
      return applyTutorCompleted(lesson, event);
    case 'request_error':
      return applyTutorRequestError(lesson, event);
    default:
      return lesson;
  }
}

function applyTutorStarted(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const guarded = requireTutorQuestion(lesson, event);
  if (!guarded) return lesson;
  const { tutorEvent } = guarded;
  const payload = tutorEvent.payload as TutorStartedPayload;
  if (payload.questionId !== tutorEvent.questionId) return lesson;
  const { runtime } = lesson;
  const now = tutorEvent.timestamp;

  // 在途请求守卫：started 负责建立请求，不复用 isStaleTutorRequest（它只拒不同 requestId）。
  // Tutor 流式进行中时：同 requestId 重投幂等 no-op（不清空已累积块），
  // 不同 requestId 的迟到/错投 started 一律拒写——否则会劫持 pendingRequest，
  // 反令在途请求的合法 delta 被过期守卫拒写；失败重试走下方 pending.status === 'failed' 分支
  const pending = runtime.pendingRequest;
  if (pending && pending.kind === 'tutor' && pending.status === 'streaming') return lesson;

  const existing = findTutorAnswerItem(lesson.streamItems, tutorEvent.questionId);
  // 已完成回答不被过期 started 回退；失败/流式残留重试时先清空半截块（缺陷 A 同源）
  if (existing?.status === 'complete') return lesson;
  const base: TutorAnswerItem = existing
    ? { ...existing, blocks: [], errorMessage: undefined }
    : {
        itemId: tutorAnswerItemId(tutorEvent.questionId),
        type: 'tutor_answer',
        chapterId: lesson.chapterId,
        taskId: tutorEvent.taskId,
        questionId: tutorEvent.questionId,
        planVersion: tutorEvent.planVersion,
        // sequence 锚定客户端最新序号：服务端 sequence 按请求重新计数，
        // 直接用事件序号会把回答排到问题之前
        sequence: runtime.latestSequence + 1,
        createdAt: now,
        status: 'streaming',
        blocks: [],
      };

  return {
    ...lesson,
    streamItems: upsertItem(lesson.streamItems, { ...base, status: 'streaming' }),
    runtime: {
      ...runtime,
      latestSequence: Math.max(runtime.latestSequence, tutorEvent.sequence, base.sequence),
      lastActiveAt: now,
      pendingRequest: {
        requestId: tutorEvent.requestId,
        kind: 'tutor',
        status: 'streaming',
        attempt:
          runtime.pendingRequest && runtime.pendingRequest.requestId === tutorEvent.requestId
            ? runtime.pendingRequest.attempt
            : (runtime.pendingRequest?.attempt ?? 0) + 1,
        startedAt:
          runtime.pendingRequest?.requestId === tutorEvent.requestId
            ? runtime.pendingRequest.startedAt
            : now,
      },
    },
    updatedAt: now,
  };
}

function applyTutorBlockStarted(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const guarded = requireTutorQuestion(lesson, event);
  if (!guarded) return lesson;
  const { tutorEvent } = guarded;
  if (isStaleTutorRequest(lesson, tutorEvent)) return lesson;
  const payload = tutorEvent.payload as TutorBlockStartedPayload;
  const answer = findTutorAnswerItem(lesson.streamItems, tutorEvent.questionId);
  if (!answer || answer.status !== 'streaming') return lesson;

  if (answer.blocks.some((block) => block.blockId === payload.blockId)) {
    return touchSequence(lesson, tutorEvent);
  }
  const nextItem: TutorAnswerItem = {
    ...answer,
    blocks: [...answer.blocks, { type: 'markdown', blockId: payload.blockId, markdown: '' }],
  };
  return {
    ...lesson,
    streamItems: upsertItem(lesson.streamItems, nextItem),
    runtime: {
      ...lesson.runtime,
      latestSequence: Math.max(lesson.runtime.latestSequence, tutorEvent.sequence),
      lastActiveAt: tutorEvent.timestamp,
    },
    updatedAt: tutorEvent.timestamp,
  };
}

function applyTutorBlockDelta(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const guarded = requireTutorQuestion(lesson, event);
  if (!guarded) return lesson;
  const { tutorEvent } = guarded;
  if (isStaleTutorRequest(lesson, tutorEvent)) return lesson;
  const payload = tutorEvent.payload as TutorBlockDeltaPayload;
  const answer = findTutorAnswerItem(lesson.streamItems, tutorEvent.questionId);
  if (!answer || answer.status !== 'streaming') return lesson;

  const blockIndex = answer.blocks.findIndex((block) => block.blockId === payload.blockId);
  let blocks: TutorAnswerItem['blocks'];
  if (blockIndex === -1) {
    // 块已定型后不匹配 blockId 的增量丢弃；尚无块时容忍缺失的 block_started，
    // 由首个 delta 建块（与任务流 delta 兜底一致）
    if (answer.blocks.length > 0) return touchSequence(lesson, tutorEvent);
    blocks = [{ type: 'markdown', blockId: payload.blockId, markdown: payload.delta }];
  } else {
    blocks = [...answer.blocks];
    blocks[blockIndex] = {
      ...blocks[blockIndex],
      markdown: blocks[blockIndex].markdown + payload.delta,
    };
  }
  const nextItem: TutorAnswerItem = { ...answer, blocks };
  return {
    ...lesson,
    streamItems: upsertItem(lesson.streamItems, nextItem),
    runtime: {
      ...lesson.runtime,
      latestSequence: Math.max(lesson.runtime.latestSequence, tutorEvent.sequence),
      lastActiveAt: tutorEvent.timestamp,
    },
    updatedAt: tutorEvent.timestamp,
  };
}

function applyTutorBlockCompleted(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const guarded = requireTutorQuestion(lesson, event);
  if (!guarded) return lesson;
  const { tutorEvent } = guarded;
  if (isStaleTutorRequest(lesson, tutorEvent)) return lesson;
  const payload = tutorEvent.payload as TutorBlockCompletedPayload;
  const answer = findTutorAnswerItem(lesson.streamItems, tutorEvent.questionId);
  if (!answer || answer.status !== 'streaming') return lesson;

  const block = payload.block;
  const blockIndex = answer.blocks.findIndex((existing) => existing.blockId === block.blockId);
  const blocks = [...answer.blocks];
  if (blockIndex === -1) {
    blocks.push(block);
  } else {
    blocks[blockIndex] = block;
  }
  const nextItem: TutorAnswerItem = { ...answer, blocks };
  return {
    ...lesson,
    streamItems: upsertItem(lesson.streamItems, nextItem),
    runtime: {
      ...lesson.runtime,
      latestSequence: Math.max(lesson.runtime.latestSequence, tutorEvent.sequence),
      lastActiveAt: tutorEvent.timestamp,
    },
    updatedAt: tutorEvent.timestamp,
  };
}

function applyTutorCompleted(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const guarded = requireTutorQuestion(lesson, event);
  if (!guarded) return lesson;
  const { tutorEvent, question } = guarded;
  const payload = tutorEvent.payload as TutorCompletedPayload;
  if (payload.questionId !== tutorEvent.questionId) return lesson;
  if (isStaleTutorRequest(lesson, tutorEvent)) return lesson;
  const { runtime } = lesson;
  const now = tutorEvent.timestamp;

  const existing = findTutorAnswerItem(lesson.streamItems, tutorEvent.questionId);
  const answer: TutorAnswerItem = {
    itemId: tutorAnswerItemId(tutorEvent.questionId),
    type: 'tutor_answer',
    chapterId: lesson.chapterId,
    taskId: tutorEvent.taskId,
    questionId: tutorEvent.questionId,
    planVersion: tutorEvent.planVersion,
    sequence: existing?.sequence ?? runtime.latestSequence + 1,
    createdAt: existing?.createdAt ?? now,
    status: 'complete',
    blocks: payload.blocks,
    errorMessage: undefined,
  };
  const completedQuestion: UserQuestionItem = { ...question, status: 'complete' };

  return {
    ...lesson,
    streamItems: upsertItem(upsertItem(lesson.streamItems, answer), completedQuestion),
    runtime: {
      ...runtime,
      latestSequence: Math.max(runtime.latestSequence, tutorEvent.sequence, answer.sequence),
      lastActiveAt: now,
      pendingRequest:
        runtime.pendingRequest && runtime.pendingRequest.requestId === tutorEvent.requestId
          ? undefined
          : runtime.pendingRequest,
    },
    updatedAt: now,
  };
}

/** Tutor 请求错误：回答标记失败（未开始也补失败条目）、问题标记失败但不删除、追加幂等错误通知 */
function applyTutorRequestError(lesson: NodeLessonV2, event: LearningSseEvent): NodeLessonV2 {
  const guarded = requireTutorQuestion(lesson, event);
  if (!guarded) return lesson;
  const { tutorEvent, question } = guarded;
  if (isStaleTutorRequest(lesson, tutorEvent)) return lesson;
  const payload = tutorEvent.payload as RequestErrorPayload;
  const { runtime } = lesson;
  const now = tutorEvent.timestamp;

  const existing = findTutorAnswerItem(lesson.streamItems, tutorEvent.questionId);
  const answer: TutorAnswerItem = existing
    ? { ...existing, status: 'failed', errorMessage: payload.message }
    : {
        itemId: tutorAnswerItemId(tutorEvent.questionId),
        type: 'tutor_answer',
        chapterId: lesson.chapterId,
        taskId: tutorEvent.taskId,
        questionId: tutorEvent.questionId,
        planVersion: tutorEvent.planVersion,
        sequence: Math.max(runtime.latestSequence, tutorEvent.sequence) + 1,
        createdAt: now,
        status: 'failed',
        blocks: [],
        errorMessage: payload.message,
      };
  const failedQuestion: UserQuestionItem = { ...question, status: 'failed' };

  // 通知按 eventId 确定性 upsert：重复错误事件不追加重复通知、序号不漂移
  const noticeItemId = systemNoticeItemId(tutorEvent.eventId);
  const existingNotice = lesson.streamItems.find((item) => item.itemId === noticeItemId);
  const noticeSequence =
    existingNotice?.sequence ?? Math.max(runtime.latestSequence, answer.sequence) + 1;
  const notice: SystemNoticeItem = {
    itemId: noticeItemId,
    type: 'system_notice',
    chapterId: lesson.chapterId,
    planVersion: tutorEvent.planVersion,
    sequence: noticeSequence,
    createdAt: existingNotice?.createdAt ?? now,
    status: 'complete',
    tone: 'error',
    message: payload.message,
    code: payload.code,
  };

  const streamItems = upsertItem(
    upsertItem(upsertItem(lesson.streamItems, answer), failedQuestion),
    notice,
  );

  return {
    ...lesson,
    streamItems,
    runtime: {
      ...runtime,
      latestSequence: Math.max(runtime.latestSequence, tutorEvent.sequence, noticeSequence),
      lastActiveAt: now,
      pendingRequest:
        runtime.pendingRequest && runtime.pendingRequest.requestId === tutorEvent.requestId
          ? { ...runtime.pendingRequest, status: 'failed', errorCode: payload.code }
          : runtime.pendingRequest,
    },
    updatedAt: now,
  };
}
