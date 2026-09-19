'use client';

// components/learning-v2/CheckpointCard.tsx
// P3a 结构化理解检查卡：scenario_choice（单选）/ sequence（排序）两种题型
// - 渲染题目 + 选项（radio）/ 排序项（上下移动按钮调整顺序）
// - 提交后展示评估结果（正确/错误 + 反馈 + 正确答案）
// - 首次错误 → remediate_here（显示补救提示 + 重试按钮）；二次错误 → continue（标记需巩固）

import { useState } from 'react';
import type { CheckpointDefinition, CheckpointEvaluation } from '@/types/learning-v2';

interface CheckpointCardProps {
  checkpoint: CheckpointDefinition;
  evaluation?: CheckpointEvaluation;
  onSubmit: (answer: string | string[]) => void;
  onRetry: () => void;
  disabled?: boolean;
}

export function CheckpointCard({ checkpoint, evaluation, onSubmit, onRetry, disabled }: CheckpointCardProps) {
  const [selected, setSelected] = useState<string>('');
  const [order, setOrder] = useState<string[]>(() =>
    checkpoint.kind === 'sequence' && checkpoint.sequenceItems
      ? checkpoint.sequenceItems.map((item) => item.id)
      : []
  );

  const hasResult = !!evaluation;
  const canSubmit = !disabled && !hasResult && (
    checkpoint.kind === 'scenario_choice' ? !!selected : order.length > 0
  );

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(checkpoint.kind === 'scenario_choice' ? selected : order);
  };

  const idToText = (id: string) => {
    if (checkpoint.kind === 'scenario_choice') return checkpoint.options?.find((o) => o.id === id)?.text ?? id;
    return checkpoint.sequenceItems?.find((s) => s.id === id)?.text ?? id;
  };

  return (
    <div className="my-4 rounded-2xl border border-accent/20 bg-surface p-4 shadow-sm" data-checkpoint-id={checkpoint.checkpointId}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent">理解检查</p>
      <p className="mb-4 text-[14px] font-medium leading-relaxed text-primary">{checkpoint.prompt}</p>

      {/* scenario_choice：单选 */}
      {checkpoint.kind === 'scenario_choice' && checkpoint.options && !hasResult && (
        <div className="space-y-2">
          {checkpoint.options.map((option) => (
            <label
              key={option.id}
              className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-[13px] leading-relaxed transition-colors ${
                selected === option.id ? 'border-accent bg-accent/8' : 'border-black/8 hover:bg-black/3'
              }`}
            >
              <input
                type="radio"
                name={`cp-${checkpoint.checkpointId}`}
                value={option.id}
                checked={selected === option.id}
                onChange={() => setSelected(option.id)}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>{option.text}</span>
            </label>
          ))}
        </div>
      )}

      {/* sequence：排序 */}
      {checkpoint.kind === 'sequence' && checkpoint.sequenceItems && !hasResult && (
        <div className="space-y-2">
          {order.map((id, index) => (
            <div key={id} className="flex items-center gap-2 rounded-xl border border-black/8 p-3 text-[13px]">
              <span className="w-5 shrink-0 text-center font-semibold text-accent">{index + 1}</span>
              <span className="flex-1">{idToText(id)}</span>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => handleMove(index, -1)} disabled={index === 0}
                  className="rounded p-1 text-tertiary hover:bg-black/5 disabled:opacity-30" aria-label="上移">↑</button>
                <button type="button" onClick={() => handleMove(index, 1)} disabled={index === order.length - 1}
                  className="rounded p-1 text-tertiary hover:bg-black/5 disabled:opacity-30" aria-label="下移">↓</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 提交按钮 */}
      {!hasResult && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="mt-4 w-full rounded-full bg-accent py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:bg-accent/40"
        >
          提交答案
        </button>
      )}

      {/* 评估结果 */}
      {hasResult && evaluation && (
        <div className={`rounded-xl p-3 text-[13px] leading-relaxed ${evaluation.correct ? 'bg-green-50 text-green-800' : 'bg-orange-50 text-orange-800'}`}>
          <p className="mb-1 font-semibold">{evaluation.correct ? '✓ 回答正确' : '✗ 回答不正确'}</p>
          <p>{evaluation.feedback}</p>
          {!evaluation.correct && evaluation.correctAnswer && (
            <p className="mt-2 text-[12px]">
              正确答案：{Array.isArray(evaluation.correctAnswer) ? evaluation.correctAnswer.map(idToText).join(' → ') : idToText(evaluation.correctAnswer)}
            </p>
          )}
          {evaluation.nextAction === 'remediate_here' && (
            <button type="button" onClick={onRetry}
              className="mt-3 rounded-full bg-orange-600 px-4 py-1.5 text-[12px] font-semibold text-white hover:opacity-90">
              再试一次
            </button>
          )}
        </div>
      )}
    </div>
  );
}
