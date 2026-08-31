'use client';

// components/learning-v2/LearningStreamV2.tsx
// V2 学习流渲染：streamItems 按显式 sequence 排序（文档 §2.5，顺序不能依赖数组写入竞态）
// 三种条目：task_content（标题+内容块+流式光标）/ task_transition（过渡分隔）/ system_notice（按 tone 着色）
// 自动滚动：上滑离底部 >120px 暂停跟随，回到底部恢复

import { useEffect, useRef } from 'react';
import type {
  ChapterRecap,
  LearningStreamItem,
  NodeLessonV2,
  SystemNoticeItem,
  TaskContentItem,
} from '@/types/learning-v2';
import type { ChapterPhase } from '@/hooks/learning-v2/useChapterLearning';
import { TaskBlockView } from './TaskBlocksV2';

export function LearningStreamV2({
  lesson,
  phase,
  anchorTaskId,
}: {
  lesson: NodeLessonV2;
  phase: ChapterPhase;
  /** 恢复分支④锚点：挂载时滚到该任务位置，且不自动贴底（用户上滑即视为跟随关闭） */
  anchorTaskId?: string | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(!anchorTaskId);
  const anchoredRef = useRef(false);

  // 滚动监听：距底部 <120px 视为「跟随模式」
  useEffect(() => {
    const onScroll = () => {
      const distanceToBottom =
        document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      autoScrollRef.current = distanceToBottom < 120;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 挂载锚点定位（只执行一次）：先于底部跟随生效
  useEffect(() => {
    if (!anchorTaskId || anchoredRef.current) return;
    anchoredRef.current = true;
    const element = document.querySelector(`[data-task-item="${anchorTaskId}"]`);
    element?.scrollIntoView({ block: 'start' });
  }, [anchorTaskId]);

  // 每次内容变化：跟随模式下滚到底部哨兵
  useEffect(() => {
    if (autoScrollRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  // taskId → 计划内序号（用于「第 x 节」标注）
  const taskOrder = new Map(
    [...lesson.chapterPlan.tasks]
      .sort((a, b) => a.order - b.order)
      .map((task, index) => [task.taskId, index + 1] as const),
  );
  // 完成态的 recap 由 ChapterCompleteCard 展示（同一份 lesson.recap），流内不重复渲染
  const items = [...lesson.streamItems]
    .filter((item) => !(item.type === 'chapter_recap' && phase === 'completed'))
    .sort((a, b) => a.sequence - b.sequence);
  // 正在流式的任务：只有它的内容区显示光标
  const streamingTaskId =
    phase === 'streaming' && lesson.runtime.currentTaskStatus === 'streaming'
      ? lesson.runtime.currentTaskId
      : null;

  return (
    <div className="space-y-6">
      {items.map((item) => (
        <StreamItemView
          key={item.itemId}
          item={item}
          taskOrder={taskOrder}
          streamingTaskId={streamingTaskId}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function StreamItemView({
  item,
  taskOrder,
  streamingTaskId,
}: {
  item: LearningStreamItem;
  taskOrder: Map<string, number>;
  streamingTaskId: string | null;
}) {
  switch (item.type) {
    case 'task_content':
      return (
        <TaskContentView
          item={item}
          order={taskOrder.get(item.taskId)}
          isStreaming={streamingTaskId === item.taskId}
        />
      );
    case 'task_transition':
      return (
        <div className="flex items-center gap-3 py-1 text-tertiary" aria-hidden>
          <span className="h-px flex-1 bg-black/6" />
          <span className="text-[12px]">下一节</span>
          <span className="h-px flex-1 bg-black/6" />
        </div>
      );
    case 'system_notice':
      return <SystemNoticeView item={item} />;
    case 'chapter_recap':
      return <ChapterRecapView recap={item.recap} />;
    default:
      return null;
  }
}

function TaskContentView({
  item,
  order,
  isStreaming,
}: {
  item: TaskContentItem;
  order?: number;
  isStreaming: boolean;
}) {
  return (
    <section data-task-item={item.taskId} className="space-y-3">
      <header>
        {order != null && (
          <p className="mb-1 text-[12px] font-medium tracking-wide text-tertiary">第 {order} 节</p>
        )}
        <h2 className="text-[17px] font-semibold leading-snug text-primary">{item.title}</h2>
      </header>
      {item.blocks.map((block) => (
        <TaskBlockView key={block.blockId} block={block} />
      ))}
      {isStreaming && (
        <span className="inline-block h-4 w-2 animate-pulse rounded-[2px] bg-accent align-middle" />
      )}
    </section>
  );
}

const NOTICE_TONE_STYLES: Record<SystemNoticeItem['tone'], string> = {
  info: 'bg-subtle text-secondary',
  warning: 'bg-amber-500/8 text-amber-700',
  error: 'bg-error/8 text-error',
};

function SystemNoticeView({ item }: { item: SystemNoticeItem }) {
  return (
    <div className={`rounded-xl px-4 py-3 text-[13px] leading-relaxed ${NOTICE_TONE_STYLES[item.tone]}`}>
      {item.message}
    </div>
  );
}

/**
 * 章节小结展示块（P1b）：流内 chapter_recap 条目与章节完成卡共享。
 * 证据红线（画像 §7.1）：三个掌握度字段由服务端确定性置空，P1 阶段恒为空，
 * UI 一律不渲染这些字段——即使未来拿到非空值也不展示，避免呈现不可信证据。
 * degraded（本地兜底小结）时显式标注，避免误导。
 */
export function ChapterRecapView({ recap }: { recap: ChapterRecap }) {
  return (
    <section className="rounded-2xl border border-accent/20 bg-accent/5 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-primary">本章小结</h3>
        {recap.degraded && (
          <span className="shrink-0 text-[11px] text-tertiary">小结为自动提炼，仅供参考</span>
        )}
      </div>
      {recap.keyTakeaways.length > 0 && (
        <ul className="space-y-2">
          {recap.keyTakeaways.map((takeaway, index) => (
            <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-secondary">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" aria-hidden />
              <span>{takeaway}</span>
            </li>
          ))}
        </ul>
      )}
      {recap.recommendedReview && (
        <p className="mt-3 text-[13px] leading-relaxed text-secondary">
          <span className="font-medium text-primary">建议复习：</span>
          {recap.recommendedReview}
        </p>
      )}
      {recap.nextChapterPreview && (
        <p className="mt-3 text-[13px] leading-relaxed text-secondary">
          <span className="font-medium text-primary">下一章：</span>
          {recap.nextChapterPreview}
        </p>
      )}
    </section>
  );
}
