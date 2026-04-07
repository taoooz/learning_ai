'use client';

interface KeyPointsListProps {
  items: string[];        // ['要点1', '要点2', '要点3']
}

export function KeyPointsList({ items }: KeyPointsListProps) {
  return (
    <div className="my-6 space-y-3 p-3 sm:p-4 bg-subtle/30 rounded-lg">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2.5 sm:gap-3 group">
          <span className="flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-accent text-white text-xs sm:text-sm flex items-center justify-center font-semibold shadow-sm">
            {i + 1}
          </span>
          <span className="text-secondary leading-relaxed pt-0.5 text-sm">{item}</span>
        </div>
      ))}
    </div>
  );
}