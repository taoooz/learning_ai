'use client';

import { useMemo, useState } from 'react';

interface ClarificationItem {
  id: string;
  question: string;
  answer: string;
}

interface ClarificationScreenProps {
  questions: ClarificationItem[];
  onChange: (id: string, value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting?: boolean;
  canSubmit: boolean;
}

export function ClarificationScreen({
  questions,
  onChange,
  onSubmit,
  onBack,
  isSubmitting = false,
  canSubmit,
}: ClarificationScreenProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;
  const isLastQuestion = currentIndex === totalQuestions - 1;
  const currentAnswered = currentQuestion?.answer.trim().length > 0;

  const helperText = useMemo(() => {
    if (totalQuestions <= 0) return '回答几个问题后，我会继续生成专属于你的课程结构和学习内容。';
    return `回答 ${totalQuestions} 个问题后，我会继续生成专属于你的课程结构和学习内容。`;
  }, [totalQuestions]);

  const handleNext = () => {
    if (!currentAnswered) return;
    if (isLastQuestion) {
      onSubmit();
      return;
    }

    setCurrentIndex((prev) => Math.min(prev + 1, totalQuestions - 1));
  };

  const handlePrevQuestion = () => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  };

  return (
    <main className="relative min-h-[100svh] overflow-x-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 right-[-8rem] h-80 w-80 rounded-full bg-gradient-to-br from-accent/16 via-accent/8 to-transparent blur-3xl" />
        <div className="absolute left-[-5rem] top-20 h-64 w-64 rounded-full bg-gradient-to-br from-sky-400/16 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-[-7rem] left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-gradient-to-br from-amber-200/12 to-transparent blur-3xl" />
      </div>

      <div
        className="relative mx-auto flex w-full max-w-2xl flex-col px-6 pt-5 sm:px-8"
        style={{
          minHeight: '100svh',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="mb-6 flex justify-start self-stretch">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/70 bg-surface/88 px-3.5 text-sm font-medium text-secondary shadow-[0_6px_16px_rgba(15,23,42,0.05)] backdrop-blur-md transition-colors hover:bg-surface"
            aria-label="返回"
          >
            <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>返回</span>
          </button>
        </div>

        <div className="flex flex-1 flex-col">
          <div className="w-full max-w-xl">
            <div className="mb-6">
              <h1 className="text-[30px] font-semibold tracking-tight text-primary sm:text-[34px]">
                我希望这门课更适合你
              </h1>
              <p className="mt-3 max-w-xl text-[15px] leading-7 text-secondary">
                {helperText}
              </p>
            </div>

            {currentQuestion && (
              <div className="relative overflow-hidden rounded-[34px] border border-white/82 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(255,248,241,0.98)_58%,rgba(255,255,255,0.95))] px-5 py-5 shadow-[0_22px_56px_rgba(15,23,42,0.08)] sm:px-6 sm:py-6">
                <div
                  className="pointer-events-none absolute left-0 top-0 h-36 w-44 opacity-36"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, rgba(56,189,248,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.11) 1px, transparent 1px)',
                    backgroundSize: '18px 18px',
                    maskImage: 'radial-gradient(circle at 25% 18%, black 0%, rgba(0,0,0,0.86) 32%, transparent 80%)',
                    WebkitMaskImage: 'radial-gradient(circle at 25% 18%, black 0%, rgba(0,0,0,0.86) 32%, transparent 80%)',
                  }}
                />

                <div className="relative z-[1]">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="rounded-full bg-[#ECEEEC] px-3 py-1 text-xs font-medium text-secondary">
                      问题 {currentIndex + 1}
                    </div>
                  </div>

                  <label className="block text-[16px] font-medium leading-7 text-primary">
                    {currentQuestion.question}
                  </label>

                  <textarea
                    value={currentQuestion.answer}
                    onChange={(e) => onChange(currentQuestion.id, e.target.value)}
                    placeholder="写下你的情况，我会据此继续优化课程"
                    className="mt-4 w-full resize-none rounded-[20px] border border-black/6 bg-background/82 px-4 py-3 text-[15px] leading-7 text-primary outline-none transition-all duration-150 placeholder:text-secondary/55 focus:border-accent/22 focus:bg-white"
                    rows={4}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mt-auto w-full max-w-xl pt-4">
            <div className="flex items-center gap-3">
              {currentIndex > 0 && (
                <button
                  onClick={handlePrevQuestion}
                  className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full border border-black/8 bg-white/76 px-5 text-sm font-medium text-secondary transition-all duration-150 active:scale-[0.985]"
                >
                  上一步
                </button>
              )}

              <button
                onClick={handleNext}
                disabled={isSubmitting || !currentAnswered || (isLastQuestion && !canSubmit)}
                className="inline-flex min-h-13 flex-1 items-center justify-center rounded-full bg-cta px-6 py-3 text-sm font-semibold text-cta shadow-[0_10px_24px_rgba(17,24,39,0.10)] transition-all duration-150 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isLastQuestion
                  ? (isSubmitting ? '继续生成中...' : '继续生成课程')
                  : '下一步'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
