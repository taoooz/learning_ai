'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ClarificationAnswer, ClarificationQuestion } from '@/types/outline';

const DEFAULT_OPTIONS = ['还没有实际接触', '了解概念但缺少实践', '参与过实际工作', '能独立负责并希望系统提升'];

type ClarificationFormProps = {
  questions: ClarificationQuestion[];
  onSubmit: (answers: ClarificationAnswer[]) => void;
  disabled?: boolean;
  /** 后续问题仍在后台生成，此时只允许作答，不允许最终提交。 */
  streaming?: boolean;
};

export function ClarificationForm({
  questions,
  onSubmit,
  disabled = false,
  streaming = false,
}: ClarificationFormProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const current = questions[activeIndex];
  const currentOptions = current?.options?.length ? current.options : DEFAULT_OPTIONS;
  const allAnswered = useMemo(
    () => questions.every((question) => answers[question.id]?.trim()),
    [answers, questions],
  );
  const progress = questions.length > 0 ? ((activeIndex + 1) / questions.length) * 100 : 0;

  // 新题到达时，如果当前题已答，自动进入下一道未答选择题。
  useEffect(() => {
    if (!current || !answers[current.id]?.trim()) return;
    const nextIndex = questions.findIndex(
      (question, index) => index > activeIndex && !answers[question.id]?.trim(),
    );
    if (nextIndex >= 0) setActiveIndex(nextIndex);
  }, [activeIndex, answers, current, questions]);

  if (!current) return null;

  const choose = (value: string) => {
    setAnswers((previous) => ({ ...previous, [current.id]: value }));
    if (activeIndex < questions.length - 1) {
      setActiveIndex(activeIndex + 1);
    }
  };

  const submit = () => {
    if (!allAnswered || disabled || streaming || submitted) return;
    setSubmitted(true);
    onSubmit(questions.map((question) => ({
      questionId: question.id,
      answer: answers[question.id].trim(),
    })));
  };

  const readyToSubmit = allAnswered && !streaming;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[rgba(0,0,0,0.06)] bg-surface px-4 py-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-accent">
            澄清问题 {activeIndex + 1} / {questions.length}
          </span>
          <span className="text-[12px] text-tertiary">
            {streaming ? '正在准备后续问题…' : allAnswered ? '可以提交了' : '请逐题完成，最后一起提交'}
          </span>
        </div>
        <div className="mb-4 h-1 overflow-hidden rounded-full bg-black/[0.04]">
          <div className="h-full rounded-full bg-accent/60 transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>

        <p className="text-[15px] font-medium leading-relaxed text-primary">{current.question}</p>

        <div className="mt-3 space-y-2">
          {currentOptions.map((option, index) => {
            const selected = answers[current.id] === option;
            return (
              <button
                key={`${current.id}-${index}`}
                type="button"
                onClick={() => choose(option)}
                disabled={disabled || submitted}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  selected
                    ? 'border-accent/40 bg-accent/[0.06] text-primary'
                    : 'border-black/[0.06] bg-white/70 text-secondary hover:border-accent/20'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="mr-2 text-[12px] font-semibold text-accent">{String.fromCharCode(65 + index)}.</span>
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
          disabled={activeIndex === 0 || disabled || submitted}
          className="rounded-full border border-black/[0.08] px-4 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
        >
          上一题
        </button>

        <button
          type="button"
          onClick={submit}
          disabled={!readyToSubmit || disabled || submitted}
          className="rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitted ? '已提交，正在生成…' : streaming ? '等待后续问题…' : '提交并生成课程纲要'}
        </button>
      </div>
    </div>
  );
}
