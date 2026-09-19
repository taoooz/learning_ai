'use client';

// components/learning-v2/TaskBoundaryV2.tsx
// V2 任务边界卡：任务完成后停在此处等用户决策（文档 §6 边界停顿）
// 展示可带走要点（takeaway）与下一步预告（nextHint）；按钮统一走 continueNext：
// 失败→重新生成 / 有下一任务→继续学习 / 末任务→完成本章
// completing 相位：末任务确认后进入收尾，按钮禁用并提示正在生成小结
//
// P2 流内答疑不变量（设计文档 §4，勿破坏）：
// - Tutor 回答进行中不禁用本卡任何操作，提问输入框（页面层）也保持可用；
// - 回答完成后保持既有继续按钮与语义，不自动推进主线；
// - Tutor 失败只在回答条目上局部重试，不进入本卡的失败分支（本卡只反映主线任务状态）。

import type { NodeLessonV2 } from '@/types/learning-v2';
import type { ChapterPhase } from '@/hooks/learning-v2/useChapterLearning';

interface TaskBoundaryV2Props {
  lesson: NodeLessonV2;
  phase: ChapterPhase;
  /** 当前任务连续失败次数（>=3 且失败态时给软提示，不锁按钮） */
  attempts: number;
  onContinue: () => void;
  /** 最近 Tutor 回答是否为 proceed 意图（高亮继续按钮，§2.6.2） */
  highlightContinue?: boolean;
}

export function TaskBoundaryV2({ lesson, phase, attempts, onContinue, highlightContinue = false }: TaskBoundaryV2Props) {
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
              className="shrink-0 cursor-not-allowed rounded-full bg-accent/50 px-5 py-2.5 text-[14px] font-semibold text-white/80"
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

  const buttonLabel = failed ? '重新生成本节' : nextTask ? '继续学习' : '完成本章';
  const progressLabel = failed
    ? '本节生成失败，可以重试'
    : nextTask
      ? `第 ${currentIndex + 1}/${sortedTasks.length} 节 · 接下来：${nextTask.title}`
      : `第 ${sortedTasks.length}/${sortedTasks.length} 节 · 本章内容已全部完成`;

  return (
    <div className="sticky bottom-4 z-10 mt-8">
      <div className="rounded-3xl border border-black/6 bg-surface/95 p-4 shadow-lg shadow-black/5 backdrop-blur">
        {!failed && boundaryPrompt?.takeaway && (
          <blockquote className="mb-3 border-l-2 border-accent/50 pl-3 text-[13px] leading-relaxed text-secondary">
            {boundaryPrompt.takeaway}
          </blockquote>
        )}
        {!failed && boundaryPrompt?.nextHint && (
          <p className="mb-3 text-[12px] text-tertiary">下一步：{boundaryPrompt.nextHint}</p>
        )}
        {failed && attempts >= 3 && (
          <p className="mb-3 text-[12px] leading-relaxed text-tertiary">
            本节已连续多次失败，可再试一次或稍后再来
          </p>
        )}
        {highlightContinue && !failed && (
          <p className="mb-3 text-[12px] text-accent">听起来你已准备好，可以继续了</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 flex-1 truncate text-[12px] text-tertiary">{progressLabel}</p>
          <button
            type="button"
            onClick={onContinue}
            className={`shrink-0 rounded-full px-5 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80 ${
              highlightContinue && !failed
                ? 'animate-pulse bg-accent shadow-md shadow-accent/30'
                : 'bg-accent'
            }`}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
