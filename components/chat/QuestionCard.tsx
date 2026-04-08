'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';

type QuestionCardProps = {
  question: string;
  options: string[];
  questionNumber: number;
  onSelect: (answer: string) => void;
  disabled: boolean;
  embedded?: boolean;
};

export function QuestionCard({
  question,
  options,
  questionNumber,
  onSelect,
  disabled,
  embedded = false,
}: QuestionCardProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const handleSelect = (option: string) => {
    if (disabled || selectedOption) return;
    setSelectedOption(option);
    onSelect(option);
  };

  if (!question) {
    // 流式渲染占位
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={embedded ? '' : 'flex justify-start'}
      >
        <div className={`flex items-center gap-2 ${embedded ? 'px-0 py-0' : 'rounded-2xl border border-[rgba(0,0,0,0.06)] bg-surface px-4 py-3'}`}>
          <div className="flex gap-1">
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
              className="h-2 w-2 rounded-full bg-accent/60"
            />
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
              className="h-2 w-2 rounded-full bg-accent/60"
            />
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
              className="h-2 w-2 rounded-full bg-accent/60"
            />
          </div>
          <span className="text-sm text-secondary">正在生成问题...</span>
        </div>
      </motion.div>
    );
  }

  // 如果已选择，不显示选项
  if (selectedOption) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={embedded ? '' : 'flex justify-start'}
      >
        <div className={embedded ? '' : 'rounded-2xl border border-[rgba(0,0,0,0.06)] bg-surface px-4 py-3'}>
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex h-5 items-center rounded-full bg-accent/12 px-2 text-xs font-medium text-accent">
              第 {questionNumber} 题
            </span>
          </div>
          <p className="text-[15px] leading-relaxed text-primary">{question}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={embedded ? '' : 'flex justify-start'}
    >
      <div className="space-y-3">
        {/* 问题文本 - Markdown 风格 */}
        <div className={embedded ? '' : 'rounded-2xl border border-[rgba(0,0,0,0.06)] bg-surface px-4 py-3'}>
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex h-5 items-center rounded-full bg-accent/12 px-2 text-xs font-medium text-accent">
              第 {questionNumber} 题
            </span>
          </div>
          <p className="text-[15px] leading-relaxed text-primary">{question}</p>
        </div>

        {/* 选项列表 - 独立 cell */}
        {options.length > 0 && (
          <div className={`space-y-2 ${embedded ? '' : 'pl-2'}`}>
            {options.map((option, idx) => {
              const optionLetter = String.fromCharCode(65 + idx);

              return (
                <motion.button
                  key={idx}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  onClick={() => handleSelect(option)}
                  disabled={disabled}
                  whileHover={!disabled ? { scale: 1.01 } : {}}
                  whileTap={!disabled ? { scale: 0.99 } : {}}
                  className={`w-full rounded-xl border p-3 text-left transition-all duration-200 ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  } border-[rgba(0,0,0,0.06)] bg-surface hover:border-accent/20 hover:bg-accent/[0.02]`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors bg-[rgba(0,0,0,0.04)] text-secondary">
                      {optionLetter}
                    </div>
                    <span className="text-[15px] text-[rgba(31,31,31,0.82)]">
                      {option}
                    </span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
