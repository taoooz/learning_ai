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
        title="学习完成"
        backLabel="返回课程"
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
        <div className="flex flex-1 flex-col pt-1.5">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[32px] border border-white/80 bg-surface/96 px-6 py-10 text-center shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
          >
            <motion.div
              initial={{ scale: 0.88, rotate: -6 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.34, delay: 0.05, type: 'spring', stiffness: 260, damping: 18 }}
              className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(255,138,0,0.20),rgba(56,189,248,0.14),rgba(255,255,255,0.98))] text-accent shadow-[0_10px_22px_rgba(255,138,0,0.10)]"
            >
              <span className="text-4xl">🎉</span>
            </motion.div>

            <p className="text-sm font-medium text-accent">太棒了！</p>
            <h2 className="mt-2 text-[28px] font-semibold tracking-tight text-primary">你已经完成了这一节的学习</h2>
            <p className="mt-3 text-sm leading-6 text-secondary">
              继续加油，下一节内容已经准备好了。
            </p>
          </motion.div>

          <div className="mt-auto flex flex-col gap-3 pt-3">
            <button
              onClick={handleNext}
              className="inline-flex min-h-13 w-full items-center justify-center rounded-full bg-cta px-6 py-3 text-sm font-semibold text-cta shadow-[0_10px_24px_rgba(17,24,39,0.10)] transition-all duration-150 active:scale-[0.985]"
            >
              进入下一节
            </button>
            <button
              onClick={handleBackToToc}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-black/10 bg-white px-6 py-3 text-sm font-medium text-secondary transition-all duration-150 active:scale-[0.985]"
            >
              返回课程目录
            </button>
          </div>
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