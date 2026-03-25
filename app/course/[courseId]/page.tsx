// app/course/[courseId]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { CourseTree } from '@/components/CourseTree';

export default function CoursePage() {
  const params = useParams();
  const router = useRouter();
  const { courses, currentCourse } = useCourse();
  const [isLoading, setIsLoading] = useState(true);

  const courseId = params.courseId as string;

  useEffect(() => {
    if (courses.length > 0 || currentCourse) {
      setIsLoading(false);
    }
  }, [courses, currentCourse]);

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
  const nextNode = course.nodes.find((node) => node.status === 'available');
  const nextNodeIndex = nextNode?.index ?? 0;

  return (
    <main className="min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 right-[-7rem] h-64 w-64 rounded-full bg-gradient-to-br from-accent/12 to-transparent blur-3xl" />
        <div className="absolute left-[-4rem] top-36 h-52 w-52 rounded-full bg-gradient-to-br from-sky-400/10 to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-2xl px-5 pb-10 pt-4 sm:px-6">
        <div className="sticky top-0 z-20 mb-6 pt-4">
          <div className="rounded-[24px] border border-white/72 bg-surface/80 px-3 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)] backdrop-blur-md">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/')}
                className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-background/92 text-secondary transition-colors hover:bg-subtle"
                aria-label="返回首页"
              >
                <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold leading-5 text-primary">{course.topic}</p>
              </div>

              <div className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-semibold text-secondary">
                {progressPercent}%
              </div>
            </div>
          </div>
        </div>

        <section>
          <div className="mb-5 px-1">
            <h2 className="text-lg font-semibold text-primary">学习路线</h2>
            <p className="mt-1 text-sm text-secondary">
              {course.difficultySummary || '先完成当前这一节，后面的内容会顺着解锁。'}
            </p>
          </div>

          <CourseTree course={course} />
        </section>
      </div>
    </main>
  );
}
