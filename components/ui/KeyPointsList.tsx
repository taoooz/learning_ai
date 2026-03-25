'use client';

interface KeyPointsListProps {
  items: string[];        // ['要点1', '要点2', '要点3']
}

export function KeyPointsList({ items }: KeyPointsListProps) {
  return (
    <div className="my-4 space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent text-sm flex items-center justify-center font-medium">
            {i + 1}
          </span>
          <span className="text-secondary">{item}</span>
        </div>
      ))}
    </div>
  );
}