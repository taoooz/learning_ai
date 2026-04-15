// components/ui/chat/ChatHeader.tsx

import { AssistantGlyph } from './AssistantGlyph';

interface ChatHeaderProps {
  courseTitle: string;
  onClose: () => void;
}

export function ChatHeader({ courseTitle, onClose }: ChatHeaderProps) {
  return (
    <div className="border-b border-black/6 px-4 pb-3 pt-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              <AssistantGlyph className="h-4.5 w-4.5 shrink-0" />
            </span>
            <p className="flex min-h-5 items-center text-[11px] leading-none font-medium uppercase tracking-[0.16em] text-secondary/72">
              学习助理
            </p>
          </div>
          <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-primary">
            一起拆开这节内容
          </h2>
          <p className="mt-1 truncate text-sm text-secondary">
            当前课程：{courseTitle}
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.045] text-secondary transition-colors hover:bg-black/[0.08] hover:text-primary"
          aria-label="关闭助理"
        >
          <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
