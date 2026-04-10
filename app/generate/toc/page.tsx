'use client';

import { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useCourse } from '@/contexts/CourseContext';
import { type TocStreamEvent } from '@/contexts/CourseContext';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { createStoredCourseBundleFromBlueprint } from '@/lib/course-blueprint';
import type { CourseBlueprint, StoredCourseBundle, OutlineLearnerPositioning } from '@/types/course';

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
  const [error, setError] = useState<string | null>(null);

  // 流式展示状态
  const [courseName, setCourseName] = useState('');
  const [courseDescription, setCourseDescription] = useState('');
  const [streamNodes, setStreamNodes] = useState<Array<{ index: number; title: string; description: string }>>([]);
  const [isComplete, setIsComplete] = useState(false);

  const hasRequestedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleTocEvent = useCallback((event: TocStreamEvent) => {
    if (event.type === 'course_name') setCourseName(event.value);
    else if (event.type === 'course_description') setCourseDescription(event.value);
    else if (event.type === 'node') setStreamNodes(prev => [...prev, event.node]);
    else if (event.type === 'complete') setIsComplete(true);
    else if (event.type === 'error') setError(event.message);
  }, []);

  useEffect(() => {
    const outlineData = sessionStorage.getItem('pendingOutline');
    if (!outlineData) {
      setError('没有找到课程纲要，请重新开始');
      return;
    }
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    const outline: PendingOutline = JSON.parse(outlineData);
    let errorHandled = false;

    generateToc(outline, { onEvent: handleTocEvent })
      .then(async (result) => {
        const blueprint: CourseBlueprint = {
          courseId: `course-${Date.now()}`,
          topic: result.courseName || outline.topic,
          learnerPositioning: {
            estimatedLevel: outline.learnerPositioning.estimatedLevel,
            difficultySummary: outline.learnerPositioning.difficultySummary,
            whyThisCourseFits: outline.learnerPositioning.whyThisCourseFits,
          },
          courseGoal: result.courseDescription || outline.learningGoal,
          globalConcepts: [],
          nodes: result.nodes.map((n) => ({
            index: n.index,
            title: n.title,
            teachingGoal: n.description,
            frame: n.frame,
            teachConceptIds: [],
            prerequisiteConceptIds: [],
            bridgeFromPreviousNode: '',
            status: 'available',
          })),
        };

        addCourse(createStoredCourseBundleFromBlueprint(blueprint));
        generateNodeContent(blueprint.courseId, 0).catch(() => {});
        sessionStorage.removeItem('pendingOutline');

        timerRef.current = setTimeout(() => {
          router.push(`/course/${blueprint.courseId}`);
        }, 1500);
      })
      .catch((err) => {
        console.error('[TOC Page] Failed to generate TOC:', err);
        if (!errorHandled) {
          setError(err instanceof Error ? err.message : '生成目录失败，请稍后再试');
        }
      });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [generateToc, addCourse, generateNodeContent, handleTocEvent, router]);

  // 错误状态
  if (error) {
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

  const hasContent = courseName || streamNodes.length > 0;

  return (
    <main className="min-h-screen flex flex-col bg-background">
      <CourseHeaderBar title="生成课程" backLabel="返回" onBack={() => router.push('/generate/chat?topic=' + encodeURIComponent(topic))} />

      <div className="relative flex-1 overflow-hidden">
        {/* Loading 层：居中展示，交叉淡出 */}
        <motion.div
          animate={{ opacity: hasContent ? 0 : 1 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 flex items-center justify-center px-6"
          style={{ pointerEvents: hasContent ? 'none' : 'auto' }}
        >
          <div className="text-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 via-accent/10 to-accent/5 shadow-[0_8px_24px_rgba(255,138,0,0.12)]"
            >
              <svg className="h-7 w-7 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </motion.div>
            <h3 className="mb-1.5 text-[18px] font-bold text-primary">正在规划课程</h3>
            <p className="text-sm text-secondary">AI 正在根据你的情况设计学习路径</p>
            <div className="mt-6 space-y-2 text-left">
              {['分析学习目标', '设计课程结构', '生成章节内容'].map((step, i) => (
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.3 + i * 0.15 }}
                  className="flex items-center gap-2.5 rounded-xl bg-white/50 px-3.5 py-2.5"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/8">
                    <span className="text-[11px] font-semibold text-accent">{i + 1}</span>
                  </div>
                  <span className="text-[13px] text-secondary">{step}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* 流式内容层：交叉淡入 */}
        <motion.div
          animate={{ opacity: hasContent ? 1 : 0 }}
          transition={{ duration: 0.3, delay: hasContent ? 0.2 : 0 }}
          className="absolute inset-0 overflow-y-auto pt-[88px] px-5 pb-8"
        >
          <div className="mx-auto max-w-lg">
            {/* 状态指示 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-4 flex items-center gap-2"
            >
              <div className="flex items-center gap-1.5">
                {!isComplete ? (
                  <>
                    <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0 }} className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                    <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.2 }} className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                    <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.4 }} className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                  </>
                ) : (
                  <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className="text-[13px] font-medium text-secondary/70">
                {isComplete ? '课程规划完成' : '正在生成课程大纲...'}
              </span>
            </motion.div>

            {/* 课程名称 + 描述 */}
            {courseName && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="mb-5"
              >
                <h2 className="text-[20px] font-bold leading-snug text-primary">{courseName}</h2>
                {courseDescription && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3, delay: 0.2 }}
                    className="mt-1.5 text-[14px] leading-relaxed text-secondary"
                  >
                    {courseDescription}
                  </motion.p>
                )}
              </motion.div>
            )}

            {/* 章节分隔 */}
            {streamNodes.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="mb-3 flex items-center gap-2"
              >
                <div className="h-px flex-1 bg-black/[0.06]" />
                <span className="text-[12px] font-medium text-tertiary">课程章节</span>
                <div className="h-px flex-1 bg-black/[0.06]" />
              </motion.div>
            )}

            {/* 章节列表 */}
            <div className="space-y-2">
              {streamNodes.map((node, idx) => (
                <motion.div
                  key={node.index}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="flex items-center gap-3 rounded-xl bg-white/70 px-4 py-3"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                    <span className="text-[12px] font-bold text-accent">{idx + 1}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-[14px] font-semibold text-primary">{node.title}</h4>
                    {node.description && (
                      <p className="mt-0.5 text-[12px] text-secondary/70 line-clamp-1">{node.description}</p>
                    )}
                  </div>
                  {isComplete && (
                    <svg className="h-4 w-4 shrink-0 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </motion.div>
              ))}

              {/* 加载中 */}
              {!isComplete && streamNodes.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 px-4 py-1.5"
                >
                  <div className="flex items-center gap-1">
                    <motion.span animate={{ opacity: [0.2, 0.8, 0.2] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0 }} className="inline-block h-1 w-1 rounded-full bg-accent/50" />
                    <motion.span animate={{ opacity: [0.2, 0.8, 0.2] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.15 }} className="inline-block h-1 w-1 rounded-full bg-accent/50" />
                    <motion.span animate={{ opacity: [0.2, 0.8, 0.2] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.3 }} className="inline-block h-1 w-1 rounded-full bg-accent/50" />
                  </div>
                  <span className="text-[12px] text-tertiary">规划更多章节...</span>
                </motion.div>
              )}
            </div>

            {/* 完成提示 */}
            {isComplete && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.5 }}
                className="mt-5 flex items-center justify-center"
              >
                <span className="text-[13px] text-tertiary">即将进入课程...</span>
              </motion.div>
            )}
          </div>
        </motion.div>
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
