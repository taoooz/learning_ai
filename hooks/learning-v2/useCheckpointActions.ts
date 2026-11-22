'use client';

// hooks/learning-v2/useCheckpointActions.ts
// P3a Checkpoint 编排：生成、提交判分、重试与补救。
// 独立于任务流/答疑流，不持有 AbortController，也不推进章节完成。

import { useCallback, useRef, useState } from 'react';
import type {
  CheckpointDefinition,
  CheckpointEvaluation,
  CheckpointItem,
  NodeLesson,
} from '@/types/learning-v2';
import type { ChapterLearningAction } from '@/lib/learning-v2/chapter-learning-state';
import {
  applyRemediation,
  needsCheckpoint,
} from '@/lib/learning-v2/checkpoint-ops';
import { appendSystemNotice } from '@/lib/learning-v2/reducers';
import { getLessonStoreMode, syncLearningAuthoritySnapshot } from '@/lib/learning-v2/lesson-repository';
import {
  CHECKPOINT_GENERATION_FAILED_MESSAGE,
  clearCheckpointGenerationNotice,
} from '@/lib/learning-v2/checkpoint-generation';

interface UseCheckpointActionsParams {
  courseId: string;
  chapterId: string;
  lessonMirrorRef: React.MutableRefObject<NodeLesson | null>;
  commit: (action: ChapterLearningAction) => void;
  persist: (lesson: NodeLesson) => Promise<void> | void;
}

function findCheckpoint(
  lesson: NodeLesson,
  checkpointId: string,
): CheckpointItem | undefined {
  return lesson.streamItems.find(
    (item): item is CheckpointItem =>
      item.type === 'checkpoint' &&
      item.checkpoint.checkpointId === checkpointId,
  );
}

export function useCheckpointActions({
  courseId,
  chapterId,
  lessonMirrorRef,
  commit,
  persist,
}: UseCheckpointActionsParams) {
  const generationInFlightRef = useRef(false);
  const [generatingCheckpointTaskId, setGeneratingCheckpointTaskId] = useState<string | null>(null);

  /** 任务完成后按需生成 Checkpoint；失败静默，不阻塞主线。 */
  const maybeGenerateCheckpoint = useCallback(
    async (taskId: string, retry = false) => {
      if (generationInFlightRef.current) return;
      const lesson = lessonMirrorRef.current;
      if (!lesson || !needsCheckpoint(lesson, taskId)) return;
      const planned = lesson.chapterPlan.tasks.find((task) => task.taskId === taskId);
      if (!planned) return;

      let currentLesson = lesson;
      generationInFlightRef.current = true;
      setGeneratingCheckpointTaskId(taskId);
      try {
        currentLesson = retry ? clearCheckpointGenerationNotice(lesson, taskId) : lesson;
        if (retry) commit({ type: 'LESSON_PATCH', lesson: currentLesson });
        // 服务端权威生成要求 completed task 与 task content 已落盘。
        await persist(currentLesson);
        if (getLessonStoreMode() === 'local') {
          const synced = await syncLearningAuthoritySnapshot(courseId, chapterId, currentLesson);
          if (!synced) throw new Error('服务端章节快照同步失败');
        }
        const response = await fetch('/api/learning/v2/checkpoints/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // 服务断线/上游挂起时 120s 强制失败，进入下方失败通知解锁章节
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({
            courseId,
            chapterId,
            taskId,
            idempotencyKey: `checkpoint-gen:${courseId}:${chapterId}:${currentLesson.chapterPlan.planId}:${currentLesson.chapterPlan.planVersion}:${taskId}${retry ? `:retry:${Date.now()}` : ''}`,
          }),
        });
        if (!response.ok) {
          commit({
            type: 'LESSON_PATCH',
            lesson: appendSystemNotice(
              currentLesson,
              {
                tone: 'warning',
                message: CHECKPOINT_GENERATION_FAILED_MESSAGE,
                code: 'CHECKPOINT_GENERATION_FAILED',
                taskId,
                retryable: true,
              },
              Date.now(),
            ),
          });
          return;
        }
        const body = await response.json();
        if (!body.ok || !body.checkpoint) {
          commit({
            type: 'LESSON_PATCH',
            lesson: appendSystemNotice(
              currentLesson,
              {
                tone: 'warning',
                message: CHECKPOINT_GENERATION_FAILED_MESSAGE,
                code: 'CHECKPOINT_GENERATION_FAILED',
                taskId,
                retryable: true,
              },
              Date.now(),
            ),
          });
          return;
        }
        commit({ type: 'CHECKPOINT_READY', checkpoint: body.checkpoint, now: Date.now() });
      } catch (error) {
        console.warn('[useCheckpointActions] Checkpoint 生成失败:', error);
        commit({
          type: 'LESSON_PATCH',
          lesson: appendSystemNotice(
            lessonMirrorRef.current ?? currentLesson,
            {
              tone: 'warning',
              message: CHECKPOINT_GENERATION_FAILED_MESSAGE,
              code: 'CHECKPOINT_GENERATION_FAILED',
              taskId,
              retryable: true,
            },
            Date.now(),
          ),
        });
      } finally {
        generationInFlightRef.current = false;
        setGeneratingCheckpointTaskId(null);
      }
    },
    [chapterId, commit, courseId, lessonMirrorRef, persist],
  );

  const retryCheckpointGeneration = useCallback(
    (taskId: string) => {
      void maybeGenerateCheckpoint(taskId, true);
    },
    [maybeGenerateCheckpoint],
  );

  /** 用户提交答案 → 服务端程序判分。 */
  const submitCheckpoint = useCallback(
    async (checkpointId: string, answer: string | string[]) => {
      const lesson = lessonMirrorRef.current;
      if (!lesson) return;
      const item = findCheckpoint(lesson, checkpointId);
      if (!item) return;
      const attempt = (item.submission?.attempt ?? 0) + 1;

      try {
        const response = await fetch('/api/learning/v2/checkpoints/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            checkpointId,
            answer,
            idempotencyKey: `checkpoint-eval:${courseId}:${chapterId}:${lesson.chapterPlan.planId}:${lesson.chapterPlan.planVersion}:${checkpointId}:${attempt}`,
          }),
        });
        if (!response.ok) return;
        const body = await response.json();
        if (!body.ok || !body.evaluation) return;
        const evaluation = body.evaluation as CheckpointEvaluation;
        commit({
          type: 'CHECKPOINT_EVALUATED',
          checkpointId,
          answer,
          evaluation,
          now: Date.now(),
        });
      } catch (error) {
        console.warn('[useCheckpointActions] Checkpoint 判分失败:', error);
      }
    },
    [chapterId, commit, courseId, lessonMirrorRef],
  );

  /** 清除评估结果，用原题重试。 */
  const retryCheckpoint = useCallback(
    (checkpointId: string) => {
      const lesson = lessonMirrorRef.current;
      if (!lesson) return;
      const item = findCheckpoint(lesson, checkpointId);
      if (!item) return;
      const updated: CheckpointItem = {
        ...item,
        submission: undefined,
        evaluation: undefined,
        status: 'pending',
      };
      const now = Date.now();
      commit({
        type: 'LESSON_PATCH',
        lesson: {
          ...lesson,
          streamItems: lesson.streamItems.map((streamItem) => (streamItem === item ? updated : streamItem)),
          runtime: { ...lesson.runtime, status: 'checking', lastActiveAt: now },
          updatedAt: now,
        },
      });
    },
    [commit, lessonMirrorRef],
  );

  /** 补救内容 + 等价新题；失败回退为原题重试。 */
  const requestRemediation = useCallback(
    async (checkpointId: string) => {
      const lesson = lessonMirrorRef.current;
      if (!lesson) return;
      const item = findCheckpoint(lesson, checkpointId);
      if (!item || !item.evaluation) return;
      try {
        const response = await fetch('/api/learning/v2/checkpoints/remediate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            checkpointId,
            userAnswer: item.submission?.answer ?? '',
            idempotencyKey: `remediate:${courseId}:${chapterId}:${lesson.chapterPlan.planVersion}:${checkpointId}:${item.remediationAttempt + 1}`,
          }),
        });
        if (!response.ok) return;
        const body = await response.json();
        if (!body.ok || !body.remediationContent || !body.newCheckpoint) return;

        const rawCheckpoint = body.newCheckpoint;
        const newDefinition: CheckpointDefinition = {
          ...rawCheckpoint,
          checkpointId: `${checkpointId}-r${item.remediationAttempt + 1}`,
          objectiveId: item.checkpoint.objectiveId,
          taskId: item.taskId,
          conceptKeys: item.checkpoint.conceptKeys,
          estimatedSeconds: 45,
          generationMeta: {
            promptVersion: 'remediate-v1',
            modelVersion: 'llm',
            generatedAt: Date.now(),
            durationMs: 0,
            degraded: false,
          },
        };
        commit({
          type: 'LESSON_PATCH',
          lesson: applyRemediation(
            lesson,
            checkpointId,
            body.remediationContent,
            newDefinition,
            Date.now(),
          ),
        });
      } catch (error) {
        console.warn('[useCheckpointActions] 补救内容生成失败:', error);
        retryCheckpoint(checkpointId);
      }
    },
    [chapterId, commit, courseId, lessonMirrorRef, retryCheckpoint],
  );

  return {
    maybeGenerateCheckpoint,
    retryCheckpointGeneration,
    generatingCheckpointTaskId,
    submitCheckpoint,
    retryCheckpoint,
    requestRemediation,
  };
}
