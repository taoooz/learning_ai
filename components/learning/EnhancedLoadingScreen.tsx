'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface LoadingStage {
  id: string;
  label: string;
  icon: React.ReactNode;
  tips: string[];
}

const STAGES: LoadingStage[] = [
  {
    id: 'analyze',
    label: '分析学习目标',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
    tips: ['根据你的水平定制内容难度', '参考之前的学习记录', '识别关键知识点'],
  },
  {
    id: 'cards',
    label: '生成知识卡片',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    tips: ['用你容易理解的方式讲解', '结合实际例子和场景', '补充可视化图表'],
  },
  {
    id: 'questions',
    label: '设计练习题',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    tips: ['覆盖不同认知维度', '匹配你的当前水平', '出有挑战性的干扰项'],
  },
  {
    id: 'optimize',
    label: '优化学习体验',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    tips: ['校验内容准确性', '确保题目没有歧义', '最后整理一下格式'],
  },
];

/** 基于时间的进度估算：4 阶段，每阶段有预估时长 */
const STAGE_DURATIONS = [3000, 6000, 7000, 4000]; // ms
const TOTAL_DURATION = STAGE_DURATIONS.reduce((a, b) => a + b, 0);

function getStageInfo(elapsed: number): { activeIndex: number; progress: number; remaining: number } {
  let accumulated = 0;
  for (let i = 0; i < STAGES.length; i++) {
    const next = accumulated + STAGE_DURATIONS[i];
    if (elapsed < next) {
      const stageProgress = (elapsed - accumulated) / STAGE_DURATIONS[i];
      return {
        activeIndex: i,
        progress: stageProgress,
        remaining: Math.ceil((TOTAL_DURATION - elapsed) / 1000),
      };
    }
    accumulated = next;
  }
  return { activeIndex: STAGES.length - 1, progress: 1, remaining: 0 };
}

export function EnhancedLoadingScreen() {
  const [elapsed, setElapsed] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // 每 4 秒换一条提示
  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((prev) => prev + 1);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const { activeIndex, progress, remaining } = getStageInfo(elapsed);
  const overallProgress = Math.min(elapsed / TOTAL_DURATION, 0.95);

  const activeStage = STAGES[activeIndex];

  // 从所有阶段中按顺序循环取 tip
  const allTips = useMemo(() => STAGES.flatMap((s) => s.tips), []);
  const currentTip = allTips[tipIndex % allTips.length];

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center text-center px-6">
      {/* 顶部图标 */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 via-accent/10 to-accent/5 shadow-[0_8px_24px_rgba(255,138,0,0.12)]"
      >
        <motion.svg
          className="w-10 h-10 text-accent"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          animate={{ rotate: [0, 5, -5, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </motion.svg>
      </motion.div>

      {/* 标题和总进度 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
      >
        <h3 className="mb-3 text-[22px] font-bold text-primary">正在为你准备内容</h3>
        <p className="mb-2 text-[15px] leading-relaxed text-secondary">
          AI 正在生成这一节的学习材料和练习题
        </p>
        {remaining > 0 && (
          <p className="text-xs text-tertiary">
            预计还需 {remaining} 秒
          </p>
        )}
      </motion.div>

      {/* 总进度条 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.4 }}
        className="mt-5 w-full max-w-xs"
      >
        <div className="h-1.5 w-full rounded-full bg-black/[0.06] overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-accent"
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress * 100}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      </motion.div>

      {/* 阶段列表 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.6 }}
        className="mt-6 w-full max-w-xs space-y-2.5"
      >
        {STAGES.map((stage, index) => {
          const isActive = index === activeIndex;
          const isDone = index < activeIndex;

          return (
            <motion.div
              key={stage.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.8 + index * 0.3 }}
              className={`
                flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-300
                ${isActive ? 'bg-white/80 shadow-sm' : isDone ? 'bg-white/40' : 'bg-white/20'}
              `}
            >
              <div className={`
                flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-300
                ${isDone ? 'bg-success/15 text-success' : isActive ? 'bg-accent/10 text-accent' : 'bg-black/[0.04] text-tertiary'}
              `}>
                {isDone ? (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : stage.icon}
              </div>
              <span className={`
                flex-1 text-left text-sm transition-colors duration-300
                ${isDone ? 'text-success font-medium' : isActive ? 'text-primary font-medium' : 'text-tertiary'}
              `}>
                {stage.label}
              </span>
              {isActive && (
                <div className="h-4 w-4">
                  <svg className="h-4 w-4 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              )}
              {isDone && (
                <span className="text-xs text-success">完成</span>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      {/* 底部趣味提示 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 2 }}
        className="mt-6 w-full max-w-xs"
      >
        <AnimatePresence mode="wait">
          <motion.p
            key={tipIndex}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className="text-xs text-tertiary"
          >
            {currentTip}
          </motion.p>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
