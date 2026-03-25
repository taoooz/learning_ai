'use client';

import { useState } from 'react';
import { CourseNode as CourseNodeType } from '@/types/course';

interface CourseNodeProps {
  node: CourseNodeType;
  isCurrent: boolean;
  isFirst: boolean;
  isLast: boolean;
  onClick: () => void;
}

export function CourseNode({ node, isCurrent, isFirst, isLast, onClick }: CourseNodeProps) {
  const [isPressed, setIsPressed] = useState(false);
  const isLocked = node.status === 'locked';
  const isCompleted = node.status === 'completed';
  const isUpcoming = !isCompleted && !isCurrent && !isLocked;
  const helperText = isCompleted
    ? '已完成，可随时回顾'
    : isLocked
      ? '完成前一节后解锁'
      : isCurrent
        ? '继续这一节，完成后解锁下一节'
        : '完成当前这一节后继续';

  const handlePressStart = () => {
    if (!isLocked) setIsPressed(true);
  };

  const handlePressEnd = () => {
    setIsPressed(false);
  };

  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute bottom-[-20px] left-[-24px] top-10 w-px bg-gradient-to-b from-accent/18 via-black/8 to-transparent" />
      )}

      {!isLocked && (
        <div className={`
          absolute left-[-38px] top-6 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background
          ${isCompleted ? 'bg-surface text-success shadow-[0_3px_8px_rgba(15,23,42,0.04)]' : ''}
          ${isCurrent ? 'bg-accent text-white shadow-[0_0_0_8px_rgba(255,138,0,0.16),0_10px_24px_rgba(255,138,0,0.20)]' : ''}
          ${isUpcoming ? 'bg-surface shadow-[0_4px_12px_rgba(15,23,42,0.08)]' : ''}
        `}>
          {isCompleted && (
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isCurrent && <div className="h-2.5 w-2.5 rounded-full bg-white" />}
          {isUpcoming && <div className="h-2.5 w-2.5 rounded-full bg-accent/45" />}
        </div>
      )}

      {isLocked && (
        <div className="absolute left-[-38px] top-6 flex h-7 w-7 items-center justify-center rounded-full bg-surface text-tertiary shadow-[0_3px_8px_rgba(15,23,42,0.04)]">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
      )}

      <button
        onClick={onClick}
        onMouseDown={handlePressStart}
        onMouseUp={handlePressEnd}
        onMouseLeave={handlePressEnd}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        disabled={isLocked}
        className={`
          w-full rounded-[26px] border text-left transition-all duration-200 ease-out
          ${isPressed && !isLocked ? 'scale-[0.99]' : ''}
          ${isCompleted ? 'border-black/5 bg-[linear-gradient(135deg,rgba(255,255,255,1),rgba(248,250,248,0.98)_100%)] shadow-[0_4px_14px_rgba(15,23,42,0.04)]' : ''}
          ${isCurrent ? 'border-[1.5px] border-accent/22 bg-[linear-gradient(135deg,rgba(255,138,0,0.20),rgba(255,250,242,1)_52%)] shadow-[0_10px_24px_rgba(255,138,0,0.12)] sm:scale-[1.01]' : ''}
          ${isUpcoming ? 'border-black/6 bg-surface shadow-card hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]' : ''}
          ${isLocked ? 'border-black/5 bg-[#F2F1ED] shadow-none' : 'cursor-pointer active:scale-[0.99]'}
          ${isFirst ? 'mt-1' : ''}
        `}
      >
        <div className="flex items-center gap-4 px-4 py-[18px] sm:px-5 sm:py-5">
          <div className={`
            flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold
            ${isCompleted ? 'bg-[#F3F7F3] text-success' : ''}
            ${isCurrent ? 'bg-accent/16 text-accent' : ''}
            ${isLocked ? 'bg-white/72 text-tertiary' : ''}
            ${isUpcoming ? 'bg-accent/8 text-accent' : ''}
          `}>
            {node.index + 1}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className={`font-semibold leading-6 ${isLocked ? 'text-secondary' : 'text-primary'} ${isCurrent ? 'text-[18px]' : 'text-base'}`}>
              {node.title}
            </h3>

            <p className={`mt-2 text-sm leading-6 ${isCurrent ? 'text-primary/75' : isLocked ? 'text-tertiary' : 'text-secondary'}`}>
              {helperText}
            </p>
          </div>

          {!isLocked && (
            <svg className={`h-5 w-5 shrink-0 ${isCurrent ? 'text-accent' : 'text-secondary'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      </button>
    </div>
  );
}
