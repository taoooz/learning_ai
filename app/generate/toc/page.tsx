'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useCourse } from '@/contexts/CourseContext';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { createStoredCourseBundleFromBlueprint } from '@/lib/course-blueprint';
import { getUserProfile } from '@/lib/storage';
import { getPlanningMemoryPayload, getUserMemoryStoreSnapshot } from '@/lib/memory';
import { parseSSEStream } from '../chat/utils/sseParser';
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
  const { addCourse, generateNodeContent } = useCourse();
  const [error, setError] = useState<string | null>(null);

  // 流式展示状态
  const [courseName, setCourseName] = useState('');
  const [courseDescription, setCourseDescription] = useState('');
  const [streamNodes, setStreamNodes] = useState<Array<{ index: number; title: string; description: string }>>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [countdown, setCountdown] = useState(3);

  const hasRequestedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const outlineData = sessionStorage.getItem('pendingOutline');
    if (!outlineData) {
      setError('没有找到课程纲要，请重新开始');
      return;
    }
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    const outline: PendingOutline = JSON.parse(outlineData);

    (async () => {
      try {
        const response = await fetch('/api/generate/toc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blueprint: outline,
            // 个性化透传：用户画像 + 规划记忆（近期相关课程等），缺省时服务端行为与原来一致
            userProfile: getUserProfile(),
            planningPayload: getPlanningMemoryPayload(
              outline.topic,
              getUserMemoryStoreSnapshot(),
            ),
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || '目录生成失败，请稍后再试');
        }

        let completeResult: any = null;

        for await (const event of parseSSEStream(response)) {
          switch (event.type) {
            case 'course_name':
              setCourseName(event.value);
              break;

            case 'course_description':
              setCourseDescription(event.value);
              break;

            case 'node':
              setStreamNodes(prev => [...prev, event.node]);
              break;

            case 'complete':
              completeResult = event.result;
              break;

            case 'error':
              throw new Error(event.message || '目录生成失败');
          }
        }

        // 用 complete 结果（更可靠）或已流式展示的数据构造 blueprint
        const finalCourseName = completeResult?.courseName || courseName || outline.topic;
        const finalDescription = completeResult?.courseDescription || courseDescription || outline.learningGoal;
        // 空数组是 truthy，必须显式检查长度，否则空目录会被当成有效结果
        const finalNodes = Array.isArray(completeResult?.nodes) && completeResult.nodes.length > 0
          ? completeResult.nodes
          : streamNodes;

        // 空目录不可用：转入错误态引导重试，而不是静默创建一门没有章节的课程
        if (finalNodes.length === 0) {
          throw new Error('课程目录生成失败，请重试');
        }

        setIsComplete(true);

        const blueprint: CourseBlueprint = {
          courseId: `course-${Date.now()}`,
          topic: finalCourseName,
          learnerPositioning: {
            estimatedLevel: outline.learnerPositioning.estimatedLevel,
          },
          courseGoal: finalDescription || outline.learningGoal,
          globalConcepts: [],
          nodes: finalNodes.map((n: { index: number; title: string; description: string }) => ({
            index: n.index,
            title: n.title,
            teachingGoal: n.description,
            teachConceptIds: [],
            prerequisiteConceptIds: [],
            bridgeFromPreviousNode: '',
            status: 'available' as const,
          })),
        };

        addCourse(createStoredCourseBundleFromBlueprint(blueprint));
        generateNodeContent(blueprint.courseId, 0).catch(() => {});
        sessionStorage.removeItem('pendingOutline');

        // 倒计时跳转
        let remaining = 3;
        setCountdown(remaining);
        const countdownInterval = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            clearInterval(countdownInterval);
            router.push(`/course/${blueprint.courseId}`);
          } else {
            setCountdown(remaining);
          }
        }, 1000);
        timerRef.current = countdownInterval as unknown as NodeJS.Timeout;
      } catch (err) {
        console.error('[TOC Page] Failed:', err);
        setError(err instanceof Error ? err.message : '生成目录失败，请稍后再试');
      }
    })();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [addCourse, generateNodeContent, router]);

  // 错误状态
  if (error) {
    // 纲要还在 sessionStorage 中（仅成功创建课程后才会移除），刷新页面即可重新生成
    const canRetry = !!sessionStorage.getItem('pendingOutline');
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
            <div className="flex flex-col items-center gap-3">
              {canRetry && (
                <button
                  onClick={() => window.location.reload()}
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white shadow-[0_4px_16px_rgba(255,138,0,0.20)] transition-all hover:shadow-[0_6px_20px_rgba(255,138,0,0.25)] active:scale-[0.985]"
                >
                  重新生成
                </button>
              )}
              <button
                onClick={() => router.push('/')}
                className={canRetry
                  ? 'text-sm text-secondary underline-offset-4 transition-colors hover:underline'
                  : 'inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white shadow-[0_4px_16px_rgba(255,138,0,0.20)] transition-all hover:shadow-[0_6px_20px_rgba(255,138,0,0.25)] active:scale-[0.985]'
                }
              >
                返回首页
              </button>
            </div>
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
        {/* Loading 层 */}
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

        {/* 流式内容层 */}
        <motion.div
          animate={{ opacity: hasContent ? 1 : 0 }}
          transition={{ duration: 0.3, delay: hasContent ? 0.2 : 0 }}
          className="absolute inset-0 overflow-y-auto pt-[88px] px-5 pb-8"
          style={{ paddingBottom: isComplete ? '80px' : undefined }}
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

            {/* 章节列表 — 逐个流式出现 */}
            <div className="space-y-3">
              {streamNodes.map((node, idx) => (
                <motion.div
                  key={node.index}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="flex items-center gap-3 rounded-xl bg-white/70 px-4 py-3.5"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                    <span className="text-[13px] font-bold text-accent">{idx + 1}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-[15px] font-semibold text-primary">{node.title}</h4>
                    {node.description && (
                      <p className="mt-0.5 text-[13px] text-secondary/70 line-clamp-2">{node.description}</p>
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
          </div>
        </motion.div>

        {/* 底部悬浮跳转提示条 */}
        {isComplete && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-0 left-0 right-0 z-10 px-5 pb-6 pt-3 bg-gradient-to-t from-background via-background/95 to-transparent"
          >
            <div className="mx-auto max-w-sm">
              <div className="flex items-center justify-between rounded-2xl bg-white/90 border border-black/6 px-4 py-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <svg className="h-4.5 w-4.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-[13px] font-medium text-primary">课程规划完成</span>
                </div>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/12">
                  <span className="text-[13px] font-bold text-accent">{countdown}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
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
