'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useCourse } from '@/contexts/CourseContext';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { createStoredCourseBundleFromBlueprint } from '@/lib/course-blueprint';
import type { CourseBlueprint, StoredCourseBundle, OutlineLearnerPositioning } from '@/types/course';

interface TocResponse {
  courseName: string;
  courseDescription: string;
  nodes: { index: number; title: string; teachingGoal: string; description: string }[];
}

interface PendingOutline {
  topic: string;
  learningDirection: string;
  learningGoal: string;
  learnerPositioning: OutlineLearnerPositioning;
}

function TocPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic') || '';
  const { generateToc, addCourse, generateNodeContent } = useCourse();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 用于标记是否已经发起过请求（防止 Strict Mode 重复请求）
  const hasRequestedRef = useRef(false);

  useEffect(() => {
    const outlineData = sessionStorage.getItem('pendingOutline');
    if (!outlineData) {
      setError('没有找到课程纲要，请重新开始');
      setIsLoading(false);
      return;
    }

    // 如果已经发起过请求，直接返回
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    const outline: PendingOutline = JSON.parse(outlineData);

    console.log('[TOC Page] Starting TOC generation');

    // 调用 toc API 生成课程名称、描述、节点详情
    generateToc(outline).then(async (result) => {
      try {
        const tocResult = result as TocResponse;

        // 构建完整的 CourseBlueprint
        const blueprint: CourseBlueprint = {
          courseId: `course-${Date.now()}`,
          topic: outline.topic,
          learnerPositioning: {
            estimatedLevel: outline.learnerPositioning.estimatedLevel,
            difficultySummary: outline.learnerPositioning.difficultySummary,
            whyThisCourseFits: outline.learnerPositioning.whyThisCourseFits,
          },
          courseGoal: tocResult.courseDescription || outline.learningGoal,
          globalConcepts: [],
          nodes: tocResult.nodes.map((n, i) => ({
            index: n.index,
            title: n.title,
            teachingGoal: n.teachingGoal,
            teachConceptIds: [],
            prerequisiteConceptIds: [],
            bridgeFromPreviousNode: '',
            status: 'available',
          })),
        };

        // 创建课程 bundle
        const bundle: StoredCourseBundle = createStoredCourseBundleFromBlueprint(blueprint);

        // 保存 bundle 并更新上下文状态
        addCourse(bundle);

        // 后台预生成第一个节点内容（不阻塞跳转）
        generateNodeContent(blueprint.courseId, 0).catch(err => {
          console.warn('[TOC Page] Preload node 0 failed:', err);
        });

        // 清理 sessionStorage
        sessionStorage.removeItem('pendingOutline');

        // 跳转到课程页面
        router.push(`/course/${blueprint.courseId}`);
      } catch (err) {
        console.error('[TOC Page] Failed to create course:', err);
        setError('创建课程失败，请稍后再试');
        setIsLoading(false);
      }
    }).catch((err) => {
      console.error('[TOC Page] Failed to generate TOC:', err);
      setError('生成目录失败，请稍后再试');
      setIsLoading(false);
    });
  }, [generateToc, addCourse, router]);

  if (isLoading) {
    return (
      <main className="min-h-screen flex flex-col bg-background">
        <CourseHeaderBar title="生成课程" backLabel="返回" onBack={() => router.push('/generate/chat?topic=' + encodeURIComponent(topic))} />
        
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="mb-8 mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 via-accent/10 to-accent/5 shadow-[0_8px_24px_rgba(255,138,0,0.12)]"
            >
              <motion.svg 
                className="w-10 h-10 text-accent" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </motion.svg>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <h3 className="mb-3 text-[22px] font-bold text-primary">正在生成课程目录</h3>
            <p className="mb-6 text-[15px] leading-relaxed text-secondary">
              AI 正在为你规划学习路径
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.6 }}
            className="w-full max-w-xs mx-auto space-y-3"
          >
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 1 }}
              className="flex items-center gap-3 rounded-2xl bg-white/60 px-4 py-3 shadow-sm"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10">
                <svg className="h-4 w-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <span className="text-sm text-secondary">规划课程结构...</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 1.5 }}
              className="flex items-center gap-3 rounded-2xl bg-white/60 px-4 py-3 shadow-sm"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10">
                <svg className="h-4 w-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <span className="text-sm text-secondary">设计学习节点...</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 2 }}
              className="flex items-center gap-3 rounded-2xl bg-white/60 px-4 py-3 shadow-sm"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10">
                <svg className="h-4 w-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm text-secondary">完善课程信息...</span>
            </motion.div>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 2.5 }}
            className="mt-8 text-xs text-tertiary"
          >
            通常需要 5-10 秒
          </motion.p>
        </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col bg-background">
      <CourseHeaderBar title="生成课程" backLabel="返回" onBack={() => router.push('/generate/chat?topic=' + encodeURIComponent(topic))} />
      
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center">
          <div className="mb-6 mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-error/20 to-error/5 shadow-[0_8px_24px_rgba(239,71,111,0.12)]">
          <svg className="h-8 w-8 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="mb-2 text-[20px] font-bold text-primary">{error}</h3>
        <p className="mb-6 text-sm text-secondary">请稍后再试</p>
        <button
          onClick={() => router.push('/generate')}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white shadow-[0_4px_16px_rgba(255,138,0,0.20)] transition-all hover:shadow-[0_6px_20px_rgba(255,138,0,0.25)] active:scale-[0.985]"
        >
          重新开始
        </button>
      </div>
      </div>
    </main>
  );
}

export default function TocPage() {
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
      <TocPageContent />
    </Suspense>
  );
}
