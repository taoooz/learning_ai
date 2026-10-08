'use client';

// components/learning-v2/CheckpointCard.tsx
// P3a 结构化理解检查卡：scenario_choice（单选）/ sequence（排序）两种题型
// - 渲染题目 + 选项（radio）/ 排序项（上下移动按钮调整顺序）
// - 提交后展示评估结果（正确/错误 + 反馈 + 正确答案）
// - 首次错误 → remediate_here（显示补救提示 + 重试按钮）；二次错误 → continue（标记需巩固）

import { useState } from 'react';
import type { CheckpointDefinition, CheckpointEvaluation } from '@/types/learning-v2';
import { SourceRefsView } from './SourceRefsView';

interface CheckpointCardProps {
  checkpoint: CheckpointDefinition;
  evaluation?: CheckpointEvaluation;
  /** P3a：补救内容（§2.7 首次错误后展示） */
  remediationContent?: string;
  onSubmit: (answer: string | string[]) => void;
  onRetry: () => void;
  /** P3a：请求补救内容 + 等价新题（remediate_here 时由宿主传入） */
  onRequestRemediation?: () => void;
  /** 补救内容生成中 */
  remediating?: boolean;
  disabled?: boolean;
}

export function CheckpointCard({ checkpoint, evaluation, remediationContent, onSubmit, onRetry, onRequestRemediation, remediating, disabled }: CheckpointCardProps) {
  const [selected, setSelected] = useState<string>('');
  const [openAnswer, setOpenAnswer] = useState<string>('');
  const [order, setOrder] = useState<string[]>(() =>
    checkpoint.kind === 'sequence' && checkpoint.sequenceItems
      ? checkpoint.sequenceItems.map((item) => item.id)
      : []
  );

  const isOpenEnded = checkpoint.kind === 'self_explanation' || checkpoint.kind === 'micro_practice';
  const hasResult = !!evaluation;
  const canSubmit = !disabled && !hasResult && (
    checkpoint.kind === 'scenario_choice'
      ? !!selected
      : isOpenEnded
        ? openAnswer.trim().length >= 10
        : order.length > 0
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
    onSubmit(
      checkpoint.kind === 'scenario_choice'
        ? selected
        : isOpenEnded
          ? openAnswer.trim()
          : order,
    );
  };

  const idToText = (id: string) => {
    if (checkpoint.kind === 'scenario_choice') return checkpoint.options?.find((o) => o.id === id)?.text ?? id;
    return checkpoint.sequenceItems?.find((s) => s.id === id)?.text ?? id;
  };

  return (
    <section className="my-5 overflow-hidden rounded-3xl border border-accent/18 bg-surface shadow-card" data-checkpoint-id={checkpoint.checkpointId}>
      <div className="border-b border-black/[0.045] bg-accent/[0.045] px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">理解检查</p>
        </div>
        <p className="mt-2 text-[15px] font-semibold leading-[1.68] text-primary">{checkpoint.prompt}</p>
      </div>
      <div className="p-4">

      {/* scenario_choice：单选 */}
      {checkpoint.kind === 'scenario_choice' && checkpoint.options && !hasResult && (
        <div className="space-y-2">
          {checkpoint.options.map((option) => (
            <label
              key={option.id}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 text-[13px] leading-[1.68] transition-all duration-200 ${
                selected === option.id
                  ? 'border-[#FF8A00] bg-[rgba(255,138,0,0.07)]'
                  : 'border-black/[0.08] bg-surface hover:border-[rgba(255,138,0,0.35)] hover:bg-subtle/40'
              }`}
            >
              <input
                type="radio"
                name={`cp-${checkpoint.checkpointId}`}
                value={option.id}
                checked={selected === option.id}
                onChange={() => setSelected(option.id)}
                className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
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
            <div key={id} className="flex items-center gap-3 rounded-2xl border border-black/[0.08] bg-surface p-3.5 text-[13px] shadow-sm transition-colors hover:border-[rgba(255,138,0,0.35)]">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[rgba(255,138,0,0.10)] text-[11px] font-bold text-accent">{index + 1}</span>
              <span className="flex-1">{idToText(id)}</span>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => handleMove(index, -1)} disabled={index === 0}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-tertiary transition-colors hover:bg-black/[0.05] hover:text-primary disabled:opacity-30" aria-label="上移">↑</button>
                <button type="button" onClick={() => handleMove(index, 1)} disabled={index === order.length - 1}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-tertiary transition-colors hover:bg-black/[0.05] hover:text-primary disabled:opacity-30" aria-label="下移">↓</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 开放式题型：文本输入（P3b） */}
      {isOpenEnded && !hasResult && (
        <div>
          <label htmlFor={`cp-open-${checkpoint.checkpointId}`} className="sr-only">
            你的回答
          </label>
          <textarea
            id={`cp-open-${checkpoint.checkpointId}`}
            value={openAnswer}
            onChange={(event) => setOpenAnswer(event.target.value)}
            disabled={disabled}
            rows={3}
            placeholder="用自己的话回答（至少 10 个字）…"
            className="w-full resize-none rounded-2xl border border-black/[0.08] bg-surface p-3.5 text-[13px] leading-relaxed text-primary outline-none transition-colors placeholder:text-tertiary focus:border-accent disabled:opacity-60"
          />
          {checkpoint.rubric && (
            <p className="mt-2 text-[12px] leading-relaxed text-tertiary">
              提示：{checkpoint.rubric}
            </p>
          )}
        </div>
      )}

      {checkpoint.sourceRefs && checkpoint.sourceRefs.length > 0 && (
        <div className="mt-3">
          <SourceRefsView sources={checkpoint.sourceRefs} label="题目来源" />
        </div>
      )}

      {/* 提交按钮 */}
      {!hasResult && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="mt-5 w-full rounded-full bg-accent py-3 text-[14px] font-semibold text-primary transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent/20 active:translate-y-0 disabled:cursor-not-allowed disabled:translate-y-0 disabled:bg-accent/35 disabled:shadow-none"
        >
          {isOpenEnded ? '提交回答' : '提交答案'}
        </button>
      )}

      {/* 补救内容（§2.7：首次错误后 LLM 生成） */}
      {remediationContent && (
        <div className="mt-4 rounded-2xl border border-[rgba(255,138,0,0.2)] bg-[rgba(255,138,0,0.05)] p-3.5 text-[13px] leading-[1.7] text-primary">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-info">补救讲解</p>
          <p>{remediationContent}</p>
        </div>
      )}

      {/* 评估结果 */}
      {hasResult && evaluation && (
        <div className={`rounded-2xl border p-3.5 text-[13px] leading-[1.7] ${evaluation.correct ? 'border-[rgba(52,199,89,0.35)] bg-[rgba(52,199,89,0.08)] text-success' : 'border-[rgba(255,149,0,0.4)] bg-[rgba(255,149,0,0.08)] text-warning'}`}>
          <p className="mb-1 font-semibold">{evaluation.correct ? '✓ 回答正确' : '✗ 回答不正确'}</p>
          <p>{evaluation.feedback}</p>
          {!evaluation.correct && evaluation.correctAnswer && (
            <p className="mt-2 text-[12px]">
              正确答案：{Array.isArray(evaluation.correctAnswer) ? evaluation.correctAnswer.map(idToText).join(' → ') : idToText(evaluation.correctAnswer)}
            </p>
          )}
          {evaluation.nextAction === 'remediate_here' && (
            <button
              type="button"
              onClick={onRequestRemediation ?? onRetry}
              disabled={remediating}
              className="mt-3 rounded-full bg-warning px-4 py-2 text-[12px] font-semibold text-primary transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-warning/20 disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
            >
              {remediating ? '正在生成补救内容…' : '获取补救内容并重试'}
            </button>
          )}
        </div>
      )}
      </div>
    </section>
  );
}
