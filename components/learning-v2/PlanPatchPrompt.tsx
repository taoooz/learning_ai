'use client';

// components/learning-v2/PlanPatchPrompt.tsx
// P4 动态调度：用户可见的调整提示（§P4「简短、非技术化的调整说明」）
// 边界时展示建议摘要，用户可接受（应用补丁）或忽略（按原计划继续）

import type { ChapterPlanPatch } from '@/types/learning-v2';

interface PlanPatchPromptProps {
  patch: ChapterPlanPatch;
  onAccept: () => void;
  onDismiss: () => void;
}

export function PlanPatchPrompt({ patch, onAccept, onDismiss }: PlanPatchPromptProps) {
  if (!patch.summary) return null;
  return (
    <div
      role="status"
      className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/25 bg-accent/5 px-4 py-3"
      data-plan-patch={patch.patchId}
    >
      <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-secondary">
        <span className="mr-1 text-accent">✦</span>
        {patch.summary}
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onAccept}
          className="rounded-full bg-accent px-4 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
        >
          按建议调整
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full border border-black/10 px-4 py-1.5 text-[12px] text-secondary transition-colors hover:bg-black/4"
        >
          按原计划
        </button>
      </div>
    </div>
  );
}
