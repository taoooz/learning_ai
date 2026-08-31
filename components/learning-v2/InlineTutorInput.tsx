'use client';

// components/learning-v2/InlineTutorInput.tsx
// P2 流内答疑输入框（设计文档 §4）：章节页常驻轻量输入，属于学习页而非 ChatWidget 浮层
// - 受控 textarea：提交前 trim，空问题不提交；提交后清空输入，学习流条目与忙闲/排队提示行提供可见反馈
// - Enter 提交、Shift+Enter 换行；中文输入法组词期间（isComposing）Enter 不提交
// - 触摸区域至少 44px（输入区与提交按钮均满足）
// - tutorPlaceholder(phase) 为可测纯函数：边界提问直接回答，其余相位提交将排队（§3.3/§4）

import type { KeyboardEvent } from 'react';
import type { ChapterPhaseName } from '@/lib/learning-v2/tutor-orchestration';

/** 输入框占位文案：边界可直接提问；其余相位提交后先排队（测试锁定，勿改） */
export function tutorPlaceholder(phase: ChapterPhaseName): string {
  if (phase === 'boundary') return '针对本节内容提问…';
  if (phase === 'completing') return '本章正在收尾…';
  return '本节生成完成后回答你的问题…';
}

/** 忙闲/排队提示行文案：忙碌时播报回答进度与队列长度，空闲时播报排队数 */
function tutorHint(busy: boolean, queuedCount: number): string | null {
  if (busy) {
    // queuedCount（未回答问题数）包含正在回答的一题，其余为排队
    const waiting = queuedCount - 1;
    return waiting > 0 ? `正在回答中，还有 ${waiting} 个问题排队` : '正在回答中…';
  }
  if (queuedCount > 0) return `${queuedCount} 个问题排队中`;
  return null;
}

interface InlineTutorInputProps {
  /** 受控输入值（草稿由宿主持有，章节切换随页面重建清空） */
  value: string;
  onChange: (next: string) => void;
  /** 提交已 trim 的非空问题；宿主接 submitTutorQuestion */
  onSubmit: (text: string) => void;
  placeholder?: string;
  /** completing 等不宜受理提问的相位禁用；忙碌不禁用（提交即排队，§3.3） */
  disabled?: boolean;
  /** 未回答问题数（含回答中），来自 tutorState.pendingCount */
  queuedCount: number;
  /** Tutor 请求在途或回答流式中 */
  busy: boolean;
}

export function InlineTutorInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  queuedCount,
  busy,
}: InlineTutorInputProps) {
  const handleSubmit = () => {
    if (disabled) return;
    const text = value.trim();
    if (!text) return; // 空问题不提交
    onChange(''); // 提交即清空；可见反馈由学习流问题条目与下方提示行承接
    onSubmit(text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法组词中的 Enter 用于确认候选词，不触发提交
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    handleSubmit();
  };

  const hint = tutorHint(busy, queuedCount);

  return (
    <div className="mt-4">
      <div
        className={`flex items-end gap-2 rounded-2xl border border-black/6 bg-surface p-2 shadow-sm ${
          disabled ? 'opacity-60' : ''
        }`}
      >
        <label htmlFor="inline-tutor-input" className="sr-only">
          针对本节内容提问
        </label>
        <textarea
          id="inline-tutor-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="max-h-28 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[14px] leading-relaxed text-primary outline-none placeholder:text-tertiary disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || value.trim().length === 0}
          className="h-11 shrink-0 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:bg-accent/40"
        >
          提问
        </button>
      </div>
      {hint && (
        <p role="status" className="mt-2 px-1 text-[12px] text-tertiary">
          {hint}
        </p>
      )}
    </div>
  );
}
