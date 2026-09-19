// app/course/[courseId]/chapter/[chapterId]/page.tsx
// V2 章节学习页：核心循环的宿主页面
// 分发与守卫：非 V2 课程回课程页（V1 没有章节学习页）；章节不存在回课程页；
// 章节 locked 回课程页（恢复分支⑨，以读时自愈后的章节树判定）
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { LearningStreamV2 } from '@/components/learning-v2/LearningStreamV2';
import { TaskBoundaryV2 } from '@/components/learning-v2/TaskBoundaryV2';
import { latestTutorActionIsProceed } from '@/lib/learning-v2/tutor-queue';
import { ChapterCompleteCard } from '@/components/learning-v2/ChapterCompleteCard';
import { InlineTutorInput, tutorPlaceholder } from '@/components/learning-v2/InlineTutorInput';
import { useChapterLearning } from '@/hooks/learning-v2/useChapterLearning';
import { resolveStoredCourse } from '@/lib/learning-v2/dispatch';
import { refreshCourseTreeViewV2, isSameCourseTreeView } from '@/lib/learning-v2/chapter-complete';
import { saveStoredCourseV2 } from '@/lib/learning-v2/storage';
import type { ChapterDefinition, StoredCourseV2 } from '@/types/learning-v2';

interface ResolvedChapter {
  course: StoredCourseV2;
  chapter: ChapterDefinition;
}

export default function ChapterLearningPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.courseId as string;
  const chapterId = params.chapterId as string;

  // undefined = 判定中；null = 不可进入（已重定向）
  const [resolved, setResolved] = useState<ResolvedChapter | null | undefined>(undefined);
  const [showTitleInBar, setShowTitleInBar] = useState(false);

  useEffect(() => {
    const result = resolveStoredCourse(courseId);
    if (!result || result.protocol !== 2) {
      router.replace(`/course/${courseId}`);
      return;
    }
    const chapter = result.course.blueprint.chapters.find((c) => c.chapterId === chapterId);
    if (!chapter) {
      router.replace(`/course/${courseId}`);
      return;
    }
    // 读时自愈：以各章 lesson 真实状态重派生章节树（与课程页同一条路径）
    const refreshed = refreshCourseTreeViewV2(result.course);
    if (!isSameCourseTreeView(refreshed, result.course.treeView)) {
      saveStoredCourseV2({ ...result.course, treeView: refreshed });
    }
    // 恢复分支⑨：未解锁的章节不允许进入
    const entry = refreshed.chapters.find((c) => c.chapterId === chapterId);
    if (entry?.status === 'locked') {
      router.replace(`/course/${courseId}`);
      return;
    }
    setResolved({ course: { ...result.course, treeView: refreshed }, chapter });
  }, [courseId, chapterId, router]);

  useEffect(() => {
    const handleScroll = () => {
      const titleElement = document.querySelector('[data-chapter-title]');
      if (titleElement) {
        const rect = titleElement.getBoundingClientRect();
        setShowTitleInBar(rect.bottom < 60);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (resolved === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-accent/5">
            <svg className="h-6 w-6 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-sm text-secondary">加载中...</p>
        </div>
      </main>
    );
  }

  if (resolved === null) return null; // 已重定向，占位一帧

  return (
    <ChapterLearningView
      key={chapterId} // 章节切换强制重建，hook 按新章节重新 boot
      course={resolved.course}
      chapter={resolved.chapter}
      showTitleInBar={showTitleInBar}
    />
  );
}

function ChapterLearningView({
  course,
  chapter,
  showTitleInBar,
}: ResolvedChapter & { showTitleInBar: boolean }) {
  const router = useRouter();
  const {
    lesson,
    phase,
    planError,
    continueNext,
    retryPlan,
    resumeAnchorTaskId,
    currentTaskAttempts,
    submitTutorQuestion,
    retryTutor,
    tutorState,
    isTutorBusy,
    submitCheckpoint,
    retryCheckpoint,
    requestRemediation,
  } = useChapterLearning({
    courseId: course.courseId,
    chapterId: chapter.chapterId,
    blueprint: course.blueprint,
  });

  // P2 流内答疑草稿：受控于页面；章节切换随 key={chapterId} 重建清空
  const [tutorDraft, setTutorDraft] = useState('');

  const totalTasks = lesson?.chapterPlan.tasks.length ?? 0;
  const completedTasks = lesson ? lesson.runtime.completedTaskIds.length : 0;
  const nextChapter =
    phase === 'completed' ? findNextUnlockedChapter(course, chapter.chapterId) : undefined;

  return (
    <main className="min-h-[100svh] overflow-x-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 right-[-7rem] h-64 w-64 rounded-full bg-gradient-to-br from-accent/12 to-transparent blur-3xl" />
        <div className="absolute left-[-4rem] top-36 h-52 w-52 rounded-full bg-gradient-to-br from-sky-400/10 to-transparent blur-3xl" />
      </div>

      <div
        className="relative mx-auto max-w-2xl px-5 pt-4 sm:px-6"
        style={{
          minHeight: '100svh',
          paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
        }}
      >
        <CourseHeaderBar
          title={showTitleInBar ? chapter.title : ''}
          backLabel="课程"
          onBack={() => router.push(`/course/${course.courseId}`)}
          trailing={
            totalTasks > 0 ? (
              <div className="rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent">
                {completedTasks}/{totalTasks} 节
              </div>
            ) : undefined
          }
          maxWidthClassName="max-w-2xl"
        />

        <section className="pb-2 pt-[78px]">
          <div className="mb-5 px-1">
            <h1 data-chapter-title className="mb-2 text-[24px] font-bold leading-tight tracking-tight text-primary">
              {chapter.title}
            </h1>
            {chapter.teachingGoal && (
              <p className="text-[14px] leading-relaxed text-secondary">{chapter.teachingGoal}</p>
            )}
          </div>

          {phase === 'planning' && (
            <div className="rounded-2xl bg-surface px-4 py-6 text-center text-[14px] text-secondary">
              正在规划本章学习路径…
            </div>
          )}

          {phase === 'plan_failed' && (
            <div className="rounded-2xl border border-error/20 bg-error/6 px-4 py-5 text-center">
              <p className="text-[14px] leading-relaxed text-error">
                {planError ?? '学习计划生成失败'}
              </p>
              <button
                type="button"
                onClick={retryPlan}
                className="mt-4 rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
              >
                重新生成计划
              </button>
            </div>
          )}

          {lesson && phase !== 'completed' && (
            <>
              {lesson.streamItems.length === 0 &&
                (phase === 'generating' || phase === 'streaming') && (
                  <div className="rounded-2xl bg-surface px-4 py-6 text-center text-[14px] text-secondary">
                    正在生成第一节内容…
                  </div>
                )}
              <LearningStreamV2
                lesson={lesson}
                phase={phase}
                anchorTaskId={resumeAnchorTaskId}
                onRetryTutor={retryTutor}
                tutorBusy={isTutorBusy}
                onSubmitCheckpoint={submitCheckpoint}
                onRetryCheckpoint={retryCheckpoint}
                onRequestRemediation={requestRemediation}
              />
              {phase === 'completing' && (
                <div className="mt-6 text-center text-[13px] text-tertiary">正在收尾本章…</div>
              )}
              <TaskBoundaryV2
                lesson={lesson}
                phase={phase}
                attempts={currentTaskAttempts}
                onContinue={continueNext}
                highlightContinue={latestTutorActionIsProceed(lesson)}
              />
              {/* P2 提问输入框（§4）：学习流/边界卡之后常驻，流中与边界均可见；
                  completing 禁用（收尾后章节转 completed，排队问题将无人应答）；
                  completed/plan_failed 相位整体隐藏 */}
              <InlineTutorInput
                value={tutorDraft}
                onChange={setTutorDraft}
                onSubmit={submitTutorQuestion}
                placeholder={tutorPlaceholder(phase)}
                disabled={phase === 'completing'}
                queuedCount={tutorState.pendingCount}
                busy={tutorState.busy}
              />
            </>
          )}

          {phase === 'completed' && lesson && (
            <>
              <LearningStreamV2
                lesson={lesson}
                phase={phase}
                onRetryTutor={retryTutor}
                tutorBusy={isTutorBusy}
                onSubmitCheckpoint={submitCheckpoint}
                onRetryCheckpoint={retryCheckpoint}
                onRequestRemediation={requestRemediation}
              />
              <div className="mt-8">
                <ChapterCompleteCard
                  chapterTitle={chapter.title}
                  recap={lesson.recap}
                  nextChapter={nextChapter}
                  onBackToCourse={() => router.push(`/course/${course.courseId}`)}
                  onNextChapter={
                    nextChapter
                      ? () => router.push(`/course/${course.courseId}/chapter/${nextChapter.chapterId}`)
                      : undefined
                  }
                />
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

/**
 * 完成卡的下一章入口：按蓝图顺序取下一章，且以读时自愈的章节树确认已解锁。
 * 全部完成或下一章仍锁定时返回 undefined（卡片只留「回到课程」）。
 */
function findNextUnlockedChapter(
  course: StoredCourseV2,
  chapterId: string,
): { chapterId: string; title: string } | undefined {
  const chapters = course.blueprint.chapters;
  const currentIndex = chapters.findIndex((c) => c.chapterId === chapterId);
  const next = currentIndex >= 0 ? chapters[currentIndex + 1] : undefined;
  if (!next) return undefined;
  const tree = refreshCourseTreeViewV2(course);
  const entry = tree.chapters.find((c) => c.chapterId === next.chapterId);
  if (!entry || entry.status === 'locked') return undefined;
  return { chapterId: next.chapterId, title: next.title };
}
