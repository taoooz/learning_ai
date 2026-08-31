'use client';

// components/learning-v2/ChapterCompleteCard.tsx
// V2 章节完成卡：完成态展示 + 章节小结（lesson.recap）+ 下一章入口（解锁后）+ 回课程页
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
    <div className="rounded-3xl border border-black/6 bg-surface p-6 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-[28px]">
        🎉
      </div>
      <h2 className="text-[17px] font-semibold text-primary">本章完成</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">
        「{chapterTitle}」的全部学习任务已完成。
      </p>
      {recap && (
        <div className="mt-4 text-left">
          <ChapterRecapView recap={recap} />
        </div>
      )}
      <div className="mt-5 flex flex-col gap-2.5">
        {nextChapter && onNextChapter && (
          <button
            type="button"
            onClick={onNextChapter}
            className="w-full rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
          >
            继续下一章：{nextChapter.title}
          </button>
        )}
        <button
          type="button"
          onClick={onBackToCourse}
          className={`w-full rounded-full px-5 py-2.5 text-[14px] font-medium transition-colors ${
            nextChapter && onNextChapter
              ? 'bg-subtle text-secondary hover:bg-subtle/80'
              : 'bg-accent text-white hover:opacity-90'
          }`}
        >
          回到课程
        </button>
      </div>
    </div>
  );
}
