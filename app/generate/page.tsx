// app/generate/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { ClarificationScreen } from '@/components/ClarificationScreen';
import { GenerationLoadingScreen } from '@/components/GenerationLoadingScreen';

export default function GeneratePage() {
  const router = useRouter();
  const {
    currentCourse,
    generationStatus,
    generationError,
    clarification,
    submitClarification,
    setClarification,
    retryCourseGeneration,
  } = useCourse();

  // 检查是否所有问题都已回答
  const allQuestionsAnswered = clarification
    ? clarification.questions.every(q => q.answer.trim() !== '')
    : false;

  useEffect(() => {
    if (generationStatus === 'success' && currentCourse) {
      router.replace(`/course/${currentCourse.courseId}`);
    }
  }, [generationStatus, currentCourse, router]);

  return (
    <main className="relative min-h-[100svh] overflow-x-hidden bg-background">
      {clarification && generationStatus !== 'error' ? (
        <ClarificationScreen
          questions={clarification.questions}
          onChange={(id, value) => {
            setClarification(prev => prev ? {
              ...prev,
              questions: prev.questions.map(item =>
                item.id === id ? { ...item, answer: value } : item
              )
            } : null);
          }}
          onSubmit={submitClarification}
          onBack={() => router.push('/')}
          isSubmitting={generationStatus === 'generating'}
          canSubmit={allQuestionsAnswered}
        />
      ) : (
        <GenerationLoadingScreen
          errorMessage={generationStatus === 'error' ? generationError : null}
          onRetry={() => {
            retryCourseGeneration().catch(() => undefined);
          }}
          onBack={() => router.push('/')}
          isRetrying={generationStatus === 'generating'}
        />
      )}
    </main>
  );
}
