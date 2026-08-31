// tests/helpers/tutor-harness.ts
// Tutor 双流编排最小测试基座（Task 6）：
// 不依赖 React 运行时，直接驱动 lib/learning-v2/tutor-orchestration.ts 的编排层，
// 用假 SSE 流模拟主任务流与 Tutor 流，锁定双流隔离/排队/恢复等行为契约。
// 与 useChapterLearning.ts 的接线同构：
// - lesson/phase 由 harness 持有（对应 hook 的同步镜像）
// - fetchTutorStream 记录请求数与请求体（对应 hook 的真实 fetch）
// - 主任务流的取消入口（abortTaskStream）独立暴露——编排层永远不应触碰它

import {
  TutorStreamOrchestrator,
  deriveChapterPhase,
  type ChapterPhaseName,
  type TutorBridge,
} from '../../lib/learning-v2/tutor-orchestration';
import {
  appendUserQuestion,
  applyLearningSseEvent,
  createInitialNodeLessonV2,
} from '../../lib/learning-v2/reducers';
import type { InlineTutorRequestPayload } from '../../lib/learning-v2/tutor-context';
import type {
  ChapterPlan,
  GenerationMeta,
  LearningSseEvent,
  NodeLessonV2,
} from '../../types/learning-v2';

const encoder = new TextEncoder();

export const HARNESS_NOW = 1756700000000;

const META: GenerationMeta = { promptVersion: 'p1', modelVersion: 'm1', generatedAt: HARNESS_NOW };

// ---- 假 SSE 流：推送式交付，chunk 时机完全由测试控制，支持 abort ----

export class FakeTutorStream {
  private chunks: Uint8Array[] = [];
  private waiting: {
    resolve: (result: { done: boolean; value: Uint8Array | undefined }) => void;
    reject: (error: Error) => void;
  } | null = null;
  private closed = false;
  private error: Error | null = null;

  constructor(signal?: AbortSignal) {
    signal?.addEventListener('abort', () => {
      this.fail(new DOMException('The operation was aborted.', 'AbortError'));
    });
  }

  get aborted(): boolean {
    return this.error instanceof DOMException && this.error.name === 'AbortError';
  }

  emit(event: LearningSseEvent): void {
    this.push(`data: ${JSON.stringify(event)}\n\n`);
  }

  end(): void {
    if (this.closed || this.error) return;
    this.push('data: [DONE]\n\n');
    this.closed = true;
    this.wake();
  }

  fail(error: Error): void {
    if (this.closed || this.error) return;
    this.error = error;
    this.wake();
  }

  /** 与 sse-client 测试一致的 Response 替身形状（补 ok/status 供编排层判定） */
  response(): Response {
    const self = this;
    return {
      ok: true,
      status: 200,
      body: {
        getReader() {
          return {
            read(): Promise<{ done: boolean; value: Uint8Array | undefined }> {
              if (self.error) return Promise.reject(self.error);
              const chunk = self.chunks.shift();
              if (chunk) return Promise.resolve({ done: false, value: chunk });
              if (self.closed) return Promise.resolve({ done: true, value: undefined });
              return new Promise((resolve, reject) => {
                self.waiting = { resolve, reject };
              });
            },
            releaseLock() {},
          };
        },
      },
    } as unknown as Response;
  }

  private push(text: string): void {
    if (this.closed || this.error) return;
    this.chunks.push(encoder.encode(text));
    this.wake();
  }

  private wake(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    this.waiting = null;
    if (this.error) {
      waiting.reject(this.error);
      return;
    }
    const chunk = this.chunks.shift();
    if (chunk) {
      waiting.resolve({ done: false, value: chunk });
      return;
    }
    if (this.closed) {
      waiting.resolve({ done: true, value: undefined });
      return;
    }
    this.waiting = waiting; // 暂时无货可交，继续等待
  }
}

// ---- 夹具：两任务计划 ----

function makePlan(chapterId: string): ChapterPlan {
  return {
    chapterId,
    planId: 'plan-h',
    planVersion: 1,
    objectiveIds: ['obj-1'],
    tasks: [
      {
        taskId: 'task-1',
        order: 0,
        title: '认识 ETag',
        objectiveId: 'obj-1',
        taskGoal: '理解 ETag 协商缓存',
        observableOutcome: '能解释 ETag 的校验原理',
        conceptKeys: ['ETag'],
        prerequisiteTaskIds: [],
        teachingPattern: 'explain',
        expectedMinutes: 5,
        evidencePolicy: 'none',
        origin: 'initial',
        status: 'planned',
      },
      {
        taskId: 'task-2',
        order: 1,
        title: 'Cache-Control',
        objectiveId: 'obj-1',
        taskGoal: '理解强缓存指令',
        observableOutcome: '能选择合适的缓存策略',
        conceptKeys: ['Cache-Control'],
        prerequisiteTaskIds: ['task-1'],
        teachingPattern: 'explain',
        expectedMinutes: 5,
        evidencePolicy: 'none',
        origin: 'initial',
        status: 'planned',
      },
    ],
    status: 'active',
    createdAt: HARNESS_NOW,
    updatedAt: HARNESS_NOW,
    generationMeta: META,
  };
}

export interface ChapterLearningHarnessOptions {
  /** 初始相位：streaming = 任务1流式中；boundary = 任务1完成后停在边界；默认 boundary */
  phase?: 'streaming' | 'boundary';
  /** 直接指定容器（刷新恢复夹具）；指定时忽略 phase，相位从容器推导 */
  lesson?: NodeLessonV2;
  courseId?: string;
  chapterId?: string;
  /**
   * 投喂事件的章节 id（Task 8）：默认等于 chapterId；
   * 指定不同值时模拟「旧章节残留流事件混入新章节」，事件须被章节守卫丢弃。
   */
  tutorEventChapterId?: string;
  /**
   * 预置一个已失败的指定 questionId（Task 8）：容器构造时同步入流问题并经真实
   * 归约器落为失败态（问题保留、回答失败），供「局部重试」用例直接起跳。
   */
  failedQuestionId?: string;
}

export function createChapterLearningHarness(options: ChapterLearningHarnessOptions = {}) {
  const courseId = options.courseId ?? 'course-1';
  const chapterId = options.chapterId ?? 'ch-1';
  const tutorEventChapterId = options.tutorEventChapterId ?? chapterId;

  let lesson: NodeLessonV2;
  let phase: ChapterPhaseName;
  let taskAbortCount = 0;
  let tutorRequests = 0;
  let questionCounter = 0;
  let sequenceCounter = 10;
  let lastQuestionId: string | null = null;
  let nextFetchFailure:
    | { kind: 'status'; status: number; body?: unknown }
    | { kind: 'network' }
    | null = null;
  // 请求挂起闸（Task 8 代际竞态用例）：holdNextTutorFetch 后下一次请求在 release 前不返回
  let fetchGate: Promise<void> | null = null;

  const tutorBodies: InlineTutorRequestPayload[] = [];
  const streams: FakeTutorStream[] = [];
  const engagements: Array<{ eventType: string; taskId?: string }> = [];
  const immediatePersists: NodeLessonV2[] = [];

  function nextSequence(): number {
    sequenceCounter += 1;
    return sequenceCounter;
  }

  if (options.lesson) {
    lesson = options.lesson;
    phase = deriveChapterPhase(lesson, 'generating');
  } else {
    lesson = createInitialNodeLessonV2(chapterId, makePlan(chapterId), HARNESS_NOW);
    // 真实时序：task_started 先把章节推进到 learning，task_completed 才能转到 awaiting_user
    lesson = applyLearningSseEvent(lesson, {
      eventId: 'evt-h-task-started',
      requestId: 'req-task-1',
      type: 'task_started',
      courseId,
      chapterId,
      taskId: 'task-1',
      planVersion: lesson.chapterPlan.planVersion,
      sequence: nextSequence(),
      timestamp: HARNESS_NOW + 1,
      payload: { taskId: 'task-1', title: '认识 ETag' },
    });
    if (options.phase !== 'streaming') {
      lesson = applyLearningSseEvent(lesson, {
        eventId: 'evt-h-task-completed',
        requestId: 'req-task-1',
        type: 'task_completed',
        courseId,
        chapterId,
        taskId: 'task-1',
        planVersion: lesson.chapterPlan.planVersion,
        sequence: nextSequence(),
        timestamp: HARNESS_NOW + 2,
        payload: {
          task: {
            taskId: 'task-1',
            planVersion: lesson.chapterPlan.planVersion,
            title: '认识 ETag',
            blocks: [{ type: 'markdown', blockId: 'b1', markdown: 'ETag 是资源的版本指纹。' }],
            boundaryPrompt: { takeaway: 'ETag 是版本指纹' },
            generationMeta: META,
          },
        },
      });
    }
    if (options.failedQuestionId) {
      // 预置失败问题（Task 8）：真实时序入流后经 request_error 落为失败态，
      // 问题保留可重试——「局部重试不改变任务内容和 completedTaskIds」用例的起跳点
      const questionId = options.failedQuestionId;
      lesson = appendUserQuestion(
        lesson,
        { taskId: 'task-1', questionId, text: '304 为什么没有正文？' },
        HARNESS_NOW + 3,
      );
      lesson = applyLearningSseEvent(lesson, {
        eventId: `evt-h-failed-${questionId}`,
        requestId: `req-${questionId}`,
        type: 'request_error',
        courseId,
        chapterId,
        taskId: 'task-1',
        questionId,
        planVersion: lesson.chapterPlan.planVersion,
        sequence: nextSequence(),
        timestamp: HARNESS_NOW + 4,
        payload: { code: 'E_LLM', message: '回答生成失败，请稍后重试', retryable: true },
      });
    }
    phase = deriveChapterPhase(lesson, 'generating');
  }

  const bridge: TutorBridge = {
    courseId,
    chapterId,
    courseTopic: 'HTTP 缓存',
    chapterTitle: '验证策略',
    chapterTeachingGoal: '理解强缓存与协商缓存',
    getLesson: () => lesson,
    getPhase: () => phase,
    commitLesson: (next, opts) => {
      lesson = next;
      phase = deriveChapterPhase(next, phase);
      if (opts?.persistNow) immediatePersists.push(next);
    },
    fetchTutorStream: async (body, signal) => {
      tutorRequests += 1;
      tutorBodies.push(body);
      const gate = fetchGate;
      fetchGate = null;
      if (gate) await gate;
      const failure = nextFetchFailure;
      nextFetchFailure = null;
      if (failure?.kind === 'network') {
        throw new TypeError('Failed to fetch');
      }
      if (failure?.kind === 'status') {
        return {
          ok: false,
          status: failure.status,
          body: null,
          json: async () => failure.body ?? {},
        } as unknown as Response;
      }
      const stream = new FakeTutorStream(signal);
      streams.push(stream);
      return stream.response();
    },
    recordEngagement: (eventType, taskId) => {
      engagements.push({ eventType, taskId });
    },
  };

  const orchestrator = new TutorStreamOrchestrator(bridge);

  // ---- 主任务流侧 ----

  function emitTaskCompleted(taskId = 'task-1'): void {
    const sequence = nextSequence();
    lesson = applyLearningSseEvent(lesson, {
      eventId: `evt-h-task-completed-${sequence}`,
      requestId: 'req-task-1',
      type: 'task_completed',
      courseId,
      chapterId,
      taskId,
      planVersion: lesson.chapterPlan.planVersion,
      sequence,
      timestamp: HARNESS_NOW + sequence,
      payload: {
        task: {
          taskId,
          planVersion: lesson.chapterPlan.planVersion,
          title: '认识 ETag',
          blocks: [{ type: 'markdown', blockId: 'b1', markdown: 'ETag 是资源的版本指纹。' }],
          boundaryPrompt: { takeaway: 'ETag 是版本指纹' },
          generationMeta: META,
        },
      },
    });
    phase = deriveChapterPhase(lesson, phase);
    orchestrator.notifyTaskCompleted();
  }

  /** 主任务流的取消入口：Tutor 编排层永远不应触碰（隔离契约绊线） */
  function abortTaskStream(): void {
    taskAbortCount += 1;
  }

  // ---- Tutor 流侧 ----

  function submitTutorQuestion(text: string): string | null {
    questionCounter += 1;
    const questionId = `q-h-${questionCounter}`;
    const decision = orchestrator.submitQuestion(text, questionId, HARNESS_NOW + 100 + questionCounter);
    if (!decision) return null;
    lastQuestionId = questionId;
    return questionId;
  }

  function currentStream(): FakeTutorStream {
    const stream = streams[streams.length - 1];
    if (!stream) throw new Error('尚无 Tutor 请求，无法注入事件');
    return stream;
  }

  function currentBody(): InlineTutorRequestPayload {
    const body = tutorBodies[tutorBodies.length - 1];
    if (!body) throw new Error('尚无 Tutor 请求体');
    return body;
  }

  function currentRequestId(): string {
    return `req-h-${streams.length}`;
  }

  function makeTutorStreamEvent(
    type: LearningSseEvent['type'],
    payload: unknown,
    overrides: Partial<LearningSseEvent> = {},
  ): LearningSseEvent {
    const body = currentBody();
    const sequence = nextSequence();
    return {
      eventId: `evt-h-${sequence}`,
      requestId: currentRequestId(),
      type,
      courseId,
      chapterId: tutorEventChapterId,
      taskId: body.task.taskId,
      questionId: body.question.questionId,
      planVersion: lesson.chapterPlan.planVersion,
      sequence,
      timestamp: HARNESS_NOW + sequence,
      payload,
      ...overrides,
    };
  }

  /** 等待编排层的异步消费落地（fetch/流读取都是微任务级） */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  async function emitTutorStarted(): Promise<void> {
    const body = currentBody();
    currentStream().emit(
      makeTutorStreamEvent('tutor_started', { questionId: body.question.questionId }),
    );
    await settle();
  }

  async function emitTutorDelta(delta: string): Promise<void> {
    currentStream().emit(makeTutorStreamEvent('tutor_block_delta', { blockId: 'tb1', delta }));
    await settle();
  }

  async function emitTutorCompleted(markdown = '定稿的完整回答'): Promise<void> {
    const body = currentBody();
    // 先补 started 建立 pendingRequest（幂等：已 started 的流重投无副作用）
    currentStream().emit(
      makeTutorStreamEvent('tutor_started', { questionId: body.question.questionId }),
    );
    currentStream().emit(
      makeTutorStreamEvent('tutor_completed', {
        questionId: body.question.questionId,
        blocks: [{ type: 'markdown', blockId: 'tb1', markdown }],
      }),
    );
    currentStream().end();
    await settle();
  }

  async function emitTutorError(
    code = 'E_LLM',
    message = '回答生成失败，请稍后重试',
  ): Promise<void> {
    const body = currentBody();
    const stream = currentStream();
    stream.emit(makeTutorStreamEvent('tutor_started', { questionId: body.question.questionId }));
    stream.emit(makeTutorStreamEvent('request_error', { code, message, retryable: true }));
    stream.end();
    await settle();
  }

  /** 注入携带其他 courseId 的事件（旧课程/错投守卫测试用） */
  async function emitForeignTutorEvent(overrides: Partial<LearningSseEvent>): Promise<void> {
    currentStream().emit(
      makeTutorStreamEvent(
        overrides.type ?? 'tutor_block_delta',
        overrides.payload ?? { blockId: 'tb1', delta: '来自其他课程的内容' },
        { courseId: 'course-other', ...overrides },
      ),
    );
    await settle();
  }

  /** 主动结束当前流（不补终态事件，用于本地合成失败测试） */
  async function endActiveStream(): Promise<void> {
    currentStream().end();
    await settle();
  }

  function failNextTutorFetch(status: number, body?: unknown): void {
    nextFetchFailure = { kind: 'status', status, body };
  }

  function failNextTutorFetchWithNetworkError(): void {
    nextFetchFailure = { kind: 'network' };
  }

  /** 挂起下一次 Tutor 请求（返回放行函数）：模拟卸载时响应仍在途的代际竞态 */
  function holdNextTutorFetch(): () => void {
    let release!: () => void;
    fetchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  /** 主动令当前流读取抛错（非终态断流）：编排层应本地合成失败而不触碰主任务 */
  async function failActiveStream(error: Error): Promise<void> {
    currentStream().fail(error);
    await settle();
  }

  /** 主任务流侧的失败事件（不带 questionId，走主任务错误归约路径） */
  function emitTaskError(code = 'STREAM_INTERRUPTED', message = '内容生成中断，请重新生成本节'): void {
    const sequence = nextSequence();
    lesson = applyLearningSseEvent(lesson, {
      eventId: `evt-h-task-error-${sequence}`,
      requestId: 'req-task-1',
      type: 'request_error',
      courseId,
      chapterId,
      taskId: lesson.runtime.currentTaskId ?? 'task-1',
      planVersion: lesson.chapterPlan.planVersion,
      sequence,
      timestamp: HARNESS_NOW + sequence,
      payload: { code, message, retryable: true },
    });
    phase = deriveChapterPhase(lesson, phase);
  }

  return {
    orchestrator,
    get lesson() {
      return lesson;
    },
    get phase() {
      return phase;
    },
    get taskAbortCount() {
      return taskAbortCount;
    },
    get tutorRequests() {
      return tutorRequests;
    },
    get tutorBodies() {
      return tutorBodies;
    },
    get engagements() {
      return engagements;
    },
    get immediatePersists() {
      return immediatePersists;
    },
    get lastQuestionId() {
      return lastQuestionId;
    },
    /** 当前所有 Tutor 回答块拼出的文本（未建流/被守卫丢弃时为空串） */
    get currentAnswerText(): string {
      return lesson.streamItems
        .flatMap((item) => (item.type === 'tutor_answer' ? item.blocks : []))
        .map((block) => block.markdown)
        .join('');
    },
    submitTutorQuestion,
    emitTaskCompleted,
    emitTaskError,
    abortTaskStream,
    emitTutorStarted,
    emitTutorDelta,
    emitTutorCompleted,
    emitTutorError,
    emitForeignTutorEvent,
    endActiveStream,
    failActiveStream,
    failNextTutorFetch,
    failNextTutorFetchWithNetworkError,
    holdNextTutorFetch,
    settle,
    retryTutor: (questionId: string): boolean => orchestrator.retry(questionId),
    resumeFromBoot: (shouldAutoRetry: boolean): void => orchestrator.resumeFromBoot(shouldAutoRetry),
    invalidate: (): void => orchestrator.invalidate(),
  };
}

/** 与简报一致的入口别名 */
export const createTutorHarness = createChapterLearningHarness;
