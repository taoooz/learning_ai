// lib/learning-v2/teaching-state.ts
// 课程级教学状态的确定性维护：不调用 LLM，不写用户 Memory。

import type {
  CourseTeachingState,
  PendingTeachingArtifact,
  TeachingInsight,
} from '@/types/learning-v2';
import type { NodeLesson, StoredCourse } from '@/types/learning-v2';

export function createCourseTeachingState(now = Date.now()): CourseTeachingState {
  return {
    pendingArtifacts: [],
    insights: [],
    notes: [],
    updatedAt: now,
  };
}

function upsert<T>(
  list: T[],
  predicate: (item: T) => boolean,
  value: T,
): T[] {
  return [...list.filter((item) => !predicate(item)), value];
}

export function setTeachingChapter(
  state: CourseTeachingState | undefined,
  chapterId: string,
  now = Date.now(),
): CourseTeachingState {
  const base = state ?? createCourseTeachingState(now);
  return {
    ...base,
    currentChapterId: chapterId,
    updatedAt: now,
  };
}

export function addPendingArtifact(
  state: CourseTeachingState | undefined,
  artifact: Omit<PendingTeachingArtifact, 'createdAt'>,
  now = Date.now(),
): CourseTeachingState {
  const base = state ?? createCourseTeachingState(now);
  const next: PendingTeachingArtifact = { ...artifact, createdAt: now };
  return {
    ...base,
    pendingArtifacts: upsert(
      base.pendingArtifacts,
      (artifact) => artifact.kind === next.kind && artifact.chapterId === next.chapterId,
      next,
    ),
    updatedAt: now,
  };
}

export function resolvePendingArtifact(
  state: CourseTeachingState | undefined,
  kind: PendingTeachingArtifact['kind'],
  chapterId?: string,
  now = Date.now(),
): CourseTeachingState {
  const base = state ?? createCourseTeachingState(now);
  return {
    ...base,
    pendingArtifacts: base.pendingArtifacts.filter(
      (artifact) => artifact.kind !== kind || artifact.chapterId !== chapterId,
    ),
    updatedAt: now,
  };
}

export function addTeachingInsight(
  state: CourseTeachingState | undefined,
  insight: Omit<TeachingInsight, 'insightId' | 'createdAt'>,
  now = Date.now(),
): CourseTeachingState {
  const base = state ?? createCourseTeachingState(now);
  const insightId = `ins-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    ...base,
    insights: [...base.insights, { ...insight, insightId, createdAt: now }].slice(-20),
    updatedAt: now,
  };
}

export function markTeachingInsightUsed(
  state: CourseTeachingState | undefined,
  insightId: string,
  now = Date.now(),
): CourseTeachingState {
  const base = state ?? createCourseTeachingState(now);
  return {
    ...base,
    insights: base.insights.map((insight) =>
      insight.insightId === insightId
        ? { ...insight, status: 'used' as const }
        : insight,
    ),
    updatedAt: now,
  };
}

/**
 * 章节完成后更新课程教学状态。
 * 当前是确定性规则：
 * - currentChapterId 指向下一章；
 * - 若有检查点证据，清除该章 pending checkpoint；
 * - 记录下一章继续前置的章节素材。
 */
export function updateTeachingStateAfterChapter(
  course: StoredCourse,
  lesson: NodeLesson,
  now = Date.now(),
): CourseTeachingState {
  const state = course.teachingState ?? createCourseTeachingState(now);
  const pendingArtifacts = state.pendingArtifacts ?? [];
  const insights = state.insights ?? [];
  const notes = state.notes ?? [];
  const chapters = [...course.blueprint.chapters].sort((a, b) => a.index - b.index);
  const currentIndex = chapters.findIndex((chapter) => chapter.chapterId === lesson.chapterId);
  const nextChapter = chapters[currentIndex + 1];

  const evidence = lesson.evidence ?? [];
  const hasCheckpointEvidence = evidence.length > 0;
  const pending = hasCheckpointEvidence
    ? pendingArtifacts.filter(
        (artifact) =>
          !(artifact.kind === 'checkpoint_result' && artifact.chapterId === lesson.chapterId),
      )
    : pendingArtifacts;

  return {
    ...state,
    pendingArtifacts: pending,
    currentChapterId: nextChapter?.chapterId,
    insights: [
      ...insights,
      ...(nextChapter
        ? [{
            insightId: `ins-ch-${lesson.chapterId}-${now.toString(36)}`,
            content: `已完成「${lesson.chapterId}」，下一章「${nextChapter.chapterId}」可承接其要点。`,
            suggestedChapterId: nextChapter.chapterId,
            status: 'candidate' as const,
            createdAt: now,
          }]
        : []),
    ].slice(-20),
    notes,
    updatedAt: now,
  };
}
