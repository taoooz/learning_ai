'use client';

interface CourseHeaderBarProps {
  title: React.ReactNode;
  backLabel: string;
  onBack: () => void;
  trailing?: React.ReactNode;
  maxWidthClassName?: string;
}

export function CourseHeaderBar({
  title,
  backLabel,
  onBack,
  trailing,
  maxWidthClassName = 'max-w-md',
}: CourseHeaderBarProps) {
  return (
    <div className="fixed inset-x-0 top-0 z-20 pt-4">
      <div className={`mx-auto ${maxWidthClassName} px-5 pb-2 sm:px-6`}>
        <div className="rounded-[24px] border border-white/72 bg-surface/80 px-3 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)] backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-background/92 text-secondary transition-colors hover:bg-subtle"
              aria-label={backLabel}
            >
              <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="min-w-0 flex-1 overflow-hidden">
              {typeof title === 'string' ? (
                <p className="truncate text-[15px] font-semibold leading-5 text-primary">{title}</p>
              ) : (
                <div className="truncate text-[15px] font-semibold leading-5 text-primary">{title}</div>
              )}
            </div>

            {trailing}
          </div>
        </div>
      </div>
    </div>
  );
}
