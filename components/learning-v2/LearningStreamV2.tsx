'use client';

// components/learning-v2/LearningStreamV2.tsx
// V2 学习流渲染：streamItems 按显式 sequence 排序（文档 §2.5，顺序不能依赖数组写入竞态）
// 条目类型：task_content（标题+内容块+流式光标）/ task_transition（过渡分隔）/
// system_notice（按 tone 着色）/ chapter_recap / user_question + tutor_answer（P2 流内答疑，§2.1/§4）
// 自动滚动：同一任务内贴底跟随；任务切换不抢位置，用户回到底部后恢复跟随

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChapterRecap,
  CheckpointItem,
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
import { resolveAutoFollowOnTaskChange } from '@/lib/learning-v2/stream-scroll';
import { isResolvedErrorNotice } from '@/lib/learning-v2/stream-item-presentation';

import { CheckpointCard } from './CheckpointCard';
import { SourceRefsView } from './SourceRefsView';
import { AssistantGlyph } from '../ui/chat/AssistantGlyph';

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
  courseId,
  onRetryTask,
  onRetryTutor,
  tutorBusy = false,
  onSubmitCheckpoint,
  onRetryCheckpoint,
  onRequestRemediation,
}: {
  lesson: NodeLessonV2;
  phase: ChapterPhase;
  /** 恢复分支④锚点：挂载时滚到该任务位置，且不自动贴底（用户上滑即视为跟随关闭） */
  anchorTaskId?: string | null;
  /** 错误卡片重试指定任务 */
  onRetryTask?: (taskId: string) => void;
  /** P2：失败回答的重试入口（接 hook.retryTutor）；未提供时不渲染重试按钮 */
  onRetryTutor?: (questionId: string) => void;
  /** P2：Tutor 忙碌时禁用重试按钮（编排层忙碌期间不受理重试，§4） */
  tutorBusy?: boolean;
  /** P3a：提交 Checkpoint 答案（接 hook.submitCheckpoint） */
  onSubmitCheckpoint?: (checkpointId: string, answer: string | string[]) => void;
  /** P3a：重试 Checkpoint（接 hook.retryCheckpoint） */
  onRetryCheckpoint?: (checkpointId: string) => void;
  /** P3a：请求补救内容 + 等价新题（接 hook.requestRemediation） */
  onRequestRemediation?: (checkpointId: string) => void;
  /** Phase 2 交互组件完成信号需要 courseId */
  courseId?: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(!anchorTaskId);
  // 浏览器滚动恢复（非恢复分支④）回到中途时，也补一个“从这里继续”cue
  const [restoredMidPage, setRestoredMidPage] = useState(false);
  const anchoredRef = useRef(false);
  const previousTaskIdRef = useRef<string | null | undefined>(undefined);

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

  // 任务切换不抢滚动位置：点「继续学习」/命中预取时，新内容出现在原位置下方；
  // 用户手动回到底部后，滚动监听会恢复跟随。
  useEffect(() => {
    const nextTaskId = lesson.runtime.currentTaskId;
    autoScrollRef.current = resolveAutoFollowOnTaskChange(
      previousTaskIdRef.current,
      nextTaskId,
      autoScrollRef.current,
    );
    previousTaskIdRef.current = nextTaskId;
  }, [lesson.runtime.currentTaskId]);

  // 挂载锚点定位（只执行一次）：先于底部跟随生效
  useEffect(() => {
    if (!anchorTaskId || anchoredRef.current) return;
    anchoredRef.current = true;
    const element = document.querySelector(`[data-task-item="${anchorTaskId}"]`);
    element?.scrollIntoView({ block: 'start' });
  }, [anchorTaskId]);

  useEffect(() => {
    if (anchorTaskId) return;
    // 浏览器滚动恢复可能晚于挂载，重试几次直到命中中途位置
    const tryMark = () => {
      if (window.scrollY < 300) return false;
      const inView = Array.from(document.querySelectorAll('[data-task-item]'))
        .filter((el) => el.getBoundingClientRect().top <= 120)
        .pop();
      if (inView) setRestoredMidPage(true);
      return !!inView;
    };
    const timers = [0, 350, 900].map((delay) => setTimeout(() => tryMark(), delay));
    return () => timers.forEach(clearTimeout);
  }, [anchorTaskId]);

  // 每次内容变化：跟随模式下滚到底部哨兵
  useEffect(() => {
    if (autoScrollRef.current) bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  });

  // 完成态的 recap 由 ChapterCompleteCard 展示（同一份 lesson.recap），流内不重复渲染。
  // 用数组位置作为主排序：新任务内容始终追加在用户问题/回答之后，符合用户视角的时间线。
  const items = useMemo(
    () =>
      lesson.streamItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => (
          !(item.type === 'chapter_recap' && phase === 'completed') &&
          !isResolvedErrorNotice(item, lesson)
        ))
        .sort((a, b) => a.index - b.index)
        .map(({ item }) => item),
    [lesson, phase],
  );
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

  // 任务步骤序号：与头部进度同源（chapterPlan.tasks 按 order 排序）
  const taskSteps = useMemo(() => {
    const tasks = [...lesson.chapterPlan.tasks].sort((a, b) => a.order - b.order);
    const map = new Map<string, { index: number; total: number }>();
    tasks.forEach((task, i) => map.set(task.taskId, { index: i + 1, total: tasks.length }));
    return map;
  }, [lesson.chapterPlan.tasks]);

  return (
    <div className="space-y-5">
      <ResumeCue show={Boolean(anchorTaskId) || restoredMidPage} />
      {items.map((item) => (
        <Fragment key={item.itemId}>
        <StreamItemView
          item={item}
          courseId={courseId}
          step={item.type === 'task_content' ? taskSteps.get(item.taskId) : undefined}
          streamingTaskId={streamingTaskId}
          onRetryTask={onRetryTask}
          queuedQuestionIds={queuedQuestionIds}
          answeringQuestionIds={answeringQuestionIds}
          mainGenerating={mainGenerating}
          onRetryTutor={onRetryTutor}
          onSubmitCheckpoint={onSubmitCheckpoint}
          onRetryCheckpoint={onRetryCheckpoint}
          onRequestRemediation={onRequestRemediation}
          tutorBusy={tutorBusy}
        />
        </Fragment>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

/** 恢复定位 cue：回到中途时提示“从这里继续”，数秒后淡出 */
function ResumeCue({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!show) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [show]);
  if (!show) return null;
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-x-0 top-[60px] z-30 flex justify-center transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <span className="rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-secondary shadow-float">
        从这里继续
      </span>
    </div>
  );
}

function StreamItemView({
  item,
  courseId,
  step,
  streamingTaskId,
  onRetryTask,
  queuedQuestionIds,
  answeringQuestionIds,
  mainGenerating,
  onRetryTutor,
  tutorBusy,
  onSubmitCheckpoint,
  onRetryCheckpoint,
  onRequestRemediation,
}: {
  item: LearningStreamItem;
  courseId?: string;
  step?: { index: number; total: number };
  streamingTaskId: string | null;
  onRetryTask?: (taskId: string) => void;
  queuedQuestionIds: Set<string>;
  answeringQuestionIds: Set<string>;
  mainGenerating: boolean;
  onRetryTutor?: (questionId: string) => void;
  tutorBusy: boolean;
  onSubmitCheckpoint?: (checkpointId: string, answer: string | string[]) => void;
  onRetryCheckpoint?: (checkpointId: string) => void;
  onRequestRemediation?: (checkpointId: string) => void;
}) {
  switch (item.type) {
    case 'task_content':
      return (
        <TaskContentView
          item={item}
          step={step}
          courseId={courseId}
          isStreaming={streamingTaskId === item.taskId}
        />
      );
    case 'task_transition':
      return (
        <div className="flex items-center gap-3 py-2" aria-hidden>
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-black/10" />
          <span className="h-1.5 w-1.5 rounded-full bg-black/10" />
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-black/10" />
        </div>
      );
    case 'system_notice':
      return <SystemNoticeView item={item} onRetryTask={onRetryTask} onRetryTutor={onRetryTutor} />;
    case 'chapter_recap':
      return <ChapterRecapView recap={item.recap} streaming={item.status === 'streaming'} />;
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
    case 'checkpoint':
      return (
        <CheckpointItemView
          item={item}
          onSubmit={onSubmitCheckpoint}
          onRetry={onRetryCheckpoint}
          onRequestRemediation={onRequestRemediation}
        />
      );
    default:
      return null;
  }
}

/** P3a Checkpoint 条目渲染 */
function CheckpointItemView({
  item,
  onSubmit,
  onRetry,
  onRequestRemediation,
}: {
  item: CheckpointItem;
  onSubmit?: (checkpointId: string, answer: string | string[]) => void;
  onRetry?: (checkpointId: string) => void;
  onRequestRemediation?: (checkpointId: string) => void;
}) {
  return (
    <CheckpointCard
      checkpoint={item.checkpoint}
      evaluation={item.evaluation}
      remediationContent={item.remediationContent}
      onSubmit={(answer) => onSubmit?.(item.checkpoint.checkpointId, answer)}
      onRetry={() => onRetry?.(item.checkpoint.checkpointId)}
      onRequestRemediation={onRequestRemediation ? () => onRequestRemediation(item.checkpoint.checkpointId) : undefined}
      disabled={item.status === 'evaluated'}
    />
  );
}

function TaskContentView({
  item,
  step,
  courseId,
  isStreaming,
}: {
  item: TaskContentItem;
  step?: { index: number; total: number };
  courseId?: string;
  isStreaming: boolean;
}) {
  return (
    <article data-task-item={item.taskId} className="relative space-y-4 pt-3 pl-0 sm:pl-0">
      {step && (
        <p className="text-[12px] font-medium tabular-nums text-tertiary">
          第 {step.index} 步 · 共 {step.total} 步
        </p>
      )}
      <h2 className="text-[18px] font-semibold leading-[1.4] text-primary">
        {item.title}
      </h2>
      <div className="space-y-4">
        {item.blocks.map((block) => (
          <TaskBlockView key={block.blockId} block={block} courseId={courseId} streaming={isStreaming} />
        ))}
      </div>
      {isStreaming && (
        <span className="inline-block h-4 w-2 animate-pulse rounded-[2px] bg-accent align-middle" />
      )}
      {item.sourceRefs && item.sourceRefs.length > 0 && (
        <div className="pt-1">
          <SourceRefsView sources={item.sourceRefs} />
        </div>
      )}
    </article>
  );
}

// 错误通知用 inline 横幅（左色条 + 浅底），不与边界卡/检查点抢卡片形态
const NOTICE_TONE_STYLES: Record<SystemNoticeItem['tone'], string> = {
  info: 'rounded-xl border border-black/[0.06] bg-subtle',
  warning: 'rounded-xl border border-amber-500/20 bg-amber-500/[0.05]',
  error: 'relative overflow-hidden rounded-[10px] bg-[rgba(196,58,91,0.07)]',
};

const NOTICE_ICON_STYLES: Record<SystemNoticeItem['tone'], string> = {
  info: 'bg-black/[0.04] text-secondary',
  warning: 'bg-amber-500/12 text-amber-700',
  error: 'bg-[rgba(196,58,91,0.12)] text-error',
};

function getNoticeTitle(item: SystemNoticeItem): string {
  if (item.tone === 'error') {
    return item.questionId ? '回答生成失败' : item.taskId ? '内容生成中断' : '出现问题';
  }
  return item.tone === 'warning' ? '需要留意' : '提示';
}

function SystemNoticeView({
  item,
  onRetryTask,
  onRetryTutor,
}: {
  item: SystemNoticeItem;
  onRetryTask?: (taskId: string) => void;
  onRetryTutor?: (questionId: string) => void;
}) {
  const canRetryTask = item.tone === 'error' && item.retryable !== false && !!item.taskId && !item.questionId;
  const canRetryTutor = item.tone === 'error' && item.retryable !== false && !!item.questionId;
  const retryLabel = canRetryTutor ? '重试回答' : '重新生成本节';

  return (
    <section className={`fade-in px-3.5 py-3 ${NOTICE_TONE_STYLES[item.tone]}`}>
      {item.tone === 'error' && (
        <span aria-hidden="true" className="absolute left-0 top-0 h-full w-[3px] bg-[rgba(196,58,91,0.65)]" />
      )}
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${NOTICE_ICON_STYLES[item.tone]}`}>
          {item.tone === 'error' ? '!' : item.tone === 'warning' ? '!' : 'i'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className={`text-[13px] font-semibold ${item.tone === 'error' ? 'text-error' : 'text-primary'}`}>
              {getNoticeTitle(item)}
            </p>
            {(canRetryTask || canRetryTutor) && (
              <button
                type="button"
                onClick={() => {
                  if (canRetryTutor && item.questionId) onRetryTutor?.(item.questionId);
                  else if (item.taskId) onRetryTask?.(item.taskId);
                }}
                className="text-[12px] font-semibold text-current underline underline-offset-4 opacity-80 transition-opacity hover:opacity-100"
              >
                {canRetryTutor ? retryLabel : '重试'}
              </button>
            )}
          </div>
          <p className="mt-1 text-[12.5px] leading-[1.65] text-secondary">{item.message}</p>
        </div>
      </div>
    </section>
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
      <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-accent/10 px-4 py-2.5 text-[14px] leading-relaxed text-primary shadow-sm">
        {item.text}
      </div>
      {item.status === 'pending' && (
        <p className="pr-1 text-[12px] text-tertiary">{pendingHint}</p>
      )}
      {item.status === 'failed' && (
        <div className="pr-1 inline-flex items-center gap-1.5 rounded-full bg-[rgba(196,58,91,0.08)] px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[rgba(196,58,91,0.6)]" />
          <p className="text-[12px] text-error">回答失败</p>
        </div>
      )}
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
    <section className="relative overflow-hidden rounded-2xl border border-black/[0.05] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(246,250,249,0.94))] pl-4 pr-4 py-4 shadow-sm">
      <div className="absolute left-0 top-0 h-full w-[3px] bg-[linear-gradient(180deg,#98B8E8,#7FBFC3)]" />
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(221,232,246,0.72))] shadow-sm">
          <AssistantGlyph className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary/75">AI 回答</p>
          {streaming && (
            <p className="text-[11px] text-secondary/60">生成中…</p>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {item.blocks.map((block) => (
          <TaskBlockView key={block.blockId} block={block} streaming={streaming} />
        ))}
      </div>
      {streaming && item.blocks.length === 0 && (
        <div className="space-y-2">
          <div className="h-3 w-[72%] animate-pulse rounded-full bg-black/[0.05]" />
          <div className="h-3 w-[56%] animate-pulse rounded-full bg-black/[0.04]" />
        </div>
      )}
      {failed && (
        <div className="mt-1 flex flex-wrap items-center gap-3 rounded-xl border border-[rgba(196,58,91,0.25)] bg-[rgba(196,58,91,0.05)] px-3.5 py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(196,58,91,0.12)] text-[13px] font-bold text-error">!</span>
          <div className="min-w-[180px] flex-1">
            <p className="text-[13px] font-semibold text-error">回答生成失败</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-error">
              {item.errorMessage ?? '请检查网络后重试'}
            </p>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(item.questionId)}
              disabled={busy}
              className="rounded-full border border-[rgba(127,191,195,0.28)] bg-[rgba(127,191,195,0.10)] px-4 py-2 text-[12px] font-semibold text-[#4C6F84] transition-all duration-200 hover:bg-[rgba(127,191,195,0.16)] disabled:cursor-not-allowed disabled:opacity-50"
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
 * 章节小结加载骨架：Recap 请求期间保持学习流完整，用占位结构减少等待突兀感。
 */
export function ChapterRecapSkeleton() {
  return (
    <section className="rounded-2xl border border-accent/20 bg-accent/5 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-primary">正在生成本章小结</h3>
        <span className="text-[11px] text-tertiary">通常几秒内完成</span>
      </div>
      <div className="space-y-2.5">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-3.5 animate-pulse rounded-full bg-accent/10"
            style={{ width: `${100 - index * 12}%` }}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * 章节小结展示块（P1b）：流内 chapter_recap 条目与章节完成卡共享。
 * 证据红线（画像 §7.1）：三个掌握度字段由服务端确定性置空，P1 阶段恒为空，
 * UI 一律不渲染这些字段——即使未来拿到非空值也不展示，避免呈现不可信证据。
 * degraded（本地兜底小结）时显式标注，避免误导。
 */
export function ChapterRecapView({
  recap,
  streaming = false,
}: {
  recap: ChapterRecap;
  streaming?: boolean;
}) {
  const empty = recap.keyTakeaways.length === 0;
  return (
    <section className="fade-in rounded-2xl border border-accent/20 bg-accent/5 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-primary">
          {streaming && empty ? '正在生成本章小结' : '本章小结'}
        </h3>
        {streaming ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-tertiary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            生成中
          </span>
        ) : recap.degraded ? (
          <span className="shrink-0 text-[11px] text-tertiary">小结为自动提炼，仅供参考</span>
        ) : null}
      </div>
      {empty && streaming && (
        <p className="text-[13px] leading-relaxed text-tertiary">正在提炼本章要点…</p>
      )}
      {recap.keyTakeaways.length > 0 && (
        <ul className="space-y-2">
          {recap.keyTakeaways.map((takeaway, index) => (
            <li key={`${index}-${takeaway}`} className="fade-in flex gap-2 text-[13px] leading-relaxed text-secondary">
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
