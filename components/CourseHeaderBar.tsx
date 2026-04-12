'use client';

interface CourseHeaderBarProps {
  title: React.ReactNode;
  backLabel: string;
  onBack: () => void;
  trailing?: React.ReactNode;
  streak?: { count: number; studiedToday: boolean };
  maxWidthClassName?: string;
}

function getStreakColor(count: number): string {
  if (count >= 7) return 'text-red-500';
  if (count >= 3) return 'text-accent';
  return 'text-amber-400';
}

function StreakFire({ count, studiedToday }: { count: number; studiedToday: boolean }) {
  const colorClass = studiedToday ? getStreakColor(count) : 'text-tertiary';
  const opacityClass = studiedToday ? '' : 'opacity-40';

  return (
    <div className={`flex shrink-0 items-center gap-1 ${opacityClass}`}>
      <svg className={`h-4 w-4 ${colorClass}`} viewBox="0 0 20 20" fill="currentColor">
        <path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" />
      </svg>
      <span className={`text-[13px] font-semibold ${studiedToday ? colorClass : 'text-tertiary'}`}>
        {count}
      </span>
    </div>
  );
}

export function CourseHeaderBar({
  title,
  backLabel,
  onBack,
  trailing,
  streak,
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

            {streak && streak.count > 0 && (
              <StreakFire count={streak.count} studiedToday={streak.studiedToday} />
            )}

            {trailing}
          </div>
        </div>
      </div>
    </div>
  );
}
