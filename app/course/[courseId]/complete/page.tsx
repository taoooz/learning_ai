// app/course/[courseId]/complete/page.tsx
'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';

function CompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextNodeIndex = searchParams.get('nextNodeIndex');
  const courseId = searchParams.get('courseId') || '';

  const handleNext = () => {
    if (nextNodeIndex !== null) {
      router.push(`/course/${courseId}/learn/${nextNodeIndex}`);
    } else {
      router.push(`/course/${courseId}`);
    }
  };

  const handleBackToToc = () => {
    router.push(`/course/${courseId}`);
  };

  return (
    <main className="min-h-[100svh] overflow-x-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 right-[-7rem] h-64 w-64 rounded-full bg-gradient-to-br from-accent/12 to-transparent blur-3xl" />
        <div className="absolute left-[-5rem] top-28 h-48 w-48 rounded-full bg-gradient-to-br from-sky-400/8 to-transparent blur-3xl" />
      </div>

      <CourseHeaderBar
        title=""
        backLabel="课程目录"
        onBack={handleBackToToc}
      />

      <div
        className="relative mx-auto flex max-w-md flex-col box-border px-5 sm:px-6"
        style={{
          minHeight: '100svh',
          paddingTop: '88px',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex flex-1 flex-col items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="w-full text-center"
          >
            <motion.div
              initial={{ scale: 0.8, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.5, delay: 0.1, type: 'spring', stiffness: 200, damping: 15 }}
              className="mb-8 inline-flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#FFE5CC] via-[#FFF5EC] to-white shadow-[0_12px_32px_rgba(255,138,0,0.15)]"
            >
              <span className="text-5xl">🎉</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <h2 className="mb-3 text-[32px] font-bold leading-tight tracking-tight text-primary">
                太棒了！
              </h2>
              <p className="text-[17px] leading-relaxed text-secondary">
                你已经完成了这一节的学习
              </p>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="mt-12 w-full space-y-3"
          >
            <button
              onClick={handleNext}
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-cta px-6 py-4 text-[15px] font-semibold text-cta shadow-[0_8px_24px_rgba(255,138,0,0.20)] transition-all duration-150 hover:shadow-[0_12px_32px_rgba(255,138,0,0.25)] active:scale-[0.985]"
            >
              继续下一节
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
            <button
              onClick={handleBackToToc}
              className="inline-flex min-h-13 w-full items-center justify-center rounded-full border-2 border-black/[0.08] bg-white px-6 py-3.5 text-[15px] font-medium text-secondary transition-all duration-150 hover:border-black/[0.12] hover:bg-black/[0.02] active:scale-[0.985]"
            >
              返回课程目录
            </button>
          </motion.div>
        </div>
      </div>
    </main>
  );
}

export default function CompletePage() {
  return (
    <Suspense fallback={
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
    }>
      <CompleteContent />
    </Suspense>
  );
}