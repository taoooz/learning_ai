'use client';

import { useRouter } from 'next/navigation';

interface NavHeaderProps {
  title: string;
  showBack?: boolean;
  backHref?: string;
  onBack?: () => void;
}

export function NavHeader({ title, showBack = true, backHref, onBack }: NavHeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (backHref) {
      router.push(backHref);
    } else {
      router.back();
    }
  };

  return (
    <div className="flex items-center gap-3 mb-4">
      {showBack && (
        <button
          onClick={handleBack}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-surface border border-subtle hover:bg-subtle transition-colors"
          aria-label="返回"
        >
          <svg className="w-5 h-5 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <h1 className="text-lg font-semibold text-primary truncate">{title}</h1>
    </div>
  );
}
