// app/course/[courseId]/page.tsx
'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { useStreak } from '@/hooks/useStreak';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { CourseTree } from '@/components/CourseTree';
import { ChapterTreeV2 } from '@/components/learning-v2/ChapterTreeV2';
import { ChatLauncher, ChatWidget } from '@/components/ui/ChatWidget';
import { CourseCelebrationSheet } from '@/components/CourseCelebrationSheet';
import { resolveStoredCourse } from '@/lib/learning-v2/dispatch';
import { refreshCourseTreeViewV2, isSameCourseTreeView } from '@/lib/learning-v2/chapter-complete';
import { saveStoredCourseV2 } from '@/lib/learning-v2/storage';
import type { StoredCourseV2 } from '@/types/learning-v2';

export default function CoursePage() {
  const params = useParams();
  const router = useRouter();
  const { courses, currentCourse, generateNodeContent, isHydrated } = useCourse();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showTitleInBar, setShowTitleInBar] = useState(false);
  const { streakData, studiedToday } = useStreak();
  const [showCelebration, setShowCelebration] = useState(false);
  const celebrationShownRef = useRef(false);
  // V2 分发：undefined = 尚未判定；StoredCourseV2 = V2 课程；null = 走 V1
  const [v2Course, setV2Course] = useState<StoredCourseV2 | null | undefined>(undefined);

  const courseId = params.courseId as string;

  useEffect(() => {
    const resolved = resolveStoredCourse(courseId);
    if (resolved?.protocol !== 2) {
      setV2Course(null);
      return;
    }
    // 读时自愈：以各章 lesson 的真实状态重派生章节树，缓存漂移时回写
    const refreshed = refreshCourseTreeViewV2(resolved.course);
    if (!isSameCourseTreeView(refreshed, resolved.course.treeView)) {
      saveStoredCourseV2({ ...resolved.course, treeView: refreshed });
    }
    setV2Course({ ...resolved.course, treeView: refreshed });
  }, [courseId]);

  useEffect(() => {
    const handleScroll = () => {
      const titleElement = document.querySelector('[data-course-title]');
      if (titleElement) {
        const rect = titleElement.getBoundingClientRect();
        setShowTitleInBar(rect.bottom < 60);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    // V2 课程章节内容按需生成，不做 V1 节点预热；判定完成前也不抢跑，避免双写课程白烧一次 LLM
    if (v2Course !== null) return;
    const course = courses.find(c => c.courseId === courseId) || currentCourse;
    if (!course?.nodes[0] || course.nodes[0].cards) return;

    generateNodeContent(courseId, 0).catch((error) => {
      console.warn('[CoursePage] Preload node 0 failed:', error);
    });
  }, [courseId, courses, currentCourse, generateNodeContent, v2Course]);

  // V1：所有节点完成时弹出庆祝弹窗（V2 课程节点不会完成，走下方 V2 庆祝分支）
  useEffect(() => {
    if (v2Course !== null) return;
    const courseData = courses.find(c => c.courseId === courseId) || currentCourse;
    if (!courseData) return;
    const allCompleted = courseData.nodes.length > 0 && courseData.nodes.every(n => n.status === 'completed');
    if (allCompleted && !celebrationShownRef.current) {
      celebrationShownRef.current = true;
      // 短暂延迟，等页面渲染完成
      const timer = setTimeout(() => setShowCelebration(true), 500);
      return () => clearTimeout(timer);
    }
  }, [courses, currentCourse, courseId, v2Course]);

  // V2：所有章节完成时庆祝
  useEffect(() => {
    if (!v2Course) return;
    const allCompleted = v2Course.treeView.chapters.length > 0
      && v2Course.treeView.chapters.every(c => c.status === 'completed');
    if (allCompleted && !celebrationShownRef.current) {
      celebrationShownRef.current = true;
      const timer = setTimeout(() => setShowCelebration(true), 500);
      return () => clearTimeout(timer);
    }
  }, [v2Course]);

  // 水合/协议判定完成前显示加载态；之后课程不存在则落到下方 404 界面，避免无限 loading
  if (!isHydrated || v2Course === undefined) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center">
            <svg className="w-6 h-6 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-secondary text-sm">加载中...</p>
        </div>
      </main>
    );
  }

  const course = courses.find(c => c.courseId === courseId) || currentCourse;

  // V2 学习流：章节树渲染 + 内容按需生成，进度由 treeView 派生；V1 bundle 仅兜底提供目标文案
  if (v2Course) {
    const completedChapters = v2Course.treeView.chapters.filter(c => c.status === 'completed').length;
    const v2Progress = v2Course.treeView.totalChapters > 0
      ? Math.round((completedChapters / v2Course.treeView.totalChapters) * 100)
      : 0;

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
            title={showTitleInBar ? v2Course.treeView.topic : ""}
            backLabel="首页"
            onBack={() => router.push('/')}
            streak={streakData.currentStreak > 0 ? { count: streakData.currentStreak, studiedToday } : undefined}
            trailing={(
              <div className="rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent">
                {v2Progress}% 完成
              </div>
            )}
            maxWidthClassName="max-w-2xl"
          />

          <section className="pb-2 pt-[78px]">
            <div className="mb-4 px-1">
              <h1 data-course-title className="mb-2 text-[28px] font-bold leading-tight tracking-tight text-primary">
                {v2Course.treeView.topic}
              </h1>
              {course?.courseGoal && (
                <p className="text-[15px] leading-relaxed text-secondary">
                  {course.courseGoal}
                </p>
              )}
            </div>

            <ChapterTreeV2 courseId={courseId} treeView={v2Course.treeView} />
          </section>
        </div>

        {course && (
          <CourseCelebrationSheet
            isOpen={showCelebration}
            onClose={() => setShowCelebration(false)}
            course={course}
          />
        )}

        <ChatLauncher onClick={() => setIsChatOpen(true)} />

        <ChatWidget
          courseId={v2Course.courseId}
          courseTitle={v2Course.treeView.topic}
          memoryTopic={v2Course.treeView.topic}
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
        />
      </main>
    );
  }

  if (!course) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-error/20 to-error/5 flex items-center justify-center">
            <svg className="w-8 h-8 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-primary mb-2">找不到这门课程</h2>
          <p className="text-secondary text-sm mb-6">可能已经被删除啦</p>
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-3 rounded-full bg-accent text-white font-medium shadow-md hover:shadow-lg active:scale-95 transition-all duration-200"
          >
            去看看其他探索主题
          </button>
        </div>
      </main>
    );
  }

  // 计算进度
  const completedCount = course.nodes.filter(n => n.status === 'completed').length;
  const progressPercent = course.totalNodes > 0
    ? Math.round((completedCount / course.totalNodes) * 100)
    : 0;

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
          title={showTitleInBar ? course.topic : ""}
          backLabel="首页"
          onBack={() => router.push('/')}
          streak={streakData.currentStreak > 0 ? { count: streakData.currentStreak, studiedToday } : undefined}
          trailing={(
            <div className="rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent">
              {progressPercent}% 完成
            </div>
          )}
          maxWidthClassName="max-w-2xl"
        />

        <section className="pb-2 pt-[78px]">
          <div className="mb-4 px-1">
            <h1 data-course-title className="mb-2 text-[28px] font-bold leading-tight tracking-tight text-primary">
              {course.topic}
            </h1>
            {course.courseGoal && (
              <p className="text-[15px] leading-relaxed text-secondary">
                {course.courseGoal}
              </p>
            )}
          </div>

          <CourseTree course={course} />
        </section>
      </div>

      <CourseCelebrationSheet
        isOpen={showCelebration}
        onClose={() => setShowCelebration(false)}
        course={course}
      />

      <ChatLauncher onClick={() => setIsChatOpen(true)} />

      <ChatWidget
        courseId={course.courseId}
        courseTitle={course.topic}
        memoryTopic={course.topic}
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
      />
    </main>
  );
}
