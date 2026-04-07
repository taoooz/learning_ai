'use client';

interface LegendProps {
  items: string[];        // ['🔵 蓝色=同步', '🟢 绿色=异步']
}

export function Legend({ items }: LegendProps) {
  return (
    <div className="my-6 p-3 sm:p-4 bg-subtle/30 rounded-lg">
      <div className="flex flex-wrap gap-2">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center px-2.5 sm:px-3 py-1.5 bg-surface rounded-full text-xs sm:text-sm text-secondary border border-subtle/50 shadow-sm"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}