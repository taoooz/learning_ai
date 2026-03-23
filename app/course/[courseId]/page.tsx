// app/course/[courseId]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { CourseTree } from '@/components/CourseTree';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

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
      <main className="min-h-screen flex items-center justify-center">
        <LoadingSpinner message="加载课程中..." />
      </main>
    );
  }

  const course = courses.find(c => c.courseId === courseId) || currentCourse;

  if (!course) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6">
        <p className="text-gray-600 mb-4">找不到这门课程</p>
        <button
          onClick={() => router.push('/')}
          className="px-6 py-2 rounded-full bg-blue-500 text-white"
        >
          返回首页
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      {/* 返回首页按钮 */}
      <button
        onClick={() => router.push('/')}
        className="mb-4 text-gray-500 hover:text-gray-700 flex items-center gap-1"
      >
        <span>←</span>
        <span>首页</span>
      </button>

      <CourseTree course={course} />
    </main>
  );
}