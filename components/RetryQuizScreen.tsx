'use client';

import type { Question } from '@/types/course';

interface RetryQuizScreenProps {
  wrongQuestions: Question[];
  onRetry: () => void;
  onSkip: () => void;
}

export function RetryQuizScreen({ wrongQuestions, onRetry, onSkip }: RetryQuizScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <h2 className="text-2xl font-bold mb-4">还有 {wrongQuestions.length} 道题需要再练习</h2>
      <p className="text-secondary mb-8">别担心，再试一次你会做得更好！</p>
      <button onClick={onRetry} className="bg-primary text-white rounded-xl px-8 py-3">
        重新作答
      </button>
      <button onClick={onSkip} className="mt-4 text-secondary">
        先跳过
      </button>
    </div>
  );
}