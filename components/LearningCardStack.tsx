'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LearningCard } from './LearningCard';
import { LearningCard as LearningCardType } from '@/types/course';
import { ProgressBar } from './ui/ProgressBar';

interface LearningCardStackProps {
  cards: LearningCardType[];
  onComplete: () => void;
}

export function LearningCardStack({ cards, onComplete }: LearningCardStackProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  const currentCard = cards[currentIndex];
  const isLastCard = currentIndex === cards.length - 1;

  const handleNext = () => {
    if (isLastCard) {
      onComplete();
    } else {
      setDirection(1);
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex(prev => prev - 1);
    }
  };

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir < 0 ? 300 : -300,
      opacity: 0,
    }),
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* 进度 */}
      <div className="mb-4">
        <ProgressBar current={currentIndex + 1} total={cards.length} />
      </div>

      {/* 卡片区域 */}
      <div className="relative h-[400px] mb-4">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="absolute inset-0"
          >
            <LearningCard card={currentCard} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 导航按钮 */}
      <div className="flex justify-between">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="px-6 py-2 rounded-full border border-gray-300 disabled:opacity-40"
        >
          ← 上一张
        </button>
        <button
          onClick={handleNext}
          className="px-6 py-2 rounded-full bg-blue-500 text-white disabled:opacity-40"
        >
          {isLastCard ? '开始测验 →' : '下一张 →'}
        </button>
      </div>
    </div>
  );
}