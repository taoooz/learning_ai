'use client';

// hooks/learning-v2/useChapterLearning.ts
// V2 章节学习核心循环：计划生成 → 逐任务流式 → 边界停顿 → 继续 → 完成章节
// P1b 扩展：单任务预取（纯内存缓存，绑定 planId+planVersion+taskId，§6.1）；
// 章节完成流异步化（Recap 请求 → 本地兜底 → 解锁下一章；归档只作为存储配额兜底）
// P2 扩展：流内答疑双流编排（设计文档 §3/§4/§5）——提问提交/排队/自动派发/重试/刷新恢复
// 状态事实来源是 NodeLessonV2.runtime（reducer 纯函数推进），hook 只负责
// 请求编排、节流落盘与竞态守卫（代际计数 + AbortController + 幂等注册表）
// 双流隔离（§3.1）：主任务流持有 generationRef/abortRef；Tutor 由
// TutorStreamOrchestrator 持有独立代际与 abort。Tutor 请求不取消主任务流，
// 主任务流也不取消 Tutor；章节卸载/切换时两者一并作废。

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  ChapterPlan,
  ChapterRecap,
  ChapterPlanPatch,
  CourseBlueprintV2,
  LearningSseEvent,
  NodeLessonV2,
  TutorAnswerItem,
} from '@/types/learning-v2';
import {
  createInitialNodeLessonV2,
} from '@/lib/learning-v2/reducers';
import { loadNodeLessonV2 } from '@/lib/learning-v2/storage';
import { getLessonRepository } from '@/lib/learning-v2/lesson-repository';
import { validateChapterPlan } from '@/lib/learning-v2/validators';
import {
  buildChapterPlanIdempotencyKey,
  buildTaskAttemptIdempotencyKey,
  IdempotencyRegistry,
} from '@/lib/learning-v2/idempotency';
import { decideResumeAction } from '@/lib/learning-v2/resume';
import { parseLearningSseStream } from '@/lib/learning-v2/sse-client';
import { useChapterCompletion } from './useChapterCompletion';
import { usePlanSuggestion } from './usePlanSuggestion';
import { useCheckpointActions } from './useCheckpointActions';
import { recordEngagementEvent } from '@/lib/learning-v2/engagement';
import {
  canStartPrefetch,
  resolvePrefetchConsumption,
} from '@/lib/learning-v2/prefetch';
import {
  prefetchCacheKey,
  runTaskPrefetch,
  type PrefetchSlot,
} from '@/lib/learning-v2/task-prefetch-runtime';
import { countUnansweredTutorQuestions, TUTOR_AUTO_WINDOW_LIMIT } from '@/lib/learning-v2/tutor-queue';
import {
  deriveChapterPhase,
  prepareTutorBoot,
  TutorStreamOrchestrator,
} from '@/lib/learning-v2/tutor-orchestration';
import {
  bootStateFor,
  chapterLearningReducer as reducer,
  mirrorLesson,
  mirrorPhase,
  type ChapterLearningAction,
  type ChapterLearningState,
  type ChapterPhase,
} from '@/lib/learning-v2/chapter-learning-state';

export type { ChapterPhase };

/** 存储模式（构建期内联）：server 走 LessonRepository 异步启动，local 保持同步启动 */
const STORE_MODE: 'local' | 'server' =
  process.env.NEXT_PUBLIC_LESSON_STORE === 'server' ? 'server' : 'local';

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
  /** 错误卡片重试指定任务；与边界卡共用同一任务启动链路 */
  retryTask: (taskId: string) => void;
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
  /** P3a：提交 Checkpoint 答案（服务端程序判分） */
  submitCheckpoint: (checkpointId: string, answer: string | string[]) => Promise<void>;
  /** P3a：重试 Checkpoint（清除评估结果回到 pending） */
  retryCheckpoint: (checkpointId: string) => void;
  /** P3a：补救流程（LLM 生成补救内容 + 等价新题） */
  requestRemediation: (checkpointId: string) => Promise<void>;
  /** P4：待用户决策的调度建议（null = 无建议） */
  planSuggestion: ChapterPlanPatch | null;
  /** P4：边界时请求调度建议（有证据才发起，预校验后才展示） */
  requestPlanSuggestion: () => Promise<void>;
  /** P4：用户接受建议 → 应用补丁 */
  acceptPlanSuggestion: () => void;
  /** P4：用户忽略建议 */
  dismissPlanSuggestion: () => void;
  /** P5.1：server 模式保存冲突提示；local 恒为 null */
  saveConflict: string | null;
  /** P5.1：丢弃本机未保存改动，加载服务端版本 */
  loadServerVersion: () => Promise<void>;
  /** P5.1：用本机进度显式覆盖服务端 */
  overwriteServerVersion: () => void;
}

/** 落盘节流窗口：流式期间约 300ms 写一次，终态立即写 */
const SAVE_THROTTLE_MS = 300;

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

  // P4：待用户决策的调度建议（UI 级状态，不落盘；接受时才写入 lesson）

  // P5.1：server 模式启动装载是异步的——先返回未装载态，由挂载 effect 完成启动
  const bootPendingRef = useRef(STORE_MODE === 'server');
  /** server 模式乐观锁：下一次保存必须基于最后一次读到的服务端 revision。 */
  const serverLessonRevisionRef = useRef<number | null>(null);
  const conflictServerRevisionRef = useRef<number | null>(null);
  const lessonSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const [saveConflict, setSaveConflict] = useState<string | null>(null);

  const [state, dispatch] = useReducer(reducer, undefined, (): ChapterLearningState => {
    if (STORE_MODE === 'server') {
      bootActionRef.current = null;
      return { lesson: null, phase: 'planning', planError: null };
    }
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
    return { ...bootStateFor(bootLesson, action), planError: null };
  });

  // 同步镜像：初始值 = 启动容器/相位；之后只由 commit 同步更新，不被 React 渲染覆盖
  const lessonMirrorRef = useRef<NodeLessonV2 | null>(state.lesson);
  const phaseMirrorRef = useRef<ChapterPhase>(state.phase);
  if (STORE_MODE === 'local') {
    serverLessonRevisionRef.current = state.lesson?.updatedAt ?? null;
  }

  // 落盘走仓库抽象（P5.1）：local = 配额兜底包装；server = 带 revision 的 CAS + 串行提交。
  const persist = useCallback(
    (lesson: NodeLessonV2 | null) => {
      if (!lesson) return;
      if (STORE_MODE === 'local') {
        // 本地写入保持同步执行：章节完成动作随后会复读本地数据，不能等待微任务。
        void getLessonRepository()
          .saveLesson(courseId, chapterId, lesson, blueprint)
          .catch((error) => {
            console.warn('[useChapterLearning] 持久化失败（静默降级）:', error);
          });
        return;
      }
      const operation = async () => {
        const repository = getLessonRepository();
        try {
          const result = await repository.saveLesson(
            courseId,
            chapterId,
            lesson,
            blueprint,
            serverLessonRevisionRef.current,
          );
          if (result.saved && typeof result.serverUpdatedAt === 'number') {
            serverLessonRevisionRef.current = result.serverUpdatedAt;
            setSaveConflict(null);
          }
          if (result.conflict) {
            if (typeof result.serverUpdatedAt === 'number') {
              conflictServerRevisionRef.current = result.serverUpdatedAt;
            }
            setSaveConflict('检测到其他设备的更新，当前进度尚未保存。可选择加载服务端版本，或用本机进度覆盖。');
          }
        } catch (error) {
          console.warn('[useChapterLearning] 持久化失败（静默降级）:', error);
        }
      };
      lessonSaveQueueRef.current = lessonSaveQueueRef.current.then(operation, operation);
    },
    [courseId, chapterId, blueprint],
  );

  // 统一提交入口：同步更新镜像 + dispatch 到 React state（所有状态变更必须走这里）
  const commit = useCallback((action: ChapterLearningAction) => {
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

  // ---- P3a Checkpoint 编排（生成/判分/重试/补救） ----
  const {
    maybeGenerateCheckpoint,
    submitCheckpoint,
    retryCheckpoint,
    requestRemediation,
  } = useCheckpointActions({
    courseId,
    chapterId,
    blueprint,
    lessonMirrorRef,
    commit,
  });

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

      // P3a：任务完成且 evidencePolicy=checkpoint 且尚无 checkpoint → 生成
      if (generationRef.current === generation && sawTaskCompleted) {
        maybeGenerateCheckpoint(taskId);
      }
    },
    [courseId, chapterId, buildTaskStreamBody, commit, maybeGenerateCheckpoint],
  );

  // ---- 单任务预取：只在边界触发，事件只收进缓存、绝不 dispatch，绝不触碰 generationRef ----
  const runPrefetch = useCallback(
    async (lesson: NodeLessonV2, taskId: string) => {
      await runTaskPrefetch({
        lesson,
        taskId,
        cache: prefetchCacheRef.current,
        attempts: attemptsRef.current,
        buildTaskStreamBody,
        getLatestLesson: () => lessonMirrorRef.current,
      });
    },
    [buildTaskStreamBody],
  );

  // ---- 预取触发：边界等待态且下一任务无缓存 → 静默发起 ----
  // 默认关闭：完整预取会在继续时一次性重放全部事件，用户感知上“不流式”。
  // 如需恢复零等待，可设置 NEXT_PUBLIC_ENABLE_TASK_PREFETCH=1。
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENABLE_TASK_PREFETCH !== '1') return;
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

  // ---- 章节完成编排（completing → Recap → completed） ----
  const { finishChapter } = useChapterCompletion({
    courseId,
    chapterId,
    blueprint,
    lessonMirrorRef,
    generationRef,
    recapRegistryRef,
    commit,
    persist,
  });

  /** 错误卡片重试指定任务 */
  const retryTask = useCallback((taskId: string) => {
    void startTask(taskId);
  }, [startTask]);

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

    // 预取默认关闭。这里也必须同样 gate：否则热更新/旧会话里已存在的缓存仍会被一次性重放，
    // 用户会继续看到“整块出现”而不是真实流式。
    const prefetchEnabled = process.env.NEXT_PUBLIC_ENABLE_TASK_PREFETCH === '1';
    const key = prefetchCacheKey(
      lesson.chapterPlan.planId,
      lesson.chapterPlan.planVersion,
      nextTask.taskId,
    );
    const entry = prefetchCacheRef.current.get(key);
    const decision = prefetchEnabled
      ? resolvePrefetchConsumption(lesson, entry, nextTask.taskId)
      : { kind: 'live' as const };
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

  // ---- P4 动态调度（建议请求/接受/忽略） ----
  const {
    planSuggestion,
    requestPlanSuggestion,
    acceptPlanSuggestion,
    dismissPlanSuggestion,
  } = usePlanSuggestion({
    courseId,
    chapterId,
    blueprint,
    lessonMirrorRef,
    phaseMirrorRef,
    commit,
  });

  /** 冲突恢复 A：用服务端版本替换本机未保存改动。 */
  const loadServerVersion = useCallback(async () => {
    const serverLesson = await getLessonRepository().loadLesson(courseId, chapterId);
    if (!serverLesson) return;
    serverLessonRevisionRef.current = serverLesson.updatedAt;
    conflictServerRevisionRef.current = null;
    setSaveConflict(null);
    commit({
      type: 'BOOT_READY',
      lesson: serverLesson,
      phase: deriveChapterPhase(serverLesson, phaseMirrorRef.current),
    });
  }, [chapterId, courseId, commit]);

  /** 冲突恢复 B：以最后一次读到的服务端 revision 为基线，显式覆盖服务端。 */
  const overwriteServerVersion = useCallback(() => {
    const serverRevision = conflictServerRevisionRef.current;
    if (serverRevision == null) return;
    serverLessonRevisionRef.current = serverRevision;
    conflictServerRevisionRef.current = null;
    setSaveConflict(null);
    persist(lessonMirrorRef.current);
  }, [persist]);

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

  // ---- P5.1 server 模式：异步启动装载（local 模式 bootPendingRef 为 false，直接跳过） ----
  useEffect(() => {
    if (!bootPendingRef.current) return;
    bootPendingRef.current = false;
    let cancelled = false;
    void (async () => {
      const lesson = await getLessonRepository().loadLesson(courseId, chapterId);
      if (cancelled) return;
      const prepared = prepareTutorBoot(lesson, Date.now());
      tutorResumeRef.current = {
        persisted: prepared.persisted,
        shouldAutoRetry: prepared.shouldAutoRetry,
      };
      serverLessonRevisionRef.current = prepared.lesson?.updatedAt ?? null;
      const action = decideResumeAction(prepared.lesson);
      bootActionRef.current = action;
      const boot = bootStateFor(prepared.lesson, action);
      commit({ type: 'BOOT_READY', lesson: boot.lesson, phase: boot.phase });

      // 启动转换（与挂载 effect 同构）：计划生成 / 失败任务自动重试
      if (action.kind === 'generate_plan') {
        void fetchPlan();
      } else if (action.kind === 'start_task') {
        void startTask(action.taskId, action.attempt, lessonMirrorRef.current);
      }
      const tutorResume = tutorResumeRef.current;
      if (tutorResume?.persisted) persist(lessonMirrorRef.current);
      orchestratorRef.current?.resumeFromBoot(tutorResume?.shouldAutoRetry ?? false);
    })();
    return () => {
      cancelled = true;
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
    retryTask,
    resumeAnchorTaskId: bootAction?.kind === 'render_boundary' ? bootAction.taskId : null,
    currentTaskAttempts: currentTaskId ? attemptsRef.current.get(currentTaskId) ?? 0 : 0,
    submitTutorQuestion,
    retryTutor,
    tutorState,
    isTutorBusy,
    submitCheckpoint,
    retryCheckpoint,
    requestRemediation,
    planSuggestion,
    requestPlanSuggestion,
    acceptPlanSuggestion,
    dismissPlanSuggestion,
    saveConflict,
    loadServerVersion,
    overwriteServerVersion,
  };
}
