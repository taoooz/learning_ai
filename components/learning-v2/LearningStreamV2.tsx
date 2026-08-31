'use client';

// components/learning-v2/LearningStreamV2.tsx
// V2 学习流渲染：streamItems 按显式 sequence 排序（文档 §2.5，顺序不能依赖数组写入竞态）
// 条目类型：task_content（标题+内容块+流式光标）/ task_transition（过渡分隔）/
// system_notice（按 tone 着色）/ chapter_recap / user_question + tutor_answer（P2 流内答疑，§2.1/§4）
// 自动滚动：上滑离底部 >120px 暂停跟随，回到底部恢复

import { useEffect, useRef } from 'react';
import type {
  ChapterRecap,
  LearningStreamItem,
  NodeLessonV2,
  SystemNoticeItem,
  TaskContentItem,
  TutorAnswerItem,
  UserQuestionItem,
} from '@/types/learning-v2';
import type { ChapterPhase } from '@/hooks/learning-v2/useChapterLearning';
import { getPendingTutorQuestions, TUTOR_AUTO_WINDOW_LIMIT } from '@/lib/learning-v2/tutor-queue';
import { TaskBlockView } from './TaskBlocksV2';

/**
 * 排队提示文案（可测纯函数，测试锁定，勿改）：
 * 主任务生成中 → 先生成完再回答；边界超窗排队（无内容在生成）→ 按顺序回答（最终审查修复 2）。
 */
export function tutorQueuedHint(mainGenerating: boolean): string {
  return mainGenerating ? '本节内容会先生成完，随后回答你的问题' : '问题较多时会按顺序回答，也可继续学习';
}

export function LearningStreamV2({
  lesson,
  phase,
  anchorTaskId,
  onRetryTutor,
  tutorBusy = false,
}: {
  lesson: NodeLessonV2;
  phase: ChapterPhase;
  /** 恢复分支④锚点：挂载时滚到该任务位置，且不自动贴底（用户上滑即视为跟随关闭） */
  anchorTaskId?: string | null;
  /** P2：失败回答的重试入口（接 hook.retryTutor）；未提供时不渲染重试按钮 */
  onRetryTutor?: (questionId: string) => void;
  /** P2：Tutor 忙碌时禁用重试按钮（编排层忙碌期间不受理重试，§4） */
  tutorBusy?: boolean;
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

  // P2 排队判定（§3.3/§4）：主任务生成中未答问题全部排队；边界仅超出自动窗口的部分排队。
  // 排队问题在任务完成（或前一题答完）后按提交顺序自动回答
  const mainGenerating = phase === 'generating' || phase === 'streaming';
  const queuedQuestionIds = new Set(
    getPendingTutorQuestions(lesson)
      .filter((question, index) => mainGenerating || index >= TUTOR_AUTO_WINDOW_LIMIT)
      .map((question) => question.questionId),
  );
  // 已有流式回答的问题：问题行显示「正在回答…」而非「待回答」
  const answeringQuestionIds = new Set(
    lesson.streamItems
      .filter(
        (item): item is TutorAnswerItem =>
          item.type === 'tutor_answer' && item.status === 'streaming',
      )
      .map((item) => item.questionId),
  );

  return (
    <div className="space-y-6">
      {items.map((item) => (
        <StreamItemView
          key={item.itemId}
          item={item}
          taskOrder={taskOrder}
          streamingTaskId={streamingTaskId}
          queuedQuestionIds={queuedQuestionIds}
          answeringQuestionIds={answeringQuestionIds}
          mainGenerating={mainGenerating}
          onRetryTutor={onRetryTutor}
          tutorBusy={tutorBusy}
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
  queuedQuestionIds,
  answeringQuestionIds,
  mainGenerating,
  onRetryTutor,
  tutorBusy,
}: {
  item: LearningStreamItem;
  taskOrder: Map<string, number>;
  streamingTaskId: string | null;
  queuedQuestionIds: Set<string>;
  answeringQuestionIds: Set<string>;
  mainGenerating: boolean;
  onRetryTutor?: (questionId: string) => void;
  tutorBusy: boolean;
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
    case 'user_question':
      return (
        <UserQuestionView
          item={item}
          queued={queuedQuestionIds.has(item.questionId)}
          answering={answeringQuestionIds.has(item.questionId)}
          mainGenerating={mainGenerating}
        />
      );
    case 'tutor_answer':
      return <TutorAnswerView item={item} busy={tutorBusy} onRetry={onRetryTutor} />;
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
 * 用户提问条目（P2，§2.1/§4）：右对齐气泡与任务内容区分。
 * pending 显示待回答状态；排队中（超出自动窗口或主任务生成中）显示排队提示
 * （文案区分「主任务生成中」与「边界超窗」两种排队场景，见 tutorQueuedHint）；
 * 配对回答已流式时显示「正在回答…」。
 * 失败的具体原因与重试在配对的 tutor_answer 条目上，问题行只给失败标记。
 */
function UserQuestionView({
  item,
  queued,
  answering,
  mainGenerating,
}: {
  item: UserQuestionItem;
  queued: boolean;
  answering: boolean;
  mainGenerating: boolean;
}) {
  const pendingHint = queued
    ? tutorQueuedHint(mainGenerating)
    : answering
      ? '正在回答…'
      : '待回答';
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent/10 px-4 py-2.5 text-[14px] leading-relaxed text-primary">
        {item.text}
      </div>
      {item.status === 'pending' && (
        <p className="pr-1 text-[12px] text-tertiary">{pendingHint}</p>
      )}
      {item.status === 'failed' && <p className="pr-1 text-[12px] text-error">回答失败</p>}
    </div>
  );
}

/**
 * Tutor 回答条目（P2，§2.1/§4）：markdown 块复用既有内容块渲染。
 * 流式中无内容时显示准备态；失败显示错误文案与「重试回答」（只重发该问题，不影响主线）。
 */
function TutorAnswerView({
  item,
  busy,
  onRetry,
}: {
  item: TutorAnswerItem;
  busy: boolean;
  onRetry?: (questionId: string) => void;
}) {
  const streaming = item.status === 'streaming';
  const failed = item.status === 'failed';
  return (
    <section className="space-y-2 rounded-2xl border border-accent/15 bg-surface px-4 py-3.5">
      <p className="text-[12px] font-medium tracking-wide text-tertiary">回答</p>
      {item.blocks.map((block) => (
        <TaskBlockView key={block.blockId} block={block} />
      ))}
      {streaming && item.blocks.length === 0 && (
        <p className="text-[13px] leading-relaxed text-tertiary">正在准备回答…</p>
      )}
      {streaming && (
        <span className="inline-block h-4 w-2 animate-pulse rounded-[2px] bg-accent align-middle" />
      )}
      {failed && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-error/8 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-error">
            {item.errorMessage ?? '回答生成失败，请重试'}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(item.questionId)}
              disabled={busy}
              className="min-h-[44px] shrink-0 rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              重试回答
            </button>
          )}
        </div>
      )}
    </section>
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
