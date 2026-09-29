// app/course/[courseId]/chapter/[chapterId]/page.tsx
// V2 章节学习页：核心循环的宿主页面
// 分发与守卫：非 V2 课程回课程页（V1 没有章节学习页）；章节不存在回课程页；
// 章节 locked 回课程页（恢复分支⑨，以读时自愈后的章节树判定）
'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { ChapterRecapSkeleton, LearningStreamV2 } from '@/components/learning-v2/LearningStreamV2';
import { TaskBoundaryV2 } from '@/components/learning-v2/TaskBoundaryV2';
import { PlanPatchPrompt } from '@/components/learning-v2/PlanPatchPrompt';
import { latestTutorActionIsProceed } from '@/lib/learning-v2/tutor-queue';
import { ChapterCompleteCard } from '@/components/learning-v2/ChapterCompleteCard';
import { InlineTutorInput, tutorPlaceholder } from '@/components/learning-v2/InlineTutorInput';
import { useChapterLearning } from '@/hooks/learning-v2/useChapterLearning';
import { loadRenderableStoredCourse } from '@/lib/learning-v2/dispatch';
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
    let cancelled = false;
    void (async () => {
      const result = await loadRenderableStoredCourse(courseId);
      if (cancelled) return;
      if (!result || result.protocol !== 2) {
        router.replace(`/course/${courseId}`);
        return;
      }
      const chapter = result.course.blueprint.chapters.find((c) => c.chapterId === chapterId);
      if (!chapter) {
        router.replace(`/course/${courseId}`);
        return;
      }
      // loadRenderableStoredCourse 已与课程页共用读时自愈路径
      const entry = result.course.treeView.chapters.find((c) => c.chapterId === chapterId);
      if (entry?.status === 'locked') {
        router.replace(`/course/${courseId}`);
        return;
      }
      setResolved({ course: result.course, chapter });
    })();
    return () => {
      cancelled = true;
    };
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
    retryTask,
    resumeAnchorTaskId,
    currentTaskAttempts,
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

  // P4：到达边界且有证据时请求一次调度建议（组件级防抖：每次章节挂载最多一次自动请求）
  const planSuggestionRequestedRef = useRef(false);
  useEffect(() => {
    if (phase === 'boundary' && !planSuggestionRequestedRef.current) {
      planSuggestionRequestedRef.current = true;
      void requestPlanSuggestion();
    }
  }, [phase, requestPlanSuggestion]);

  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <main className="min-h-[100svh] overflow-x-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 right-[-8rem] h-72 w-72 rounded-full bg-gradient-to-br from-accent/14 to-transparent blur-3xl" />
        <div className="absolute left-[-6rem] top-40 h-60 w-60 rounded-full bg-gradient-to-br from-sky-400/10 to-transparent blur-3xl" />
      </div>

      <div
        className="relative mx-auto max-w-2xl px-5 pt-4 sm:px-6"
        style={{
          minHeight: '100svh',
          paddingBottom: 'max(120px, calc(env(safe-area-inset-bottom) + 104px))',
        }}
      >
        <CourseHeaderBar
          title={showTitleInBar ? chapter.title : ''}
          backLabel="课程"
          onBack={() => router.push(`/course/${course.courseId}`)}
          trailing={
            totalTasks > 0 ? (
              <div className="flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1.5">
                <span className="h-1.5 w-8 overflow-hidden rounded-full bg-accent/20">
                  <span
                    className="block h-full rounded-full bg-accent transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </span>
                <span className="text-[11px] font-semibold text-accent">{progressPercent}%</span>
              </div>
            ) : undefined
          }
          maxWidthClassName="max-w-2xl"
        />

        <section className="pb-2 pt-[78px]">
          {saveConflict && (
            <div className="mb-4 rounded-2xl border border-error/20 bg-error/6 px-4 py-4">
              <p className="text-[14px] leading-relaxed text-error">{saveConflict}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadServerVersion()}
                  className="rounded-full border border-white/72 bg-surface px-4 py-2 text-[13px] font-semibold text-primary transition-opacity hover:opacity-90 active:opacity-80"
                >
                  加载服务端版本
                </button>
                <button
                  type="button"
                  onClick={overwriteServerVersion}
                  className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
                >
                  用本机进度覆盖
                </button>
              </div>
            </div>
          )}
          <header className="mb-6 rounded-3xl border border-black/[0.04] bg-surface/75 px-4 py-4 shadow-card backdrop-blur-sm sm:px-5">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">本章目标</span>
            </div>
            <h1 data-chapter-title className="mb-2 text-[26px] font-bold leading-[1.22] tracking-[-0.02em] text-primary sm:text-[28px]">
              {chapter.title}
            </h1>
            {chapter.teachingGoal && (
              <p className="text-[14px] leading-[1.75] text-secondary">{chapter.teachingGoal}</p>
            )}
            {totalTasks > 0 && (
              <div className="mt-4 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent/80 to-accent transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-[11px] font-medium text-tertiary">
                  {progressPercent}% 已完成
                </span>
              </div>
            )}
          </header>

          {phase === 'planning' && (
            <div className="fade-in rounded-2xl border border-black/[0.05] bg-surface p-4 shadow-card">
              <div className="flex items-center gap-2.5">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
                <p className="text-[13px] font-medium text-primary">正在规划本章学习路径</p>
              </div>
              <div className="mt-4 space-y-2.5">
                {[88, 76, 64].map((width, index) => (
                  <div key={index} className="h-3 animate-pulse rounded-full bg-black/[0.05]" style={{ width: `${width}%` }} />
                ))}
              </div>
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
                  <div className="fade-in space-y-4 rounded-3xl border border-black/[0.05] bg-surface p-4 shadow-card sm:p-5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
                      <p className="text-[13px] font-medium text-primary">正在准备第一节内容</p>
                    </div>
                    <div className="space-y-3">
                      <div className="h-3.5 w-[82%] animate-pulse rounded-full bg-black/[0.05]" />
                      <div className="h-3.5 w-full animate-pulse rounded-full bg-black/[0.04]" />
                      <div className="h-3.5 w-[68%] animate-pulse rounded-full bg-black/[0.05]" />
                    </div>
                    <div className="h-24 animate-pulse rounded-2xl bg-black/[0.03]" />
                  </div>
                )}
              <LearningStreamV2
                lesson={lesson}
                phase={phase}
                anchorTaskId={resumeAnchorTaskId}
                onRetryTask={retryTask}
                onRetryTutor={retryTutor}
                tutorBusy={isTutorBusy}
                onSubmitCheckpoint={submitCheckpoint}
                onRetryCheckpoint={retryCheckpoint}
                onRequestRemediation={requestRemediation}
              />
              {phase === 'completing' && !lesson?.recap && (
                <div className="mt-6">
                  <ChapterRecapSkeleton />
                </div>
              )}
              {planSuggestion && phase === 'boundary' && (
                <PlanPatchPrompt
                  patch={planSuggestion}
                  onAccept={acceptPlanSuggestion}
                  onDismiss={dismissPlanSuggestion}
                />
              )}
              {!isTutorBusy && (
                <TaskBoundaryV2
                  lesson={lesson}
                  phase={phase}
                  attempts={currentTaskAttempts}
                  onContinue={continueNext}
                  highlightContinue={latestTutorActionIsProceed(lesson)}
                />
              )}
              {/* P2 提问输入框（§4）：学习流/边界卡之后常驻，流中与边界均可见；
                  completing 禁用（收尾后章节转 completed，排队问题将无人应答）；
                  completed/plan_failed 相位整体隐藏 */}
              {phase !== 'generating' && phase !== 'streaming' && (
                <InlineTutorInput
                  value={tutorDraft}
                  onChange={setTutorDraft}
                  onSubmit={submitTutorQuestion}
                  placeholder={tutorPlaceholder(phase)}
                  disabled={phase === 'completing'}
                  queuedCount={tutorState.pendingCount}
                  busy={tutorState.busy}
                />
              )}
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
  // 页面装载时已通过 renderable course 完成读时自愈，这里不应再回扫本地章节。
  const entry = course.treeView.chapters.find((c) => c.chapterId === next.chapterId);
  if (!entry || entry.status === 'locked') return undefined;
  return { chapterId: next.chapterId, title: next.title };
}
