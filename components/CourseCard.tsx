'use client';

import { useEffect, useRef, useState } from 'react';
import type { CourseTree } from '@/types/course';

const COURSE_PALETTES = [
  'bg-[linear-gradient(135deg,rgba(255,138,0,0.12),rgba(255,250,244,0.95)_42%,rgba(255,255,255,0.98))]',
  'bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(255,248,238,0.95)_42%,rgba(255,255,255,0.98))]',
  'bg-[linear-gradient(135deg,rgba(251,191,36,0.10),rgba(255,250,242,0.95)_42%,rgba(255,255,255,0.98))]',
  'bg-[linear-gradient(135deg,rgba(249,115,22,0.10),rgba(255,247,240,0.95)_42%,rgba(255,255,255,0.98))]',
];

function getCourseProgress(course: CourseTree) {
  const completed = course.nodes.filter((node) => node.status === 'completed').length;
  const total = course.nodes.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percent };
}

function getNextNodeTitle(course: CourseTree) {
  const nextNode = course.nodes.find((node) => node.status !== 'completed');
  return nextNode?.title ?? '复习已完成内容';
}

interface CourseCardProps {
  course: CourseTree;
  index: number;
  onContinue: (courseId: string) => void;
  onDelete: (courseId: string) => void;
}

export function CourseCard({ course, index, onContinue, onDelete }: CourseCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMenu(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [showMenu]);

  const progress = getCourseProgress(course);
  const nextNodeTitle = getNextNodeTitle(course);
  const palette = COURSE_PALETTES[index % COURSE_PALETTES.length];

  return (
    <article
      className={`rounded-[24px] p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-all duration-200 hover:shadow-[0_4px_20px_rgba(0,0,0,0.08)] ${palette}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[20px] font-bold text-primary line-clamp-2">{course.topic}</h3>
          <p className="mt-2 text-[15px] text-secondary line-clamp-1">
            下一节：{nextNodeTitle}
          </p>
        </div>
        <div className="rounded-2xl bg-white/80 px-3.5 py-2.5 text-right shadow-sm">
          <div className="text-[24px] font-bold text-accent">{progress.percent}%</div>
          <div className="text-xs text-secondary">进度</div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => onContinue(course.courseId)}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-cta px-5 py-3 text-[15px] font-semibold text-cta shadow-[0_4px_16px_rgba(255,138,0,0.15)] transition-all duration-150 hover:shadow-[0_6px_20px_rgba(255,138,0,0.20)] active:scale-[0.985]"
        >
          继续学习
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            aria-label={`管理 ${course.topic}`}
            className="flex h-12 w-12 items-center justify-center rounded-full text-tertiary transition-all duration-150 hover:bg-white/60 hover:text-primary"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="6" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="18" r="2" />
            </svg>
          </button>

          {showMenu && (
            <div
              ref={menuRef}
              className="absolute bottom-[3.75rem] right-0 z-10 min-w-[132px] rounded-2xl border border-white/80 bg-white p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-sm"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(course.courseId);
                  setShowMenu(false);
                }}
                className="flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium text-error transition-colors hover:bg-error/10"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                删除主题
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
