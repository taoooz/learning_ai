'use client';

// components/learning-v2/TaskBoundary.tsx
// V2 任务边界卡：任务完成后停在此处等用户决策（文档 §6 边界停顿）
// 展示可带走要点（takeaway）与下一步预告（nextHint）；按钮统一走 continueNext：
// 失败→重新生成 / 有下一任务→继续学习 / 末任务→完成本章
// completing 相位：末任务确认后进入收尾，按钮禁用并提示正在生成小结
//
// P2 流内答疑不变量（设计文档 §4，勿破坏）：
// - Tutor 回答进行中不禁用本卡任何操作，提问输入框（页面层）也保持可用；
// - 回答完成后保持既有继续按钮与语义，不自动推进主线；
// - Tutor 失败只在回答条目上局部重试，不进入本卡的失败分支（本卡只反映主线任务状态）。

import type { NodeLesson } from '@/types/learning-v2';
import type { ChapterPhase } from '@/hooks/learning-v2/useChapterLearning';
import { evaluateChapterCheckpointGate } from '@/lib/learning-v2/checkpoint-gate';

interface TaskBoundaryProps {
  lesson: NodeLesson;
  phase: ChapterPhase;
  /** 当前任务连续失败次数（>=3 且失败态时给软提示，不锁按钮） */
  attempts: number;
  onContinue: () => void;
  /** 最近 Tutor 回答是否为 proceed 意图（高亮继续按钮，§2.6.2） */
  highlightContinue?: boolean;
}

export function TaskBoundary({ lesson, phase, attempts, onContinue, highlightContinue = false }: TaskBoundaryProps) {
  if (phase !== 'boundary' && phase !== 'completing') return null;

  // completing：本章收尾中，只保留一个禁用按钮提示进度，不展示边界内容
  if (phase === 'completing') {
    return (
      <div className="sticky bottom-4 z-10 mt-8">
        <div className="rounded-3xl border border-black/6 bg-surface/95 p-4 shadow-lg shadow-black/5 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 flex-1 truncate text-[12px] text-tertiary">正在为本章生成小结…</p>
            <button
              type="button"
              disabled
              className="shrink-0 cursor-not-allowed rounded-full bg-accent/40 px-5 py-2.5 text-[14px] font-semibold text-primary/60"
            >
              正在生成章节小结…
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { runtime } = lesson;
  const failed = runtime.currentTaskStatus === 'failed';
  const sortedTasks = [...lesson.chapterPlan.tasks].sort((a, b) => a.order - b.order);
  const currentIndex = sortedTasks.findIndex((task) => task.taskId === runtime.currentTaskId);
  const nextTask = currentIndex >= 0 ? sortedTasks[currentIndex + 1] : undefined;

  // 边界提示取当前任务的 task_content 块（由 task_completed 事件固化）
  const contentItem = lesson.streamItems.find(
    (item) => item.type === 'task_content' && item.taskId === runtime.currentTaskId,
  );
  const boundaryPrompt =
    contentItem && contentItem.type === 'task_content' ? contentItem.boundaryPrompt : undefined;

  const checkpointGate = evaluateChapterCheckpointGate(lesson);
  // 检查闸门只约束最后一个边界（“完成本章”）；中途边界的“继续学习”不受影响
  const isFinalBoundary = !nextTask;
  const buttonLabel = failed
    ? '重新生成本节'
    : nextTask
      ? '继续学习'
      : checkpointGate.blocked
        ? '完成理解检查'
        : '完成本章';
  const progressLabel = failed
    ? attempts > 1
      ? `已重试 ${attempts} 次，仍可再试`
      : '检查网络或服务后重试'
    : nextTask
      ? ''
      : '本章内容已全部完成';

  return (
    <div className="sticky bottom-4 z-10 mt-8">
      <div className="rounded-3xl border border-black/[0.05] bg-surface/95 p-3.5 shadow-[0_10px_32px_rgba(15,23,42,0.10)] backdrop-blur-md">
        {!failed && boundaryPrompt?.nextHint && (
          <p className="mb-3 flex items-center gap-1.5 text-[12px] leading-relaxed text-tertiary">
            <span aria-hidden>→</span>
            <span>{boundaryPrompt.nextHint}</span>
          </p>
        )}
        {failed && attempts >= 3 && (
          <p className="mb-3 text-[12px] leading-relaxed text-tertiary">
            本节已连续多次失败，可再试一次或稍后再来
          </p>
        )}
        {highlightContinue && !failed && (
          <p className="mb-3 text-[12px] font-medium text-accent">听起来你已准备好，可以继续了</p>
        )}
        {!failed && isFinalBoundary && checkpointGate.blocked && (
          <p className="mb-3 text-[12px] leading-relaxed text-tertiary">
            {checkpointGate.reason === 'generating'
              ? '正在生成本章理解检查…'
              : checkpointGate.reason === 'awaiting_answer'
                ? '请先完成本章理解检查，再收尾本章。'
                : '请先查看补救讲解并完成重试，再收尾本章。'}
          </p>
        )}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {failed ? (
              <>
                <p className="truncate text-[13px] font-medium text-primary">本节没生成成功</p>
                <p className="mt-0.5 truncate text-[11px] text-tertiary">{progressLabel}</p>
              </>
            ) : nextTask ? (
              <>
                <p className="text-[11px] font-medium text-tertiary">接下来</p>
                <p className="mt-0.5 truncate text-[14px] font-medium text-primary">{nextTask.title}</p>
                <p className="mt-0.5 text-[11px] tabular-nums text-tertiary">{progressLabel}</p>
              </>
            ) : (
              <p className="truncate text-[13px] font-medium text-primary">{progressLabel}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onContinue}
            disabled={!failed && isFinalBoundary && checkpointGate.blocked}
            className={`flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-[14px] font-semibold text-primary transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:shadow-none ${
              highlightContinue && !failed
                ? 'animate-pulse bg-accent shadow-md shadow-accent/30'
                : 'bg-accent shadow-sm shadow-accent/20'
            } disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none disabled:opacity-45`}
          >
            <span>{buttonLabel}</span>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
