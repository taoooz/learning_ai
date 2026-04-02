'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';

interface RecommendedCourse {
  title: string;
  reason: string;
}

interface RecommendationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: any;
  existingCourses: string[];
}

export function RecommendationsModal({ isOpen, onClose, userProfile, existingCourses }: RecommendationsModalProps) {
  const router = useRouter();
  const [recommendations, setRecommendations] = useState<RecommendedCourse[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // 尝试从缓存加载
    const cacheKey = getCacheKey(userProfile, existingCourses);
    const cached = localStorage.getItem(`recs_${cacheKey}`);
    
    if (cached) {
      setRecommendations(JSON.parse(cached));
    } else {
      generateRecommendations();
    }
  }, [isOpen]);

  const getCacheKey = (profile: any, courses: string[]) => {
    const data = JSON.stringify({
      targetJob: profile?.targetJob || '',
      coursesCount: courses.length,
    });
    return btoa(data).slice(0, 20);
  };

  const generateRecommendations = async () => {
    setIsLoading(true);
    try {
      // 构建精简的上下文
      const context = {
        targetJob: userProfile?.targetJob || '技术岗位',
        existingTopics: existingCourses.slice(0, 3), // 只传最近3个
      };

      // 调用 API 生成推荐
      const response = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });

      if (!response.ok) throw new Error('Failed to generate');

      const data = await response.json();
      setRecommendations(data.recommendations || []);

      // 缓存结果
      const cacheKey = getCacheKey(userProfile, existingCourses);
      localStorage.setItem(`recs_${cacheKey}`, JSON.stringify(data.recommendations));
    } catch (error) {
      console.error('Failed to generate recommendations:', error);
      // 降级：使用默认推荐
      setRecommendations([
        { title: 'AI 产品经理入门', reason: '适合想转型 AI 领域的产品经理' },
        { title: 'Python 数据分析基础', reason: '掌握数据分析的基本技能' },
        { title: 'LLM 应用开发实战', reason: '学习如何开发 AI 应用' },
        { title: '提示词工程进阶', reason: '提升与 AI 交互的效率' },
        { title: 'Agent 技术原理', reason: '深入理解 AI Agent 的工作机制' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectCourse = (course: RecommendedCourse) => {
    const topic = `${course.title}。${course.reason}`;
    router.push(`/generate/chat?topic=${encodeURIComponent(topic)}`);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />

          {/* 浮窗 */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[67vh] flex-col rounded-t-[32px] bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.12)]"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4">
              <div>
                <h2 className="text-[20px] font-bold text-primary">为你推荐</h2>
                <p className="mt-0.5 text-sm text-secondary">基于你的目标和学习记录</p>
              </div>
              <button
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-full text-tertiary transition-colors hover:bg-black/[0.04] hover:text-primary"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-24 animate-pulse rounded-[20px] bg-black/[0.04]" />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {recommendations.map((course, index) => (
                    <motion.button
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      onClick={() => handleSelectCourse(course)}
                      className="w-full rounded-[20px] border-2 border-black/[0.06] bg-white p-4 text-left transition-all duration-150 hover:border-accent/40 hover:shadow-[0_4px_16px_rgba(255,138,0,0.12)] active:scale-[0.985]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
                          <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-[15px] font-semibold text-primary">{course.title}</h3>
                          <p className="mt-1 text-sm text-secondary line-clamp-2">{course.reason}</p>
                        </div>
                        <svg className="h-5 w-5 shrink-0 text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </motion.button>
                  ))}
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="border-t border-black/[0.06] px-6 py-4">
              <button
                onClick={generateRecommendations}
                disabled={isLoading}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-black/[0.08] bg-white px-6 py-3 text-[15px] font-semibold text-primary transition-all duration-150 hover:border-accent/40 hover:bg-accent/5 active:scale-[0.985] disabled:opacity-40"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                换一批
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
