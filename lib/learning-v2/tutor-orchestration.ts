// lib/learning-v2/tutor-orchestration.ts
// P2 流内答疑双流编排层（设计文档 §3/§4/§5，计划 Task 6）
// 职责：把「提交/自动派发/重试/恢复/失效」这些编排决策抽为可测单元，
// useChapterLearning 只做薄接线（同步镜像 + dispatch + 持久化）。
// 隔离红线（§3.1）：本层只持有 Tutor 侧的代际计数与 AbortController，
// 绝不触碰主任务流的 generation/abort；主任务流也绝不取消 Tutor 请求。
// 终止兜底：Tutor 流读取异常或流无终态结束时，本地合成 request_error
// （与主任务流 STREAM_FAILED_LOCAL 同模式），防止 pendingRequest 永久停留
// streaming 阻塞重试。

import type { LearningSseEvent, NodeLessonV2, UserQuestionItem } from '@/types/learning-v2';
import { applyLearningSseEvent, appendUserQuestion } from './reducers';
import { getPendingTutorQuestions, TUTOR_AUTO_WINDOW_LIMIT } from './tutor-queue';
import { buildInlineTutorContext, type InlineTutorRequestPayload } from './tutor-context';
import { buildTutorRequestIdempotencyKey } from './idempotency';
import { normalizeTutorRuntimeForResume } from './resume';
import { parseLearningSseStream } from './sse-client';

/** 章节相位名（与 useChapterLearning 的 ChapterPhase 同源同值） */
export type ChapterPhaseName =
  | 'planning'
  | 'generating'
  | 'streaming'
  | 'boundary'
  | 'completing'
  | 'completed'
  | 'plan_failed';

/**
 * 从容器推导章节相位（纯函数）。
 * 与 hook 内既有派生逻辑一致，抽出后由 hook 与测试基座共用，
 * 保证「回答后仍保持边界」等相位断言两侧同源。
 */
export function deriveChapterPhase(
  lesson: NodeLessonV2,
  prev: ChapterPhaseName,
): ChapterPhaseName {
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

// ---- 纯决策函数 ----

export type TutorSubmitAction = 'start' | 'queue';

export interface TutorSubmitDecisionInput {
  lesson: NodeLessonV2;
  phase: ChapterPhaseName;
  /** Tutor 是否忙碌（请求在途或回答流式中） */
  isTutorBusy: boolean;
  text: string;
  questionId: string;
  now: number;
}

export interface TutorSubmitDecision {
  /** 追加问题后的新容器（确定性 itemId 幂等） */
  lesson: NodeLessonV2;
  questionId: string;
  taskId: string;
  /** 边界且 Tutor 空闲 → 立即启动；否则入队（流中/忙碌/其他相位，§1/§3.3） */
  action: TutorSubmitAction;
}

/**
 * 提问提交决策（纯函数）：trim 后非空且存在当前任务才受理。
 * 问题立即入流（设计文档 §2.1）；是否立即回答由相位与忙闲决定。
 */
export function decideTutorSubmission(
  input: TutorSubmitDecisionInput,
): TutorSubmitDecision | null {
  const text = input.text.trim();
  if (!text) return null;
  const taskId = input.lesson.runtime.currentTaskId;
  if (!taskId) return null;
  const lesson = appendUserQuestion(
    input.lesson,
    { taskId, questionId: input.questionId, text },
    input.now,
  );
  const action: TutorSubmitAction =
    input.phase === 'boundary' && !input.isTutorBusy ? 'start' : 'queue';
  return { lesson, questionId: input.questionId, taskId, action };
}

/**
 * 自动派发选题（纯函数）：Tutor 忙碌不派发；
 * 否则取自动窗口内最早一题（窗口截取是消费方职责，§3.3）。
 */
export function pickAutoTutorQuestion(
  lesson: NodeLessonV2,
  isTutorBusy: boolean,
): UserQuestionItem | undefined {
  if (isTutorBusy) return undefined;
  return getPendingTutorQuestions(lesson).slice(0, TUTOR_AUTO_WINDOW_LIMIT)[0];
}

/** 重试决策（纯函数）：只有失败的问题可重试；重试是用户显式动作，不入自动队列（§4） */
export function canRetryTutorQuestion(
  lesson: NodeLessonV2,
  questionId: string,
): UserQuestionItem | undefined {
  const question = lesson.streamItems.find(
    (item): item is UserQuestionItem =>
      item.type === 'user_question' && item.questionId === questionId,
  );
  if (!question) return undefined;
  const answer = lesson.streamItems.find(
    (item) => item.type === 'tutor_answer' && item.questionId === questionId,
  );
  const failed =
    (answer?.type === 'tutor_answer' && answer.status === 'failed') ||
    question.status === 'failed';
  return failed ? question : undefined;
}

// ---- 启动准备（初始化归一，供 hook 与测试共用） ----

export interface TutorBootPreparation {
  lesson: NodeLessonV2 | null;
  /** 归一是否改动了容器 → 启动时是否需要落盘（原样返回时跳过冗余落盘） */
  persisted: boolean;
  /** 是否需要对最早未完成问题执行一次自动重试 */
  shouldAutoRetry: boolean;
}

/** 刷新恢复准备（纯函数）：对持久化容器做 Tutor 归一（设计文档 §5），不触碰主任务状态 */
export function prepareTutorBoot(
  lesson: NodeLessonV2 | null,
  now: number,
): TutorBootPreparation {
  if (!lesson) return { lesson: null, persisted: false, shouldAutoRetry: false };
  const normalized = normalizeTutorRuntimeForResume(lesson, now);
  return {
    lesson: normalized.lesson,
    persisted: normalized.lesson !== lesson,
    shouldAutoRetry: normalized.shouldAutoRetry,
  };
}

// ---- 编排器 ----

/** 参与信号事件类型（与 engagement.ts 的 Tutor 事件对齐） */
export type TutorEngagementEventType =
  | 'tutor_question_submitted'
  | 'tutor_answer_completed'
  | 'tutor_answer_failed';

/**
 * 编排器与宿主（hook/测试基座）之间的桥。
 * 宿主负责提供最新容器与相位（同步镜像）、把归约结果写回状态源，
 * 编排器不感知 React、不感知主任务流。
 */
export interface TutorBridge {
  courseId: string;
  chapterId: string;
  courseTopic: string;
  chapterTitle: string;
  chapterTeachingGoal: string;
  /** 读取最新容器（hook：同步镜像） */
  getLesson(): NodeLessonV2 | null;
  /** 读取当前章节相位（边界是唯一可回答时机） */
  getPhase(): ChapterPhaseName;
  /** 写回归约结果；persistNow → 宿主立即落盘（提问提交/终态） */
  commitLesson(next: NodeLessonV2, opts?: { persistNow?: boolean }): void;
  /** 发起 Tutor SSE 请求（独立 AbortSignal，绝不触碰主任务流） */
  fetchTutorStream(body: InlineTutorRequestPayload, signal: AbortSignal): Promise<Response>;
  recordEngagement(eventType: TutorEngagementEventType, taskId?: string): void;
  now?(): number;
}

/**
 * Tutor 流编排器：独立代际计数 + 独立 AbortController + 忙闲标志。
 * 与主任务流的请求控制完全隔离（§3.1）；卸载/章节切换经 invalidate 一并作废。
 */
export class TutorStreamOrchestrator {
  private generation = 0;
  private controller: AbortController | null = null;
  private busy = false;

  constructor(private readonly bridge: TutorBridge) {}

  get isBusy(): boolean {
    return this.busy;
  }

  /** 提交问题：返回决策结果；null → 拒收（空白/无当前任务/无容器） */
  submitQuestion(rawText: string, questionId: string, now: number): TutorSubmitDecision | null {
    const lesson = this.bridge.getLesson();
    if (!lesson) return null;
    const decision = decideTutorSubmission({
      lesson,
      phase: this.bridge.getPhase(),
      isTutorBusy: this.busy,
      text: rawText,
      questionId,
      now,
    });
    if (!decision) return null;
    // 问题是明确学习轨迹：立即落盘，不等节流窗口（§5）
    this.bridge.commitLesson(decision.lesson, { persistNow: true });
    this.bridge.recordEngagement('tutor_question_submitted', decision.taskId);
    if (decision.action === 'start') {
      const question = decision.lesson.streamItems.find(
        (item): item is UserQuestionItem =>
          item.type === 'user_question' && item.questionId === decision.questionId,
      );
      if (question) void this.startQuestion(question);
    }
    return decision;
  }

  /** 主任务 task_completed 归约完成后调用：队列非空且处于边界时自动回答最早一题（§3.3） */
  notifyTaskCompleted(): void {
    this.dispatchQueued();
  }

  /**
   * 刷新恢复派发：自动重试标记为真或边界空闲时，从队列启动最早问题。
   * 无 pendingRequest 的已提交未答问题由此兜底（§5）；非边界相位一律不启动。
   */
  resumeFromBoot(shouldAutoRetry: boolean): void {
    if (!shouldAutoRetry && this.bridge.getPhase() !== 'boundary') return;
    this.dispatchQueued();
  }

  /** 显式重试：仅重发该失败问题，独立新请求；忙碌期间不受理（§4） */
  retry(questionId: string): boolean {
    const lesson = this.bridge.getLesson();
    if (!lesson || this.busy) return false;
    const question = canRetryTutorQuestion(lesson, questionId);
    if (!question) return false;
    void this.startQuestion(question);
    return true;
  }

  /**
   * 卸载/章节切换：作废在途请求并把中断态归一为 pending（同刷新恢复语义），
   * 防止残留的 streaming 守卫阻塞重新挂载后的自动重试。
   */
  invalidate(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
    const lesson = this.bridge.getLesson();
    if (lesson) {
      const normalized = normalizeTutorRuntimeForResume(lesson, this.now());
      if (normalized.lesson !== lesson) this.bridge.commitLesson(normalized.lesson);
    }
  }

  // ---- 内部 ----

  private now(): number {
    return this.bridge.now?.() ?? Date.now();
  }

  /** 队列派发：边界是唯一可回答时机；忙碌时不启动第二个请求（§3.3） */
  private dispatchQueued(): void {
    const lesson = this.bridge.getLesson();
    if (!lesson) return;
    if (this.bridge.getPhase() !== 'boundary') return;
    const next = pickAutoTutorQuestion(lesson, this.busy);
    if (!next) return;
    void this.startQuestion(next);
  }

  private buildRequestBody(
    question: UserQuestionItem,
    lesson: NodeLessonV2,
  ): InlineTutorRequestPayload {
    const planned = lesson.chapterPlan.tasks.find((task) => task.taskId === question.taskId);
    return buildInlineTutorContext({
      courseId: this.bridge.courseId,
      courseTopic: this.bridge.courseTopic,
      chapter: {
        title: this.bridge.chapterTitle,
        teachingGoal: this.bridge.chapterTeachingGoal,
      },
      task: {
        taskId: question.taskId,
        title: planned?.title ?? '',
        taskDescription: planned?.taskGoal ?? '',
      },
      lesson,
      questionId: question.questionId,
      question: question.text,
      idempotencyKey: buildTutorRequestIdempotencyKey(
        this.bridge.chapterId,
        lesson.chapterPlan.planVersion,
        question.taskId,
        question.questionId,
      ),
    });
  }

  /**
   * 发起单个问题的 Tutor 流式请求。
   * 竞态守卫：代际计数（invalidate/重入作废旧流）+ 忙闲标志（串行）；
   * 每个事件先过 courseId 守卫再归约（其余守卫在归约器内）。
   */
  private async startQuestion(question: UserQuestionItem): Promise<void> {
    if (this.busy) return;
    const lessonAtStart = this.bridge.getLesson();
    if (!lessonAtStart) return;

    this.busy = true;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    let response: Response;
    try {
      response = await this.bridge.fetchTutorStream(
        this.buildRequestBody(question, lessonAtStart),
        controller.signal,
      );
    } catch (error) {
      if (this.generation !== generation) return; // 已被 invalidate 或更新流程取代
      this.busy = false;
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      if (aborted) return; // 取消不删除已写入的问题；下一时机再派发
      this.failQuestionLocally(question, '网络连接失败，请检查网络后重试', 'NETWORK_ERROR');
      this.dispatchQueued();
      return;
    }

    if (this.generation !== generation) return;

    // 流未开始即失败（422 校验等）：错误体为 JSON
    if (!response.ok || !response.body) {
      let message = `答疑生成失败（${response.status}）`;
      let code: string | undefined;
      try {
        const errorBody = (await response.json()) as { message?: string; code?: string };
        if (errorBody.message) message = errorBody.message;
        code = errorBody.code;
      } catch {
        // 非 JSON 错误体，用通用文案
      }
      if (this.generation !== generation) return;
      this.busy = false;
      this.failQuestionLocally(question, message, code);
      this.dispatchQueued();
      return;
    }

    let sawTutorCompleted = false;
    let sawRequestError = false;
    try {
      for await (const event of parseLearningSseStream(response)) {
        if (this.generation !== generation) return;
        // courseId 守卫（裁决）：不匹配的事件在归约前丢弃，不污染当前课程
        if (event.courseId !== this.bridge.courseId) continue;
        if (event.type === 'tutor_completed') sawTutorCompleted = true;
        if (event.type === 'request_error') sawRequestError = true;
        const current = this.bridge.getLesson();
        if (!current) continue;
        const next = applyLearningSseEvent(current, event);
        if (next !== current) this.bridge.commitLesson(next);
        if (event.type === 'tutor_completed') {
          this.bridge.recordEngagement('tutor_answer_completed', question.taskId);
        }
        if (event.type === 'request_error') {
          this.bridge.recordEngagement('tutor_answer_failed', question.taskId);
        }
      }
    } catch (error) {
      if (this.generation !== generation) return;
      console.warn('[tutor-orchestration] Tutor 流读取中断:', error);
    }

    if (this.generation !== generation) return;
    this.busy = false;

    // 流结束但未收到终态事件（上游断流）：本地合成失败，
    // 同主任务流 STREAM_FAILED_LOCAL 模式，避免卡在 streaming 阻塞重试
    if (!sawTutorCompleted && !sawRequestError) {
      this.failQuestionLocally(question, '回答生成中断，请重试', 'STREAM_INTERRUPTED');
    }

    // 终态后：不推进主线、章节相位保持不变；队列仍有题且处于边界则继续处理下一题
    this.dispatchQueued();
  }

  /**
   * 传输层失败的本地合成：构造 request_error 复用归约器 Tutor 错误路径
   * （回答标记失败、问题保留、附幂等错误通知）。
   */
  private failQuestionLocally(question: UserQuestionItem, message: string, code?: string): void {
    const lesson = this.bridge.getLesson();
    if (!lesson) return;
    const pending = lesson.runtime.pendingRequest;
    // 在途请求存在时沿用其 requestId 以通过归约器的过期请求守卫
    const requestId =
      pending && pending.kind === 'tutor' ? pending.requestId : `req-local-${this.now().toString(36)}`;
    const synthetic: LearningSseEvent = {
      eventId: `local-tutor-${question.questionId}-${this.now()}`,
      requestId,
      type: 'request_error',
      courseId: this.bridge.courseId,
      chapterId: this.bridge.chapterId,
      taskId: question.taskId,
      questionId: question.questionId,
      planVersion: lesson.chapterPlan.planVersion,
      sequence: lesson.runtime.latestSequence + 1,
      timestamp: this.now(),
      payload: { code: code ?? 'LOCAL_ERROR', message, retryable: true },
    };
    const next = applyLearningSseEvent(lesson, synthetic);
    if (next !== lesson) this.bridge.commitLesson(next);
    this.bridge.recordEngagement('tutor_answer_failed', question.taskId);
  }
}
