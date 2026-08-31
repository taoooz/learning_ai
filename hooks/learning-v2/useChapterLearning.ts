'use client';

// hooks/learning-v2/useChapterLearning.ts
// V2 章节学习核心循环：计划生成 → 逐任务流式 → 边界停顿 → 继续 → 完成章节
// P1b 扩展：单任务预取（纯内存缓存，绑定 planId+planVersion+taskId，§6.1）；
// 章节完成流异步化（Recap 请求 → 本地兜底 → 归档压缩 → 解锁下一章，§6.1.1/§7）
// P2 扩展：流内答疑双流编排（设计文档 §3/§4/§5）——提问提交/排队/自动派发/重试/刷新恢复
// 状态事实来源是 NodeLessonV2.runtime（reducer 纯函数推进），hook 只负责
// 请求编排、节流落盘与竞态守卫（代际计数 + AbortController + 幂等注册表）
// 双流隔离（§3.1）：主任务流持有 generationRef/abortRef；Tutor 由
// TutorStreamOrchestrator 持有独立代际与 abort。Tutor 请求不取消主任务流，
// 主任务流也不取消 Tutor；章节卸载/切换时两者一并作废。

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type {
  ChapterPlan,
  ChapterRecap,
  CourseBlueprintV2,
  LearningSseEvent,
  NodeLessonV2,
  TutorAnswerItem,
} from '@/types/learning-v2';
import {
  appendSystemNotice,
  applyChapterRecap,
  applyLearningSseEvent,
  createInitialNodeLessonV2,
} from '@/lib/learning-v2/reducers';
import { transitionChapter, transitionTask } from '@/lib/learning-v2/state-machine';
import { loadNodeLessonV2, saveNodeLessonV2WithQuotaFallback } from '@/lib/learning-v2/storage';
import { validateChapterPlan } from '@/lib/learning-v2/validators';
import {
  buildChapterCompleteIdempotencyKey,
  buildChapterPlanIdempotencyKey,
  buildTaskAttemptIdempotencyKey,
  IdempotencyRegistry,
} from '@/lib/learning-v2/idempotency';
import { parseLearningSseStream } from '@/lib/learning-v2/sse-client';
import { decideResumeAction } from '@/lib/learning-v2/resume';
import { completeChapterV2 } from '@/lib/learning-v2/chapter-complete';
import { recordEngagementEvent } from '@/lib/learning-v2/engagement';
import {
  canStartPrefetch,
  resolvePrefetchConsumption,
  type PrefetchCacheEntry,
} from '@/lib/learning-v2/prefetch';
import { archiveCompletedLesson } from '@/lib/learning-v2/archive';
import { buildLocalFallbackRecap } from '@/lib/learning-v2/recap';
import { countUnansweredTutorQuestions, TUTOR_AUTO_WINDOW_LIMIT } from '@/lib/learning-v2/tutor-queue';
import {
  deriveChapterPhase,
  prepareTutorBoot,
  TutorStreamOrchestrator,
  type ChapterPhaseName,
} from '@/lib/learning-v2/tutor-orchestration';

/** 章节相位（与编排层 ChapterPhaseName 同源） */
export type ChapterPhase = ChapterPhaseName;

interface HookState {
  lesson: NodeLessonV2 | null;
  phase: ChapterPhase;
  planError: string | null;
}

type HookAction =
  | { type: 'PLANNING' }
  | { type: 'PLAN_READY'; lesson: NodeLessonV2 }
  | { type: 'PLAN_FAILED'; message: string }
  | { type: 'TASK_STARTING'; taskId: string; now: number }
  | { type: 'SSE_EVENT'; event: LearningSseEvent }
  | { type: 'STREAM_FAILED_LOCAL'; message: string; code?: string; now: number }
  | { type: 'CHAPTER_COMPLETING'; lesson: NodeLessonV2 }
  | { type: 'COMPLETED'; lesson: NodeLessonV2 }
  // Tutor 编排层预归约容器写回（LESSON_PATCH 只用于 Tutor 流，任务流仍走事件归约）
  | { type: 'LESSON_PATCH'; lesson: NodeLessonV2 };

/** TASK_STARTING 的容器级归约（reducer 与同步镜像共用，保证两侧完全一致） */
function lessonAfterTaskStarting(lesson: NodeLessonV2, taskId: string, now: number): NodeLessonV2 {
  const transitioned = transitionTask(lesson.runtime, 'generating', now);
  const runtime = transitioned.ok
    ? transitioned.runtime
    : { ...lesson.runtime, currentTaskStatus: 'generating' as const, lastActiveAt: now };
  return { ...lesson, runtime: { ...runtime, currentTaskId: taskId }, updatedAt: now };
}

/** STREAM_FAILED_LOCAL 的容器级归约：传输层失败本地合成（任务流既有模式） */
function lessonAfterStreamFailure(
  lesson: NodeLessonV2,
  message: string,
  code: string | undefined,
  now: number,
): NodeLessonV2 {
  const transitioned = transitionTask(lesson.runtime, 'failed', now);
  const runtime = transitioned.ok
    ? transitioned.runtime
    : { ...lesson.runtime, currentTaskStatus: 'failed' as const, lastActiveAt: now };
  return appendSystemNotice({ ...lesson, runtime }, { tone: 'error', message, code }, now);
}

function reducer(state: HookState, action: HookAction): HookState {
  switch (action.type) {
    case 'PLANNING':
      return { ...state, phase: 'planning', planError: null };
    case 'PLAN_READY':
      return { lesson: action.lesson, phase: 'generating', planError: null };
    case 'PLAN_FAILED':
      return { ...state, phase: 'plan_failed', planError: action.message };
    case 'TASK_STARTING': {
      if (!state.lesson) return state;
      return {
        ...state,
        phase: 'generating',
        lesson: lessonAfterTaskStarting(state.lesson, action.taskId, action.now),
      };
    }
    case 'SSE_EVENT': {
      if (!state.lesson) return state;
      const lesson = applyLearningSseEvent(state.lesson, action.event);
      return { ...state, lesson, phase: deriveChapterPhase(lesson, state.phase) };
    }
    case 'STREAM_FAILED_LOCAL': {
      if (!state.lesson) return state;
      const lesson = lessonAfterStreamFailure(state.lesson, action.message, action.code, action.now);
      return { ...state, lesson, phase: 'boundary' };
    }
    case 'CHAPTER_COMPLETING':
      // completing 属终态名单，落盘 effect 会立即写入（含 pendingRequest，供刷新恢复分支②-bis）
      return { ...state, lesson: action.lesson, phase: 'completing' };
    case 'COMPLETED':
      return { lesson: action.lesson, phase: 'completed', planError: null };
    case 'LESSON_PATCH':
      return { ...state, lesson: action.lesson, phase: deriveChapterPhase(action.lesson, state.phase) };
    default:
      return state;
  }
}

/**
 * 容器同步镜像归约：与 reducer 的容器归约路径完全一致。
 * React 的 dispatch 是异步批处理的，回调里在 dispatch 之后立刻读 state 会拿
 * 到旧值（快速连续提问丢更新、任务完成后队列派发读到旧容器）。镜像由 commit
 * 同步更新，供编排决策与请求构造读取；渲染仍以 React state 为准。
 */
function mirrorLesson(current: NodeLessonV2 | null, action: HookAction): NodeLessonV2 | null {
  switch (action.type) {
    case 'PLAN_READY':
    case 'CHAPTER_COMPLETING':
    case 'COMPLETED':
    case 'LESSON_PATCH':
      return action.lesson;
    case 'TASK_STARTING':
      return current ? lessonAfterTaskStarting(current, action.taskId, action.now) : current;
    case 'SSE_EVENT':
      return current ? applyLearningSseEvent(current, action.event) : current;
    case 'STREAM_FAILED_LOCAL':
      return current ? lessonAfterStreamFailure(current, action.message, action.code, action.now) : current;
    default:
      return current;
  }
}

/** 相位同步镜像：与 reducer 各分支的相位推导一致 */
function mirrorPhase(
  action: HookAction,
  lesson: NodeLessonV2 | null,
  prev: ChapterPhase,
): ChapterPhase {
  switch (action.type) {
    case 'PLANNING':
      return 'planning';
    case 'PLAN_READY':
      return 'generating';
    case 'PLAN_FAILED':
      return 'plan_failed';
    case 'TASK_STARTING':
      return 'generating';
    case 'STREAM_FAILED_LOCAL':
      return 'boundary';
    case 'CHAPTER_COMPLETING':
      return 'completing';
    case 'COMPLETED':
      return 'completed';
    case 'SSE_EVENT':
    case 'LESSON_PATCH':
      return lesson ? deriveChapterPhase(lesson, prev) : prev;
    default:
      return prev;
  }
}

interface UseChapterLearningArgs {
  courseId: string;
  chapterId: string;
  blueprint: CourseBlueprintV2;
}

/** Tutor UI 最小状态（P2 设计文档 §4）：忙闲、排队数、失败信息 */
export interface TutorUiState {
  /** Tutor 请求在途或回答流式中 */
  busy: boolean;
  /** 未回答问题数（含流式中；不含已完成/已失败） */
  pendingCount: number;
  /** 自动处理窗口上限；超过则 UI 显示排队提示（§3.3） */
  autoWindowLimit: number;
  /** 回答失败的问题 id（UI 据此渲染「重试回答」） */
  failedQuestionIds: string[];
}

export interface UseChapterLearningResult {
  lesson: NodeLessonV2 | null;
  phase: ChapterPhase;
  planError: string | null;
  /** 边界按钮统一入口：下一任务 / 失败重试 / 末任务完成章节 */
  continueNext: () => void;
  /** 计划失败后重试 */
  retryPlan: () => void;
  /** 恢复分支④的滚动锚点：挂载时即停在边界页，滚到该任务位置；否则为 null */
  resumeAnchorTaskId: string | null;
  /** 当前任务已发起的请求次数（边界卡「多次失败」软提示用；读 attemptsRef，勿用 pendingRequest.attempt） */
  currentTaskAttempts: number;
  /** P2：提交流内答疑问题；trim 后非空才处理；流中入队、边界立即回答 */
  submitTutorQuestion: (text: string) => void;
  /** P2：重试失败问题的回答；只重发该问题，不触碰主线 */
  retryTutor: (questionId: string) => void;
  /** P2：Tutor UI 最小状态（忙闲/排队数/失败信息） */
  tutorState: TutorUiState;
  /** P2：Tutor 是否忙碌（请求在途或回答流式中） */
  isTutorBusy: boolean;
}

/** 落盘节流窗口：流式期间约 300ms 写一次，终态立即写 */
const SAVE_THROTTLE_MS = 300;

/** 预取缓存条目：纯内存（不落盘），每条持独立 AbortController，绝不触碰主流程 generationRef */
interface PrefetchSlot extends PrefetchCacheEntry {
  controller: AbortController;
}

function prefetchCacheKey(planId: string, planVersion: number, taskId: string): string {
  return `${planId}:v${planVersion}:${taskId}`;
}

/** P2 问题 id：时间戳 + 随机后缀；不含 ':'（Python 幂等键正则要求 [^:]+） */
function createTutorQuestionId(now: number): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `q-${now.toString(36)}-${random}`;
}

export function useChapterLearning({
  courseId,
  chapterId,
  blueprint,
}: UseChapterLearningArgs): UseChapterLearningResult {
  const generationRef = useRef(0); // 代际计数：每次新请求 +1，旧流程的回调一律失效
  const abortRef = useRef<AbortController | null>(null);
  const attemptsRef = useRef(new Map<string, number>()); // taskId → 最近一次请求的 attempt
  const planRegistryRef = useRef(new IdempotencyRegistry<ChapterPlan>());
  const recapRegistryRef = useRef(new IdempotencyRegistry<ChapterRecap>());
  const prefetchCacheRef = useRef(new Map<string, PrefetchSlot>());
  const saveTimerRef = useRef<number | null>(null);

  const bootActionRef = useRef<ReturnType<typeof decideResumeAction> | null>(null);
  // P2 刷新恢复：初始化归一结果（是否需要落盘 / 是否自动重试一次）
  const tutorResumeRef = useRef<{ persisted: boolean; shouldAutoRetry: boolean } | null>(null);

  const [state, dispatch] = useReducer(reducer, undefined, (): HookState => {
    const lesson = loadNodeLessonV2(courseId, chapterId);
    // Tutor 刷新归一（§5）：只处理 Tutor，不触碰主任务状态；归一后再决策主线恢复
    const prepared = prepareTutorBoot(lesson, Date.now());
    tutorResumeRef.current = {
      persisted: prepared.persisted,
      shouldAutoRetry: prepared.shouldAutoRetry,
    };
    const bootLesson = prepared.lesson;
    const action = decideResumeAction(bootLesson);
    bootActionRef.current = action;
    switch (action.kind) {
      case 'generate_plan':
        return { lesson: null, phase: 'planning', planError: null };
      case 'render_completed':
        return { lesson: bootLesson, phase: 'completed', planError: null };
      case 'render_boundary':
        return { lesson: bootLesson, phase: 'boundary', planError: null };
      case 'start_task':
        return { lesson: bootLesson, phase: 'generating', planError: null };
    }
  });

  // 同步镜像：初始值 = 启动容器/相位；之后只由 commit 同步更新，不被 React 渲染覆盖
  const lessonMirrorRef = useRef<NodeLessonV2 | null>(state.lesson);
  const phaseMirrorRef = useRef<ChapterPhase>(state.phase);

  // 落盘走配额兜底：写失败时先压缩历史已完成章节再重试（§6.1.1）
  const persist = useCallback(
    (lesson: NodeLessonV2 | null) => {
      if (lesson) saveNodeLessonV2WithQuotaFallback(courseId, lesson, blueprint);
    },
    [courseId, blueprint],
  );

  // 统一提交入口：同步更新镜像 + dispatch 到 React state（所有状态变更必须走这里）
  const commit = useCallback((action: HookAction) => {
    lessonMirrorRef.current = mirrorLesson(lessonMirrorRef.current, action);
    phaseMirrorRef.current = mirrorPhase(action, lessonMirrorRef.current, phaseMirrorRef.current);
    dispatch(action);
  }, []);

  // ---- P2 Tutor 编排器：独立代际/abort/忙闲，与主任务流完全隔离（§3.1） ----
  const orchestratorRef = useRef<TutorStreamOrchestrator | null>(null);
  if (!orchestratorRef.current) {
    const chapter = blueprint.chapters.find((c) => c.chapterId === chapterId);
    orchestratorRef.current = new TutorStreamOrchestrator({
      courseId,
      chapterId,
      courseTopic: blueprint.topic,
      chapterTitle: chapter?.title ?? '',
      chapterTeachingGoal: chapter?.teachingGoal ?? '',
      getLesson: () => lessonMirrorRef.current,
      getPhase: () => phaseMirrorRef.current,
      commitLesson: (next, opts) => {
        if (next === lessonMirrorRef.current) return;
        commit({ type: 'LESSON_PATCH', lesson: next });
        if (opts?.persistNow) persist(next);
      },
      fetchTutorStream: (body, signal) =>
        fetch('/api/learning/v2/tutor/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        }),
      recordEngagement: (eventType, taskId) =>
        recordEngagementEvent(courseId, { eventType, chapterId, taskId }),
    });
  }

  // ---- 落盘：非终态节流，终态立即写 ----
  useEffect(() => {
    const lesson = state.lesson;
    if (!lesson) return;
    const pending = lesson.runtime.pendingRequest;
    const tutorStreaming = pending?.kind === 'tutor' && pending.status === 'streaming';
    // Tutor 流式回答期间沿用 300ms 节流（边界相位不触发立即写）；终态立即写
    const terminal =
      (lesson.runtime.status === 'awaiting_user' ||
        lesson.runtime.status === 'completing' ||
        lesson.runtime.status === 'completed' ||
        lesson.runtime.currentTaskStatus === 'failed') &&
      !tutorStreaming;
    if (terminal) {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      persist(lesson);
      return;
    }
    if (saveTimerRef.current == null) {
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        persist(lessonMirrorRef.current);
      }, SAVE_THROTTLE_MS);
    }
  }, [state.lesson, persist]);

  // ---- 任务流请求体构造（即时生成与预取共用） ----
  const buildTaskStreamBody = useCallback(
    (lesson: NodeLessonV2, taskId: string, attempt: number) => {
      const planned = lesson.chapterPlan.tasks.find((t) => t.taskId === taskId);
      const chapter = blueprint.chapters.find((c) => c.chapterId === chapterId);
      const sortedTasks = [...lesson.chapterPlan.tasks].sort((a, b) => a.order - b.order);
      const currentIndex = sortedTasks.findIndex((t) => t.taskId === taskId);
      const nextTask = currentIndex >= 0 ? sortedTasks[currentIndex + 1] : undefined;
      // previousTasks：已完成任务按 order 提供标题与要点，防内容重复
      const previousTasks = sortedTasks
        .slice(0, Math.max(currentIndex, 0))
        .filter((t) => lesson.runtime.completedTaskIds.includes(t.taskId))
        .map((t) => {
          const item = lesson.streamItems.find(
            (s) => s.type === 'task_content' && s.taskId === t.taskId,
          );
          return {
            title: t.title,
            takeaway: item && item.type === 'task_content' ? item.boundaryPrompt?.takeaway : undefined,
          };
        });

      return {
        courseId,
        chapterId,
        planId: lesson.chapterPlan.planId,
        planVersion: lesson.chapterPlan.planVersion,
        taskId,
        attempt,
        idempotencyKey: buildTaskAttemptIdempotencyKey(
          courseId,
          chapterId,
          lesson.chapterPlan.planId,
          lesson.chapterPlan.planVersion,
          taskId,
          attempt,
        ),
        task: {
          taskId: planned?.taskId ?? taskId,
          title: planned?.title ?? '',
          taskGoal: planned?.taskGoal ?? '',
          teachingPattern: planned?.teachingPattern ?? '',
          observableOutcome: planned?.observableOutcome ?? '',
        },
        chapter: {
          title: chapter?.title ?? '',
          teachingGoal: chapter?.teachingGoal ?? '',
        },
        courseTopic: blueprint.topic,
        learnerStartingPoint: blueprint.learnerStartingPoint,
        previousTasks,
        nextTaskTitle: nextTask?.title ?? null,
      };
    },
    [courseId, chapterId, blueprint],
  );

  // ---- 任务流请求 ----
  const startTask = useCallback(
    async (taskId: string, explicitAttempt?: number, lessonArg?: NodeLessonV2 | null) => {
      const lesson = lessonArg ?? lessonMirrorRef.current;
      if (!lesson) return;
      const planned = lesson.chapterPlan.tasks.find((t) => t.taskId === taskId);
      if (!planned) return;

      const generation = ++generationRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const attempt = explicitAttempt ?? (attemptsRef.current.get(taskId) ?? 0) + 1;
      attemptsRef.current.set(taskId, attempt);
      commit({ type: 'TASK_STARTING', taskId, now: Date.now() });

      let response: Response;
      try {
        response = await fetch('/api/learning/v2/tasks/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildTaskStreamBody(lesson, taskId, attempt)),
          signal: controller.signal,
        });
      } catch (error) {
        if (generationRef.current !== generation) return; // 已被新流程取代或已卸载
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        if (!aborted) {
          commit({
            type: 'STREAM_FAILED_LOCAL',
            message: '网络连接失败，请检查网络后重试',
            code: 'NETWORK_ERROR',
            now: Date.now(),
          });
        }
        return;
      }

      if (generationRef.current !== generation) return;

      // 流未开始即失败（422 校验等）：错误体为 JSON
      if (!response.ok || !response.body) {
        let message = `任务生成失败（${response.status}）`;
        let code: string | undefined;
        try {
          const errorBody = (await response.json()) as { message?: string; code?: string };
          if (errorBody.message) message = errorBody.message;
          code = errorBody.code;
        } catch {
          // 非 JSON 错误体，用通用文案
        }
        commit({ type: 'STREAM_FAILED_LOCAL', message, code, now: Date.now() });
        return;
      }

      let sawTaskCompleted = false;
      let sawRequestError = false;
      try {
        for await (const event of parseLearningSseStream(response)) {
          if (generationRef.current !== generation) return;
          if (event.type === 'task_completed') {
            sawTaskCompleted = true;
            recordEngagementEvent(courseId, { eventType: 'task_completed', chapterId, taskId });
          }
          if (event.type === 'request_error') sawRequestError = true;
          commit({ type: 'SSE_EVENT', event });
          // P2：task_completed 归约后镜像已同步更新；队列有未完成问题则自动回答（§3.3）
          if (event.type === 'task_completed') orchestratorRef.current?.notifyTaskCompleted();
        }
      } catch (error) {
        if (generationRef.current !== generation) return;
        console.warn('[useChapterLearning] 流读取中断:', error);
      }

      // 流结束但未收到终态事件（上游断流）：本地合成失败，避免卡在 streaming
      if (generationRef.current === generation && !sawTaskCompleted && !sawRequestError) {
        commit({
          type: 'STREAM_FAILED_LOCAL',
          message: '内容生成中断，请重新生成本节',
          code: 'STREAM_INTERRUPTED',
          now: Date.now(),
        });
      }
    },
    [courseId, chapterId, buildTaskStreamBody, commit],
  );

  // ---- 单任务预取：只在边界触发，事件只收进缓存、绝不 dispatch，绝不触碰 generationRef ----
  const runPrefetch = useCallback(
    async (lesson: NodeLessonV2, taskId: string) => {
      const { planId, planVersion } = lesson.chapterPlan;
      const key = prefetchCacheKey(planId, planVersion, taskId);
      if (prefetchCacheRef.current.has(key)) return;

      // 预取占用一个 attempt 号：未命中时即时生成自增，不与废弃预取的幂等键相撞
      const attempt = (attemptsRef.current.get(taskId) ?? 0) + 1;
      attemptsRef.current.set(taskId, attempt);

      const controller = new AbortController();
      prefetchCacheRef.current.set(key, {
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
          const slot = prefetchCacheRef.current.get(key);
          if (!slot) return; // 已被继续/卸载消费或丢弃
          slot.events.push(event);
          if (event.type === 'task_completed') sawTaskCompleted = true;
        }
      } catch {
        // 失败/中断：静默丢弃，不打扰阅读（§6.1）
        prefetchCacheRef.current.delete(key);
        return;
      }

      const slot = prefetchCacheRef.current.get(key);
      if (!slot) return;
      // 写入 complete 前复核状态：仍在边界等待、当前任务与计划版本未变（§2.3）
      const latest = lessonMirrorRef.current;
      const stillAtBoundary =
        latest != null &&
        latest.runtime.status === 'awaiting_user' &&
        latest.runtime.currentTaskId === lesson.runtime.currentTaskId &&
        latest.chapterPlan.planVersion === planVersion;
      if (sawTaskCompleted && stillAtBoundary) {
        slot.complete = true;
      } else {
        prefetchCacheRef.current.delete(key);
      }
    },
    [buildTaskStreamBody],
  );

  // ---- 预取触发：边界等待态且下一任务无缓存 → 静默发起 ----
  useEffect(() => {
    const lesson = state.lesson;
    if (!lesson) return;
    const { planId, planVersion } = lesson.chapterPlan;
    const nextTaskId = canStartPrefetch(lesson, state.phase, (taskId) =>
      prefetchCacheRef.current.has(prefetchCacheKey(planId, planVersion, taskId)),
    );
    if (nextTaskId) void runPrefetch(lesson, nextTaskId);
  }, [state.lesson, state.phase, runPrefetch]);

  // ---- 计划生成 ----
  const fetchPlan = useCallback(async () => {
    const generation = ++generationRef.current;
    commit({ type: 'PLANNING' });
    try {
      const idempotencyKey = buildChapterPlanIdempotencyKey(
        courseId,
        chapterId,
        blueprint.blueprintId,
      );
      // 失败必须 throw：注册表只缓存成功结果，重试才不会吃到失败缓存
      const plan = await planRegistryRef.current.run(idempotencyKey, async () => {
        const response = await fetch('/api/learning/v2/chapters/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, chapterId, idempotencyKey, blueprint }),
        });
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean;
          plan?: ChapterPlan;
          message?: string;
        } | null;
        if (!response.ok || !body?.ok || !body.plan) {
          throw new Error(body?.message ?? `计划生成失败（${response.status}）`);
        }
        return body.plan;
      });
      if (generationRef.current !== generation) return;

      const chapter = blueprint.chapters.find((c) => c.chapterId === chapterId);
      const validation = validateChapterPlan(plan, chapter);
      if (!validation.valid) {
        // 校验失败的计划不缓存、不落盘：清注册表允许重新生成
        planRegistryRef.current.clear();
        commit({
          type: 'PLAN_FAILED',
          message: `计划校验未通过：${validation.errors[0]?.message ?? '未知错误'}`,
        });
        return;
      }

      const lesson = createInitialNodeLessonV2(chapterId, plan, Date.now());
      persist(lesson);
      commit({ type: 'PLAN_READY', lesson });

      const firstTask = [...plan.tasks].sort((a, b) => a.order - b.order)[0];
      if (firstTask) {
        void startTask(firstTask.taskId, 1, lesson);
      } else {
        commit({ type: 'PLAN_FAILED', message: '计划中没有任务，请重新生成' });
      }
    } catch (error) {
      if (generationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : '计划生成失败，请重试';
      commit({ type: 'PLAN_FAILED', message });
    }
  }, [courseId, chapterId, blueprint, persist, startTask, commit]);

  // ---- 章节完成（异步）：completing → Recap → 归档 → completed，落盘后刷新课程树 ----
  const finishChapter = useCallback(async () => {
    const lesson = lessonMirrorRef.current;
    if (!lesson) return;
    const generation = generationRef.current;
    const now = Date.now();

    // ① 进入 completing；容忍从 completing 重入（刷新恢复分支②-bis 后再次点击）
    let workingLesson: NodeLessonV2;
    if (lesson.runtime.status === 'completing') {
      workingLesson = lesson;
    } else {
      const toCompleting = transitionChapter(lesson.runtime, 'completing', now);
      if (!toCompleting.ok) {
        commit({
          type: 'STREAM_FAILED_LOCAL',
          message: toCompleting.reason,
          code: 'TRANSITION_BLOCKED',
          now: Date.now(),
        });
        return;
      }
      workingLesson = {
        ...lesson,
        runtime: {
          ...toCompleting.runtime,
          pendingRequest: {
            requestId: `req-recap-${now.toString(36)}`,
            kind: 'recap',
            status: 'streaming',
            attempt: 1,
            startedAt: now,
          },
        },
        updatedAt: now,
      };
    }
    commit({ type: 'CHAPTER_COMPLETING', lesson: workingLesson });

    // ② Recap 请求：失败必须 throw（注册表只缓存成功）；彻底失败走本地兜底（§7）
    let recap: ChapterRecap;
    try {
      const idempotencyKey = buildChapterCompleteIdempotencyKey(
        courseId,
        chapterId,
        workingLesson.chapterPlan.planId,
        workingLesson.chapterPlan.planVersion,
      );
      recap = await recapRegistryRef.current.run(idempotencyKey, async () => {
        const chapter = blueprint.chapters.find((c) => c.chapterId === chapterId);
        const chapterIndex = blueprint.chapters.findIndex((c) => c.chapterId === chapterId);
        const nextChapter = blueprint.chapters[chapterIndex + 1];
        const sortedTasks = [...workingLesson.chapterPlan.tasks].sort((a, b) => a.order - b.order);
        const tasks = sortedTasks
          .filter((t) => workingLesson.runtime.completedTaskIds.includes(t.taskId))
          .map((t) => {
            const item = workingLesson.streamItems.find(
              (s) => s.type === 'task_content' && s.taskId === t.taskId,
            );
            return {
              title: t.title,
              takeaway: item && item.type === 'task_content' ? item.boundaryPrompt?.takeaway : undefined,
            };
          });
        const response = await fetch('/api/learning/v2/chapters/recap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            courseId,
            chapterId,
            planId: workingLesson.chapterPlan.planId,
            planVersion: workingLesson.chapterPlan.planVersion,
            idempotencyKey,
            courseTopic: blueprint.topic,
            chapter: {
              title: chapter?.title ?? '',
              teachingGoal: chapter?.teachingGoal ?? '',
            },
            tasks,
            nextChapterTitle: nextChapter?.title ?? null,
          }),
        });
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean;
          recap?: ChapterRecap;
          message?: string;
        } | null;
        if (!response.ok || !body?.ok || !body.recap) {
          throw new Error(body?.message ?? `小结生成失败（${response.status}）`);
        }
        return body.recap;
      });
    } catch {
      recap = buildLocalFallbackRecap(workingLesson);
    }
    if (generationRef.current !== generation) return; // 已卸载或被新流程取代

    // ③ 写入 Recap（幂等纯函数）→ ④ 归档压缩（正文块→摘要块，§6.1.1）
    const recapAt = Date.now();
    const archivedLesson = archiveCompletedLesson(applyChapterRecap(workingLesson, recap, recapAt), recapAt);

    // ⑤ completing → completed
    const toCompleted = transitionChapter(archivedLesson.runtime, 'completed', recapAt);
    if (!toCompleted.ok) {
      commit({
        type: 'STREAM_FAILED_LOCAL',
        message: toCompleted.reason,
        code: 'TRANSITION_BLOCKED',
        now: Date.now(),
      });
      return;
    }
    const completedLesson: NodeLessonV2 = {
      ...archivedLesson,
      runtime: { ...toCompleted.runtime, pendingRequest: undefined },
      updatedAt: recapAt,
    };

    // ⑥ 先落盘再刷新课程树：completeChapterV2 复读本地数据要求章节已 completed，顺序不可颠倒
    persist(completedLesson);
    completeChapterV2(courseId, chapterId);
    recordEngagementEvent(courseId, { eventType: 'recap_completed', chapterId });
    recordEngagementEvent(courseId, { eventType: 'chapter_completed', chapterId });
    commit({ type: 'COMPLETED', lesson: completedLesson });
  }, [courseId, chapterId, blueprint, persist, commit]);

  // ---- 边界按钮统一入口 ----
  const continueNext = useCallback(() => {
    const lesson = lessonMirrorRef.current;
    if (!lesson || phaseMirrorRef.current !== 'boundary') return;
    recordEngagementEvent(courseId, { eventType: 'chapter_continued', chapterId });

    // 当前任务失败：重新生成同一任务
    if (lesson.runtime.currentTaskStatus === 'failed' && lesson.runtime.currentTaskId) {
      void startTask(lesson.runtime.currentTaskId);
      return;
    }

    const sortedTasks = [...lesson.chapterPlan.tasks].sort((a, b) => a.order - b.order);
    const currentIndex = sortedTasks.findIndex(
      (t) => t.taskId === lesson.runtime.currentTaskId,
    );
    const nextTask = currentIndex >= 0 ? sortedTasks[currentIndex + 1] : undefined;
    if (!nextTask) {
      void finishChapter();
      return;
    }

    // 预取消费裁决（§10.2 三路径）：命中 → 重编号重放（零等待）；未命中 → 即时生成
    const key = prefetchCacheKey(
      lesson.chapterPlan.planId,
      lesson.chapterPlan.planVersion,
      nextTask.taskId,
    );
    const entry = prefetchCacheRef.current.get(key);
    const decision = resolvePrefetchConsumption(lesson, entry, nextTask.taskId);
    prefetchCacheRef.current.delete(key);
    if (decision.kind === 'replay') {
      recordEngagementEvent(courseId, { eventType: 'prefetch_hit', chapterId, taskId: nextTask.taskId });
      let replayedTaskCompleted = false;
      for (const event of decision.events) {
        commit({ type: 'SSE_EVENT', event });
        if (event.type === 'task_completed') replayedTaskCompleted = true;
      }
      // P2：重放路径同样触发队列自动派发，否则流中排队的问题会失去任务完成时机
      if (replayedTaskCompleted) orchestratorRef.current?.notifyTaskCompleted();
      return;
    }
    recordEngagementEvent(courseId, { eventType: 'prefetch_missed', chapterId, taskId: nextTask.taskId });
    entry?.controller.abort();
    void startTask(nextTask.taskId);
  }, [courseId, chapterId, startTask, finishChapter, commit]);

  const retryPlan = useCallback(() => {
    planRegistryRef.current.clear();
    void fetchPlan();
  }, [fetchPlan]);

  // ---- P2 流内答疑入口 ----
  const submitTutorQuestion = useCallback((text: string) => {
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return;
    const now = Date.now();
    orchestrator.submitQuestion(text, createTutorQuestionId(now), now);
  }, []);

  const retryTutor = useCallback((questionId: string) => {
    orchestratorRef.current?.retry(questionId);
  }, []);

  // ---- 挂载：按恢复决策起步 + Tutor 刷新恢复；卸载：双流一并作废 + flush ----
  useEffect(() => {
    recordEngagementEvent(courseId, { eventType: 'chapter_opened', chapterId });
    const action = bootActionRef.current;
    if (action?.kind === 'generate_plan') {
      void fetchPlan();
    } else if (action?.kind === 'start_task') {
      // 失败任务（恢复分支⑥）随挂载自动重试一次；再失败由边界按钮接管
      void startTask(action.taskId, action.attempt, lessonMirrorRef.current);
    }

    // P2 Tutor 刷新恢复：归一结果落盘（无变化跳过）；被中断问题自动重试一次，
    // 或边界空闲时兜底派发最早未答问题（含无 pendingRequest 的已提交问题，§5）
    const tutorResume = tutorResumeRef.current;
    if (tutorResume?.persisted) persist(lessonMirrorRef.current);
    orchestratorRef.current?.resumeFromBoot(tutorResume?.shouldAutoRetry ?? false);

    return () => {
      recordEngagementEvent(courseId, { eventType: 'exited', chapterId });
      generationRef.current += 1;
      abortRef.current?.abort();
      orchestratorRef.current?.invalidate(); // P2：作废 Tutor 流并归一中断态（不删除已写入问题）
      for (const slot of prefetchCacheRef.current.values()) slot.controller.abort();
      prefetchCacheRef.current.clear();
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      persist(lessonMirrorRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- P2 Tutor UI 状态 ----
  // 忙闲 = 编排器在途标记（发起→首事件窗口）或容器内 tutor 请求流式中；
  // 两者翻转都伴随容器提交触发的重渲染，渲染期读 ref 安全
  const pendingRequest = state.lesson?.runtime.pendingRequest;
  const isTutorBusy =
    (orchestratorRef.current?.isBusy ?? false) ||
    (pendingRequest?.kind === 'tutor' && pendingRequest.status === 'streaming');
  const tutorState = useMemo<TutorUiState>(() => {
    const lesson = state.lesson;
    const failedQuestionIds = lesson
      ? lesson.streamItems
          .filter(
            (item): item is TutorAnswerItem =>
              item.type === 'tutor_answer' && item.status === 'failed',
          )
          .map((item) => item.questionId)
      : [];
    return {
      busy: isTutorBusy,
      pendingCount: lesson ? countUnansweredTutorQuestions(lesson) : 0,
      autoWindowLimit: TUTOR_AUTO_WINDOW_LIMIT,
      failedQuestionIds,
    };
  }, [state.lesson, isTutorBusy]);

  const bootAction = bootActionRef.current;
  const currentTaskId = state.lesson?.runtime.currentTaskId ?? null;
  return {
    lesson: state.lesson,
    phase: state.phase,
    planError: state.planError,
    continueNext,
    retryPlan,
    resumeAnchorTaskId: bootAction?.kind === 'render_boundary' ? bootAction.taskId : null,
    currentTaskAttempts: currentTaskId ? attemptsRef.current.get(currentTaskId) ?? 0 : 0,
    submitTutorQuestion,
    retryTutor,
    tutorState,
    isTutorBusy,
  };
}
