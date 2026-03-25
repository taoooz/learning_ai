'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LearningCard } from './LearningCard';
import { LearningCard as LearningCardType } from '@/types/course';

interface LearningCardStackProps {
  cards: LearningCardType[];
  onComplete: () => void;
}

export function LearningCardStack({ cards, onComplete }: LearningCardStackProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentCard = cards[currentIndex];
  const isLastCard = currentIndex === cards.length - 1;

  const handleNext = () => {
    if (isLastCard) {
      onComplete();
    } else {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const progressPercent = ((currentIndex + 1) / cards.length) * 100;

  return (
    <div className="w-full">
      {/* 进度条 */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-secondary mb-1.5">
          <span>{currentIndex + 1}/{cards.length}</span>
        </div>
        <div className="w-full bg-subtle rounded-full h-1 overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 卡片 */}
      <div className="mb-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.15 }}
            className="min-h-[50vh]"
          >
            <LearningCard card={currentCard} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 导航按钮 */}
      <div className="flex justify-between items-center">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="px-4 py-2 rounded-xl border border-subtle text-secondary text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:border-accent/50 transition-all"
        >
          ←
        </button>
        <button
          onClick={handleNext}
          className="px-5 py-2 rounded-xl bg-accent text-white text-sm font-medium active:scale-95 transition-all"
        >
          {isLastCard ? '开始测验 →' : '下一张 →'}
        </button>
      </div>
    </div>
  );
}