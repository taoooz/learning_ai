'use client';

// components/learning-v2/ChapterCompleteCard.tsx
// V2 章节完成卡：完成态展示 + 章节小结 + 下一章入口
// 纯展示组件，路由跳转由页面侧注入回调

import type { ChapterRecap } from '@/types/learning-v2';
import { ChapterRecapView } from './LearningStreamV2';

interface ChapterCompleteCardProps {
  chapterTitle: string;
  /** 章节小结：完成卡是 recap 的主展示位（流内同一条目不再重复渲染） */
  recap?: ChapterRecap;
  nextChapter?: { chapterId: string; title: string };
  onBackToCourse: () => void;
  onNextChapter?: () => void;
}

export function ChapterCompleteCard({
  chapterTitle,
  recap,
  nextChapter,
  onBackToCourse,
  onNextChapter,
}: ChapterCompleteCardProps) {
  return (
    <section className="rounded-3xl border border-black/[0.05] bg-surface p-5 text-center shadow-card sm:p-6">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-primary">本章完成</h2>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-[1.7] text-secondary">
        「{chapterTitle}」的学习内容已经完成。
      </p>

      {recap && (
        <div className="mt-5 text-left">
          <ChapterRecapView recap={recap} />
        </div>
      )}

      {nextChapter && !recap?.nextChapterPreview && (
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-black/[0.05] bg-subtle/50 px-4 py-3 text-left">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary">下一章</p>
            <p className="mt-1 truncate text-[13px] font-medium text-primary">{nextChapter.title}</p>
          </div>
          <span className="h-7 w-7 shrink-0 rounded-full bg-accent/10 text-accent">
            <svg className="h-full w-full p-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </span>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {nextChapter && onNextChapter ? (
          <>
            <button
              type="button"
              onClick={onNextChapter}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[14px] font-semibold text-primary transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent/20 active:translate-y-0"
            >
              <span>继续下一章</span>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onBackToCourse}
              className="w-full rounded-full border border-black/[0.07] bg-surface py-3 text-[13px] font-medium text-secondary transition-colors hover:bg-subtle"
            >
              回到课程
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onBackToCourse}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[14px] font-semibold text-primary transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent/20 active:translate-y-0"
          >
            <span>回到课程</span>
          </button>
        )}
      </div>
    </section>
  );
}
