// app/generate/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function GeneratePage() {
  const router = useRouter();
  const { currentCourse, generationStatus } = useCourse();

  useEffect(() => {
    if (generationStatus === 'success' && currentCourse) {
      router.replace(`/course/${currentCourse.courseId}`);
    } else if (generationStatus === 'error') {
      router.replace('/');
    }
  }, [generationStatus, currentCourse, router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-gray-50">
      <LoadingSpinner message="AI is creating your personalized course..." />
    </main>
  );
}