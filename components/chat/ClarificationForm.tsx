'use client';

import { useMemo, useState } from 'react';

import type { ClarificationAnswer, ClarificationQuestion } from '@/types/outline';

type ClarificationFormProps = {
  questions: ClarificationQuestion[];
  onSubmit: (answers: ClarificationAnswer[]) => void;
  disabled?: boolean;
};

export function ClarificationForm({ questions, onSubmit, disabled = false }: ClarificationFormProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const current = questions[activeIndex];
  const allAnswered = useMemo(
    () => questions.every((question) => answers[question.id]?.trim()),
    [answers, questions],
  );
  const progress = questions.length > 0 ? ((activeIndex + 1) / questions.length) * 100 : 0;

  if (!current) return null;

  const choose = (value: string) => {
    setAnswers((previous) => ({ ...previous, [current.id]: value }));
  };

  const submit = () => {
    if (!allAnswered || disabled || submitted) return;
    setSubmitted(true);
    onSubmit(questions.map((question) => ({
      questionId: question.id,
      answer: answers[question.id].trim(),
    })));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[rgba(0,0,0,0.06)] bg-surface px-4 py-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-accent">
            澄清问题 {activeIndex + 1} / {questions.length}
          </span>
          <span className="text-[12px] text-tertiary">
            {allAnswered ? '可以提交了' : '请逐题完成，最后一起提交'}
          </span>
        </div>
        <div className="mb-4 h-1 overflow-hidden rounded-full bg-black/[0.04]">
          <div className="h-full rounded-full bg-accent/60 transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>

        <p className="text-[15px] font-medium leading-relaxed text-primary">{current.question}</p>

        {(current.options?.length ?? 0) > 0 ? (
          <div className="mt-3 space-y-2">
            {current.options?.map((option, index) => {
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
        ) : (
          <textarea
            value={answers[current.id] || ''}
            onChange={(event) => choose(event.target.value)}
            disabled={disabled || submitted}
            rows={3}
            placeholder="请简要回答"
            className="mt-3 w-full resize-none rounded-xl border border-black/[0.08] bg-white/70 px-3.5 py-3 text-[14px] leading-relaxed text-primary outline-none transition-colors placeholder:text-tertiary focus:border-accent/40 disabled:opacity-60"
          />
        )}
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

        {activeIndex < questions.length - 1 ? (
          <button
            type="button"
            onClick={() => setActiveIndex((index) => Math.min(questions.length - 1, index + 1))}
            disabled={!answers[current.id]?.trim() || disabled || submitted}
            className="rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一题
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!allAnswered || disabled || submitted}
            className="rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitted ? '已提交，正在生成…' : '提交并生成课程纲要'}
          </button>
        )}
      </div>
    </div>
  );
}
