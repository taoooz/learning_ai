'use client';

// hooks/learning-v2/useChapterLearning.ts
// V2 章节学习核心循环：计划生成 → 逐任务流式 → 边界停顿 → 继续 → 完成章节
// P1b 扩展：单任务预取（纯内存缓存，绑定 planId+planVersion+taskId，§6.1）；
// 章节完成流异步化（Recap 请求 → 本地兜底 → 归档压缩 → 解锁下一章，§6.1.1/§7）
// 状态事实来源是 NodeLessonV2.runtime（reducer 纯函数推进），hook 只负责
// 请求编排、节流落盘与竞态守卫（代际计数 + AbortController + 幂等注册表）

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  ChapterPlan,
  ChapterRecap,
  CourseBlueprintV2,
  LearningSseEvent,
  NodeLessonV2,
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

export type ChapterPhase =
  | 'planning' // 正在生成章节计划
  | 'generating' // 任务请求已发出，等待首个事件
  | 'streaming' // 任务流式生成中
  | 'boundary' // 任务边界：等用户点「继续」或「重新生成」
  | 'completing' // 章节收尾中
  | 'completed' // 章节已完成
  | 'plan_failed'; // 计划生成失败，可重试

interface HookState {
  lesson: NodeLessonV2 | null;
  phase: ChapterPhase;
  planError: string | null;
}

type HookAction =
  | { type: 'PLANNING' }
  | { type: 'PLAN_READY'; lesson: NodeLessonV2 }
  | { type: 'PLAN_FAILED'; message: string }
  | { type: 'TASK_STARTING'; taskId: string }
  | { type: 'SSE_EVENT'; event: LearningSseEvent }
  | { type: 'STREAM_FAILED_LOCAL'; message: string; code?: string }
  | { type: 'CHAPTER_COMPLETING'; lesson: NodeLessonV2 }
  | { type: 'COMPLETED'; lesson: NodeLessonV2 };

function derivePhase(lesson: NodeLessonV2, prev: ChapterPhase): ChapterPhase {
  const { runtime } = lesson;
  if (runtime.status === 'completed') return 'completed';
  if (runtime.status === 'completing') return 'completing';
  if (runtime.currentTaskStatus === 'failed') return 'boundary';
  if (runtime.status === 'awaiting_user' && runtime.currentTaskStatus === 'awaiting_user') {
    return 'boundary';
  }
  if (runtime.currentTaskStatus === 'streaming') return 'streaming';
  return prev;
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
      const now = Date.now();
      const transitioned = transitionTask(state.lesson.runtime, 'generating', now);
      const runtime = transitioned.ok
        ? transitioned.runtime
        : { ...state.lesson.runtime, currentTaskStatus: 'generating' as const, lastActiveAt: now };
      return {
        ...state,
        phase: 'generating',
        lesson: {
          ...state.lesson,
          runtime: { ...runtime, currentTaskId: action.taskId },
          updatedAt: now,
        },
      };
    }
    case 'SSE_EVENT': {
      if (!state.lesson) return state;
      const lesson = applyLearningSseEvent(state.lesson, action.event);
      return { ...state, lesson, phase: derivePhase(lesson, state.phase) };
    }
    case 'STREAM_FAILED_LOCAL': {
      // 传输层失败（HTTP 错误/流中断）：reducer 侧无对应 SSE 事件，本地合成失败态
      if (!state.lesson) return state;
      const now = Date.now();
      const transitioned = transitionTask(state.lesson.runtime, 'failed', now);
      const runtime = transitioned.ok
        ? transitioned.runtime
        : { ...state.lesson.runtime, currentTaskStatus: 'failed' as const, lastActiveAt: now };
      const lesson = appendSystemNotice(
        { ...state.lesson, runtime },
        { tone: 'error', message: action.message, code: action.code },
        now,
      );
      return { ...state, lesson, phase: 'boundary' };
    }
    case 'CHAPTER_COMPLETING':
      // completing 属终态名单，落盘 effect 会立即写入（含 pendingRequest，供刷新恢复分支②-bis）
      return { ...state, lesson: action.lesson, phase: 'completing' };
    case 'COMPLETED':
      return { lesson: action.lesson, phase: 'completed', planError: null };
    default:
      return state;
  }
}

interface UseChapterLearningArgs {
  courseId: string;
  chapterId: string;
  blueprint: CourseBlueprintV2;
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
  const [state, dispatch] = useReducer(reducer, undefined, (): HookState => {
    const lesson = loadNodeLessonV2(courseId, chapterId);
    const action = decideResumeAction(lesson);
    bootActionRef.current = action;
    switch (action.kind) {
      case 'generate_plan':
        return { lesson: null, phase: 'planning', planError: null };
      case 'render_completed':
        return { lesson, phase: 'completed', planError: null };
      case 'render_boundary':
        return { lesson, phase: 'boundary', planError: null };
      case 'start_task':
        return { lesson, phase: 'generating', planError: null };
    }
  });

  // 同步镜像：供回调读取最新 state，避免 useCallback 闭包过期
  const stateRef = useRef(state);
  stateRef.current = state;

  // 落盘走配额兜底：写失败时先压缩历史已完成章节再重试（§6.1.1）
  const persist = useCallback(
    (lesson: NodeLessonV2 | null) => {
      if (lesson) saveNodeLessonV2WithQuotaFallback(courseId, lesson, blueprint);
    },
    [courseId, blueprint],
  );

  // ---- 落盘：非终态节流，终态立即写 ----
  useEffect(() => {
    const lesson = state.lesson;
    if (!lesson) return;
    const terminal =
      lesson.runtime.status === 'awaiting_user' ||
      lesson.runtime.status === 'completing' ||
      lesson.runtime.status === 'completed' ||
      lesson.runtime.currentTaskStatus === 'failed';
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
        persist(stateRef.current.lesson);
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
      const lesson = lessonArg ?? stateRef.current.lesson;
      if (!lesson) return;
      const planned = lesson.chapterPlan.tasks.find((t) => t.taskId === taskId);
      if (!planned) return;

      const generation = ++generationRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const attempt = explicitAttempt ?? (attemptsRef.current.get(taskId) ?? 0) + 1;
      attemptsRef.current.set(taskId, attempt);
      dispatch({ type: 'TASK_STARTING', taskId });

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
          dispatch({ type: 'STREAM_FAILED_LOCAL', message: '网络连接失败，请检查网络后重试', code: 'NETWORK_ERROR' });
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
        dispatch({ type: 'STREAM_FAILED_LOCAL', message, code });
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
          dispatch({ type: 'SSE_EVENT', event });
        }
      } catch (error) {
        if (generationRef.current !== generation) return;
        console.warn('[useChapterLearning] 流读取中断:', error);
      }

      // 流结束但未收到终态事件（上游断流）：本地合成失败，避免卡在 streaming
      if (generationRef.current === generation && !sawTaskCompleted && !sawRequestError) {
        dispatch({
          type: 'STREAM_FAILED_LOCAL',
          message: '内容生成中断，请重新生成本节',
          code: 'STREAM_INTERRUPTED',
        });
      }
    },
    [courseId, chapterId, buildTaskStreamBody],
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
      const latest = stateRef.current.lesson;
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
    dispatch({ type: 'PLANNING' });
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
        dispatch({
          type: 'PLAN_FAILED',
          message: `计划校验未通过：${validation.errors[0]?.message ?? '未知错误'}`,
        });
        return;
      }

      const lesson = createInitialNodeLessonV2(chapterId, plan, Date.now());
      persist(lesson);
      dispatch({ type: 'PLAN_READY', lesson });

      const firstTask = [...plan.tasks].sort((a, b) => a.order - b.order)[0];
      if (firstTask) {
        void startTask(firstTask.taskId, 1, lesson);
      } else {
        dispatch({ type: 'PLAN_FAILED', message: '计划中没有任务，请重新生成' });
      }
    } catch (error) {
      if (generationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : '计划生成失败，请重试';
      dispatch({ type: 'PLAN_FAILED', message });
    }
  }, [courseId, chapterId, blueprint, persist, startTask]);

  // ---- 章节完成（异步）：completing → Recap → 归档 → completed，落盘后刷新课程树 ----
  const finishChapter = useCallback(async () => {
    const lesson = stateRef.current.lesson;
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
        dispatch({ type: 'STREAM_FAILED_LOCAL', message: toCompleting.reason, code: 'TRANSITION_BLOCKED' });
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
    dispatch({ type: 'CHAPTER_COMPLETING', lesson: workingLesson });

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
      dispatch({ type: 'STREAM_FAILED_LOCAL', message: toCompleted.reason, code: 'TRANSITION_BLOCKED' });
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
    dispatch({ type: 'COMPLETED', lesson: completedLesson });
  }, [courseId, chapterId, blueprint, persist]);

  // ---- 边界按钮统一入口 ----
  const continueNext = useCallback(() => {
    const lesson = stateRef.current.lesson;
    if (!lesson || stateRef.current.phase !== 'boundary') return;
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
      for (const event of decision.events) {
        dispatch({ type: 'SSE_EVENT', event });
      }
      return;
    }
    recordEngagementEvent(courseId, { eventType: 'prefetch_missed', chapterId, taskId: nextTask.taskId });
    entry?.controller.abort();
    void startTask(nextTask.taskId);
  }, [courseId, chapterId, startTask, finishChapter]);

  const retryPlan = useCallback(() => {
    planRegistryRef.current.clear();
    void fetchPlan();
  }, [fetchPlan]);

  // ---- 挂载：按恢复决策起步；卸载：abort + flush ----
  useEffect(() => {
    recordEngagementEvent(courseId, { eventType: 'chapter_opened', chapterId });
    const action = bootActionRef.current;
    if (action?.kind === 'generate_plan') {
      void fetchPlan();
    } else if (action?.kind === 'start_task') {
      // 失败任务（恢复分支⑥）随挂载自动重试一次；再失败由边界按钮接管
      void startTask(action.taskId, action.attempt, stateRef.current.lesson);
    }

    return () => {
      recordEngagementEvent(courseId, { eventType: 'exited', chapterId });
      generationRef.current += 1;
      abortRef.current?.abort();
      for (const slot of prefetchCacheRef.current.values()) slot.controller.abort();
      prefetchCacheRef.current.clear();
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      persist(stateRef.current.lesson);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  };
}
