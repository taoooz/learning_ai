'use client';

// hooks/learning-v2/usePlanSuggestion.ts
// P4 动态调度：基于证据请求计划补丁建议，并处理用户接受/忽略。
// 只在边界触发；不可应用或低价值建议不进入 UI。

import { useCallback, useRef, useState } from 'react';
import type {
  ChapterPlanPatch,
  CourseBlueprint,
  NodeLesson,
} from '@/types/learning-v2';
import { MAX_PLAN_PATCHES_PER_CHAPTER } from '@/types/learning-v2';
import { collectEvidence } from '@/lib/learning-v2/checkpoint-ops';
import { applyPlanPatch, canApplyPatch } from '@/lib/learning-v2/plan-patch';
import type { ChapterLearningAction, ChapterPhase } from '@/lib/learning-v2/chapter-learning-state';

interface UsePlanSuggestionParams {
  courseId: string;
  chapterId: string;
  blueprint: CourseBlueprint;
  lessonMirrorRef: React.MutableRefObject<NodeLesson | null>;
  phaseMirrorRef: React.MutableRefObject<ChapterPhase>;
  commit: (action: ChapterLearningAction) => void;
}

export function usePlanSuggestion({
  courseId,
  chapterId,
  blueprint,
  lessonMirrorRef,
  phaseMirrorRef,
  commit,
}: UsePlanSuggestionParams) {
  const [planSuggestion, setPlanSuggestion] = useState<ChapterPlanPatch | null>(null);
  const busyRef = useRef(false);

  const requestPlanSuggestion = useCallback(async () => {
    const lesson = lessonMirrorRef.current;
    if (!lesson || phaseMirrorRef.current !== 'boundary') return;
    if (busyRef.current) return;
    if ((lesson.chapterPlan.appliedPatchCount ?? 0) >= MAX_PLAN_PATCHES_PER_CHAPTER) return;

    busyRef.current = true;
    try {
      const evidence = collectEvidence(lesson);
      if (evidence.length === 0) return;

      const chapter = blueprint.chapters.find((item) => item.chapterId === chapterId);
      const remainingTasks = lesson.chapterPlan.tasks
        .filter((task) => (
          !lesson.runtime.completedTaskIds.includes(task.taskId) &&
          !lesson.runtime.skippedTaskIds.includes(task.taskId) &&
          task.taskId !== lesson.runtime.currentTaskId
        ))
        .map((task) => ({
          taskId: task.taskId,
          title: task.title,
          taskGoal: task.taskGoal,
          teachingPattern: task.teachingPattern,
        }));
      if (remainingTasks.length === 0) return;

      const response = await fetch('/api/learning/v2/plan-patch/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          chapterId,
          planVersion: lesson.chapterPlan.planVersion,
          courseTopic: blueprint.topic,
          chapterTitle: chapter?.title ?? '',
          teachingGoal: chapter?.teachingGoal ?? '',
          remainingTasks,
          evidenceSummary: evidence.map((item) => ({
            objectiveId: item.objectiveId,
            outcome: item.outcome,
            score: item.score,
          })),
          idempotencyKey: `plan-patch:${courseId}:${chapterId}:${lesson.chapterPlan.planVersion}`,
        }),
      });
      if (!response.ok) return;

      const body = await response.json();
      const patch: ChapterPlanPatch | undefined = body.patch;
      if (!body.ok || !patch || !patch.operations || patch.operations.length === 0) return;
      // 客户端预校验：不可应用的建议不打扰用户。
      if (!canApplyPatch(lesson, patch).ok) return;
      setPlanSuggestion(patch);
    } catch (error) {
      console.warn('[usePlanSuggestion] 调度建议获取失败:', error);
    } finally {
      busyRef.current = false;
    }
  }, [blueprint, chapterId, courseId, lessonMirrorRef, phaseMirrorRef]);

  const acceptPlanSuggestion = useCallback(() => {
    const lesson = lessonMirrorRef.current;
    if (!lesson || !planSuggestion) return;
    if (!canApplyPatch(lesson, planSuggestion).ok) {
      setPlanSuggestion(null);
      return;
    }
    commit({
      type: 'LESSON_PATCH',
      lesson: applyPlanPatch(lesson, planSuggestion, Date.now()),
    });
    setPlanSuggestion(null);
  }, [commit, lessonMirrorRef, planSuggestion]);

  const dismissPlanSuggestion = useCallback(() => {
    setPlanSuggestion(null);
  }, []);

  return {
    planSuggestion,
    requestPlanSuggestion,
    acceptPlanSuggestion,
    dismissPlanSuggestion,
  };
}
