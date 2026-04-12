// app/course/[courseId]/page.tsx
'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { useStreak } from '@/hooks/useStreak';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { CourseTree } from '@/components/CourseTree';
import { ChatLauncher, ChatWidget } from '@/components/ui/ChatWidget';
import { CourseCelebrationSheet } from '@/components/CourseCelebrationSheet';

export default function CoursePage() {
  const params = useParams();
  const router = useRouter();
  const { courses, currentCourse, generateNodeContent } = useCourse();
  const [isLoading, setIsLoading] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showTitleInBar, setShowTitleInBar] = useState(false);
  const { streakData, studiedToday } = useStreak();
  const [showCelebration, setShowCelebration] = useState(false);
  const celebrationShownRef = useRef(false);

  const courseId = params.courseId as string;

  useEffect(() => {
    if (courses.length > 0 || currentCourse) {
      setIsLoading(false);
    }
  }, [courses, currentCourse]);

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
    const course = courses.find(c => c.courseId === courseId) || currentCourse;
    if (!course?.nodes[0] || course.nodes[0].cards) return;

    generateNodeContent(courseId, 0).catch((error) => {
      console.warn('[CoursePage] Preload node 0 failed:', error);
    });
  }, [courseId, courses, currentCourse, generateNodeContent]);

  // 所有章节完成时弹出庆祝弹窗
  useEffect(() => {
    const courseData = courses.find(c => c.courseId === courseId) || currentCourse;
    if (!courseData) return;
    const allCompleted = courseData.nodes.length > 0 && courseData.nodes.every(n => n.status === 'completed');
    if (allCompleted && !celebrationShownRef.current) {
      celebrationShownRef.current = true;
      // 短暂延迟，等页面渲染完成
      const timer = setTimeout(() => setShowCelebration(true), 500);
      return () => clearTimeout(timer);
    }
  }, [courses, currentCourse, courseId]);

  if (isLoading) {
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
