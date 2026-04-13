// components/CourseCelebrationSheet.tsx
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import type { CourseTree } from '@/types/course';
import { useStreak } from '@/hooks/useStreak';

interface CourseCelebrationSheetProps {
  isOpen: boolean;
  onClose: () => void;
  course: CourseTree;
}

export function CourseCelebrationSheet({ isOpen, onClose, course }: CourseCelebrationSheetProps) {
  const router = useRouter();
  const { streakData } = useStreak();

  const totalNodes = course.totalNodes || course.nodes.length;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />

          {/* Sheet */}
          <motion.div
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80) onClose();
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-[32px] bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.12)]"
          >
            {/* 拖拽指示条 */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-black/[0.12]" />
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* 庆祝图标 + 粒子 */}
              <div className="relative mt-2 mb-6 flex justify-center">
                {/* 粒子动效 */}
                <div className="absolute inset-0 flex items-center justify-center">
                  {[0, 1, 2, 3, 4].map(i => (
                    <span
                      key={i}
                      className="absolute h-2 w-2 rounded-full animate-confetti"
                      style={{
                        backgroundColor: ['#FF8A00', '#22C55E', '#3B82F6', '#F59E0B', '#EC4899'][i],
                        animationDelay: `${i * 0.15}s`,
                        '--confetti-x': `${(i - 2) * 24}px`,
                        '--confetti-y': `${-20 - i * 8}px`,
                      } as React.CSSProperties}
                    />
                  ))}
                </div>
                <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 via-orange-50 to-white shadow-[0_12px_32px_rgba(255,138,0,0.15)]">
                  <span className="text-4xl">🏆</span>
                </div>
              </div>

              {/* 标题 */}
              <h2 className="mb-6 text-center text-[22px] font-bold text-primary">
                恭喜完成课程！
              </h2>

              {/* 统计信息 */}
              <div className="mb-6 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-black/[0.03] p-4 text-center">
                  <p className="text-[24px] font-bold text-primary">{totalNodes}</p>
                  <p className="mt-0.5 text-[13px] text-secondary">章节完成</p>
                </div>
                <div className="rounded-2xl bg-black/[0.03] p-4 text-center">
                  <p className="text-[24px] font-bold text-primary">{streakData.currentStreak}</p>
                  <p className="mt-0.5 text-[13px] text-secondary">连续学习天数</p>
                </div>
              </div>

              {/* 课程名称 */}
              <div className="mb-6 rounded-2xl border border-black/[0.06] p-4">
                <p className="text-[12px] font-medium uppercase tracking-wider text-tertiary">已完成课程</p>
                <p className="mt-1 text-[15px] font-semibold text-primary">{course.topic}</p>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="border-t border-black/[0.06] px-6 py-4">
              <button
                onClick={() => {
                  onClose();
                  router.push('/');
                }}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-cta px-6 py-3 text-[15px] font-semibold text-cta shadow-[0_8px_24px_rgba(255,138,0,0.20)] transition-all duration-150 hover:shadow-[0_12px_32px_rgba(255,138,0,0.25)] active:scale-[0.985]"
              >
                回到首页
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
