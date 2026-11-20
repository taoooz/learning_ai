'use client';

// hooks/learning-v2/useChapterCompletion.ts
// 章节收尾编排：completing → Recap 生成/兜底 → completed → 落盘并刷新课程树。
// 不处理任务流与检查点；完成状态机仍由 chapter-learning-state 归约。

import { useCallback } from 'react';
import type { ChapterRecap, CourseBlueprintV2, NodeLessonV2 } from '@/types/learning-v2';
import { applyChapterRecap } from '@/lib/learning-v2/reducers';
import { transitionChapter } from '@/lib/learning-v2/state-machine';
import { buildChapterCompleteIdempotencyKey, IdempotencyRegistry } from '@/lib/learning-v2/idempotency';
import { parseLearningSseStream } from '@/lib/learning-v2/sse-client';
import { completeChapterV2 } from '@/lib/learning-v2/chapter-complete';
import { buildLocalFallbackRecap } from '@/lib/learning-v2/recap';
import { recordEngagementEvent } from '@/lib/learning-v2/engagement';
import type { ChapterLearningAction } from '@/lib/learning-v2/chapter-learning-state';

interface UseChapterCompletionParams {
  courseId: string;
  chapterId: string;
  blueprint: CourseBlueprintV2;
  lessonMirrorRef: React.MutableRefObject<NodeLessonV2 | null>;
  generationRef: React.MutableRefObject<number>;
  recapRegistryRef: React.MutableRefObject<IdempotencyRegistry<ChapterRecap>>;
  commit: (action: ChapterLearningAction) => void;
  persist: (lesson: NodeLessonV2, immediate?: boolean) => Promise<void> | void;
}

async function requestChapterRecap(
  params: UseChapterCompletionParams,
  workingLesson: NodeLessonV2,
): Promise<ChapterRecap> {
  const { courseId, chapterId, blueprint, recapRegistryRef, commit } = params;
  const idempotencyKey = buildChapterCompleteIdempotencyKey(
    courseId,
    chapterId,
    workingLesson.chapterPlan.planId,
    workingLesson.chapterPlan.planVersion,
  );

  return recapRegistryRef.current.run(idempotencyKey, async () => {
    const chapterIndex = blueprint.chapters.findIndex((item) => item.chapterId === chapterId);
    const chapter = blueprint.chapters[chapterIndex];
    const nextChapter = blueprint.chapters[chapterIndex + 1];
    const sortedTasks = [...workingLesson.chapterPlan.tasks].sort((a, b) => a.order - b.order);
    const tasks = sortedTasks
      .filter((task) => workingLesson.runtime.completedTaskIds.includes(task.taskId))
      .map((task) => {
        const item = workingLesson.streamItems.find(
          (streamItem) => streamItem.type === 'task_content' && streamItem.taskId === task.taskId,
        );
        return {
          title: task.title,
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

    if (!response.ok || !response.body) {
      const errorBody = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(errorBody?.message ?? `小结生成失败（${response.status}）`);
    }

    let completedRecap: ChapterRecap | undefined;
    let sawCompleted = false;
    for await (const event of parseLearningSseStream(response)) {
      if (event.type === 'request_error') {
        const payload = event.payload as { message?: string };
        throw new Error(payload.message ?? '小结生成中断，请重试');
      }
      if (event.type === 'recap_started' || event.type === 'recap_takeaway') {
        commit({ type: 'SSE_EVENT', event });
      }
      if (event.type === 'recap_completed') {
        completedRecap = (event.payload as { recap: ChapterRecap }).recap;
        commit({ type: 'SSE_EVENT', event });
        sawCompleted = true;
      }
    }
    if (!sawCompleted || !completedRecap) throw new Error('小结生成中断，请重试');
    return completedRecap;
  });
}

export function useChapterCompletion(params: UseChapterCompletionParams) {
  const { courseId, chapterId, blueprint, lessonMirrorRef, generationRef, commit, persist } = params;

  const finishChapter = useCallback(async () => {
    const lesson = lessonMirrorRef.current;
    if (!lesson) return;
    const generation = generationRef.current;
    const now = Date.now();

    // 进入 completing；允许从 completing 恢复重入（刷新恢复分支②-bis）。
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

    // LLM 小结失败走本地兜底，不让用户卡在 completing。
    let recap: ChapterRecap;
    try {
      recap = await requestChapterRecap(params, workingLesson);
    } catch {
      recap = buildLocalFallbackRecap(workingLesson);
    }
    if (generationRef.current !== generation) return;

    const recapAt = Date.now();
    const recappedLesson = applyChapterRecap(workingLesson, recap, recapAt);
    const toCompleted = transitionChapter(recappedLesson.runtime, 'completed', recapAt);
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
      ...recappedLesson,
      runtime: { ...toCompleted.runtime, pendingRequest: undefined },
      updatedAt: recapAt,
    };

    await persist(completedLesson);

    void fetch('/api/user/memory/chapter-episode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        courseId,
        chapterId,
      }),
    }).catch(() => {
      // 章节经验入库失败不阻塞完成与解锁
    });

    void completeChapterV2(courseId, chapterId);
    recordEngagementEvent(courseId, { eventType: 'recap_completed', chapterId });
    recordEngagementEvent(courseId, { eventType: 'chapter_completed', chapterId });
    commit({ type: 'COMPLETED', lesson: completedLesson });
  }, [chapterId, commit, courseId, generationRef, lessonMirrorRef, params, persist]);

  return { finishChapter };
}
