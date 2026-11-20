// lib/learning-v2/chapter-learning-state.ts
// 章节学习 Hook 的纯状态层：action、reducer、同步镜像和启动相位推导。
// 保持纯函数，不发起请求、不读写存储；请求编排仍留在 useChapterLearning。

import type {
  CheckpointDefinition,
  CheckpointEvaluation,
  LearningSseEvent,
  NodeLessonV2,
} from '@/types/learning-v2';
import {
  appendSystemNotice,
  applyLearningSseEvent,
} from '@/lib/learning-v2/reducers';
import { transitionTask } from '@/lib/learning-v2/state-machine';
import type { ResumeAction } from '@/lib/learning-v2/resume';
import {
  applyCheckpointEvaluation,
  upsertCheckpointItem,
} from '@/lib/learning-v2/checkpoint-ops';
import {
  deriveChapterPhase,
  type ChapterPhaseName,
} from '@/lib/learning-v2/tutor-orchestration';

/** 章节相位（与编排层 ChapterPhaseName 同源） */
export type ChapterPhase = ChapterPhaseName;

export interface ChapterLearningState {
  lesson: NodeLessonV2 | null;
  phase: ChapterPhase;
  planError: string | null;
}

export type ChapterLearningAction =
  | { type: 'PLANNING' }
  | { type: 'PLAN_READY'; lesson: NodeLessonV2 }
  | { type: 'PLAN_FAILED'; message: string }
  | { type: 'TASK_STARTING'; taskId: string; now: number }
  | { type: 'SSE_EVENT'; event: LearningSseEvent }
  | { type: 'STREAM_FAILED_LOCAL'; message: string; code?: string; now: number }
  | { type: 'CHAPTER_COMPLETING'; lesson: NodeLessonV2 }
  | { type: 'COMPLETED'; lesson: NodeLessonV2 }
  | { type: 'LESSON_PATCH'; lesson: NodeLessonV2 }
  | { type: 'CHECKPOINT_READY'; checkpoint: CheckpointDefinition; now: number }
  | { type: 'CHECKPOINT_EVALUATED'; checkpointId: string; answer: string | string[]; evaluation: CheckpointEvaluation; now: number }
  | { type: 'BOOT_READY'; lesson: NodeLessonV2 | null; phase: ChapterPhase };

/** 启动决策 → 初始容器/相位（local 同步启动与 server 异步启动共用） */
export function bootStateFor(
  lesson: NodeLessonV2 | null,
  action: ResumeAction,
): { lesson: NodeLessonV2 | null; phase: ChapterPhase } {
  switch (action.kind) {
    case 'generate_plan':
      return { lesson: null, phase: 'planning' };
    case 'render_completed':
      return { lesson, phase: 'completed' };
    case 'render_boundary':
      return { lesson, phase: 'boundary' };
    case 'start_task':
      return { lesson, phase: 'generating' };
  }
}

function lessonAfterTaskStarting(lesson: NodeLessonV2, taskId: string, now: number): NodeLessonV2 {
  const transitioned = transitionTask(lesson.runtime, 'generating', now);
  const runtime = transitioned.ok
    ? transitioned.runtime
    : { ...lesson.runtime, currentTaskStatus: 'generating' as const, lastActiveAt: now };
  return { ...lesson, runtime: { ...runtime, currentTaskId: taskId }, updatedAt: now };
}

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
  return appendSystemNotice(
    { ...lesson, runtime },
    {
      tone: 'error',
      message,
      code,
      taskId: runtime.currentTaskId ?? undefined,
      retryable: true,
    },
    now,
  );
}

export function chapterLearningReducer(
  state: ChapterLearningState,
  action: ChapterLearningAction,
): ChapterLearningState {
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
      return { ...state, lesson: action.lesson, phase: 'completing' };
    case 'COMPLETED':
      return { lesson: action.lesson, phase: 'completed', planError: null };
    case 'LESSON_PATCH':
      return { ...state, lesson: action.lesson, phase: deriveChapterPhase(action.lesson, state.phase) };
    case 'BOOT_READY':
      return { lesson: action.lesson, phase: action.phase, planError: null };
    case 'CHECKPOINT_READY': {
      if (!state.lesson) return state;
      const lesson = upsertCheckpointItem(state.lesson, action.checkpoint, action.now);
      return { ...state, lesson, phase: deriveChapterPhase(lesson, state.phase) };
    }
    case 'CHECKPOINT_EVALUATED': {
      if (!state.lesson) return state;
      const lesson = applyCheckpointEvaluation(
        state.lesson, action.checkpointId, action.answer, action.evaluation, action.now,
      );
      return { ...state, lesson, phase: deriveChapterPhase(lesson, state.phase) };
    }
    default:
      return state;
  }
}

/**
 * 容器同步镜像：与 reducer 的容器归约完全一致。
 * React dispatch 批处理后，请求编排层需要立即读取最新 lesson，因此使用该镜像。
 */
export function mirrorLesson(
  current: NodeLessonV2 | null,
  action: ChapterLearningAction,
): NodeLessonV2 | null {
  switch (action.type) {
    case 'PLAN_READY':
    case 'CHAPTER_COMPLETING':
    case 'COMPLETED':
    case 'LESSON_PATCH':
    case 'BOOT_READY':
      return action.lesson;
    case 'TASK_STARTING':
      return current ? lessonAfterTaskStarting(current, action.taskId, action.now) : current;
    case 'SSE_EVENT':
      return current ? applyLearningSseEvent(current, action.event) : current;
    case 'STREAM_FAILED_LOCAL':
      return current ? lessonAfterStreamFailure(current, action.message, action.code, action.now) : current;
    case 'CHECKPOINT_READY':
      return current ? upsertCheckpointItem(current, action.checkpoint, action.now) : current;
    case 'CHECKPOINT_EVALUATED':
      return current
        ? applyCheckpointEvaluation(current, action.checkpointId, action.answer, action.evaluation, action.now)
        : current;
    default:
      return current;
  }
}

/** 相位同步镜像：与 reducer 各分支的相位推导一致 */
export function mirrorPhase(
  action: ChapterLearningAction,
  lesson: NodeLessonV2 | null,
  prev: ChapterPhase,
): ChapterPhase {
  switch (action.type) {
    case 'PLANNING':
      return 'planning';
    case 'PLAN_READY':
    case 'TASK_STARTING':
      return 'generating';
    case 'PLAN_FAILED':
      return 'plan_failed';
    case 'STREAM_FAILED_LOCAL':
      return 'boundary';
    case 'CHAPTER_COMPLETING':
      return 'completing';
    case 'COMPLETED':
      return 'completed';
    case 'SSE_EVENT':
    case 'LESSON_PATCH':
      return lesson ? deriveChapterPhase(lesson, prev) : prev;
    case 'BOOT_READY':
      return action.phase;
    default:
      return prev;
  }
}
