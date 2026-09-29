'use client';

// components/learning-v2/InlineTutorInput.tsx
// P2 流内答疑输入框（设计文档 §4）：章节页常驻轻量输入，属于学习页而非 ChatWidget 浮层
// - 受控 textarea：提交前 trim，空问题不提交；提交后清空输入，学习流条目与忙闲/排队提示行提供可见反馈
// - Enter 提交、Shift+Enter 换行；中文输入法组词期间（isComposing）Enter 不提交
// - 触摸区域至少 44px（输入区与提交按钮均满足）
// - tutorPlaceholder(phase) 为可测纯函数：边界提问直接回答，其余相位提交将排队（§3.3/§4）

import { motion } from 'framer-motion';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { AssistantGlyph } from '../ui/chat/AssistantGlyph';
import type { ChapterPhaseName } from '@/lib/learning-v2/tutor-orchestration';

/** 输入框占位文案：边界可直接提问；其余相位提交后先排队（测试锁定，勿改） */
export function tutorPlaceholder(phase: ChapterPhaseName): string {
  if (phase === 'boundary') return '针对本节内容提问…';
  if (phase === 'completing') return '本章正在收尾…';
  return '本节生成完成后回答你的问题…';
}

/** 快捷动作按钮：预置问题文本，模型据此分类意图（§2.6.2） */
const QUICK_ACTIONS = [
  { label: '举个例子', question: '请举一个具体例子帮助理解' },
  { label: '换个讲法', question: '请换一种方式讲解这个概念' },
] as const;

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 聚焦本身不滚动页面。软键盘打开后，仅当输入框确实被压缩后的可视区域遮挡时才滚动。
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;

    const checkOcclusion = () => {
      const visualViewport = window.visualViewport;
      const rect = element.getBoundingClientRect();
      const visibleTop = visualViewport?.offsetTop ?? 0;
      const visibleBottom = visibleTop + (visualViewport?.height ?? window.innerHeight);
      if (rect.bottom > visibleBottom + 8 || rect.top < visibleTop - 8) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };

    const handleFocus = () => {
      // focus 时键盘通常尚未完全打开；分帧检查，避免用固定比例误判。
      window.requestAnimationFrame(checkOcclusion);
      window.setTimeout(checkOcclusion, 250);
      window.setTimeout(checkOcclusion, 600);
    };

    element.addEventListener('focus', handleFocus);
    window.visualViewport?.addEventListener('resize', checkOcclusion);
    return () => {
      element.removeEventListener('focus', handleFocus);
      window.visualViewport?.removeEventListener('resize', checkOcclusion);
    };
  }, []);

  const handleSubmit = (text?: string) => {
    if (disabled) return;
    const trimmed = (text ?? value).trim();
    if (!trimmed) return; // 空问题不提交
    onChange(''); // 提交即清空；可见反馈由学习流问题条目与下方提示行承接
    onSubmit(trimmed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法组词中的 Enter 用于确认候选词，不触发提交
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    handleSubmit();
  };

  const hint = tutorHint(busy, queuedCount);

  return (
    <div className="relative mt-5">
      <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[radial-gradient(circle_at_24%_18%,rgba(152,184,232,0.13),rgba(152,184,232,0)_48%),radial-gradient(circle_at_78%_80%,rgba(127,191,195,0.12),rgba(127,191,195,0)_52%)]" />
      <div
        className={`relative flex items-end gap-2 rounded-[22px] border bg-white/90 p-2 shadow-[0_8px_24px_rgba(15,23,42,0.05)] backdrop-blur-sm transition-colors ${
          disabled
            ? 'border-black/[0.05] opacity-60'
            : 'border-black/[0.06] focus-within:border-[rgba(127,191,195,0.42)] focus-within:shadow-[0_10px_28px_rgba(127,191,195,0.14)]'
        }`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(221,232,246,0.72))] shadow-[0_8px_16px_rgba(127,191,195,0.12)]">
          <AssistantGlyph className="h-5 w-5" />
        </span>
        <label htmlFor="inline-tutor-input" className="sr-only">
          针对本节内容提问
        </label>
        <textarea
          ref={textareaRef}
          id="inline-tutor-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? '哪里卡住了，直接问我'}
          disabled={disabled}
          rows={1}
          className="max-h-28 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[14px] leading-relaxed text-primary outline-none placeholder:text-secondary/70 disabled:cursor-not-allowed"
        />
        <motion.button
          type="button"
          onClick={() => handleSubmit()}
          whileHover={disabled || !value.trim() ? undefined : { y: -1 }}
          whileTap={disabled || !value.trim() ? undefined : { y: 1, scale: 0.98 }}
          disabled={disabled || value.trim().length === 0}
          className="inline-flex h-11 min-w-[76px] shrink-0 items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#98B8E8,#7FBFC3)] px-4 text-[14px] font-semibold text-white shadow-[0_10px_20px_rgba(127,191,195,0.20)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? '思考中' : '发送'}
        </motion.button>
      </div>
      {hint && (
        <p role="status" className="mt-2 px-1 text-[12px] text-tertiary">
          {hint}
        </p>
      )}
    </div>
  );
}
