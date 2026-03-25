'use client';

interface LegendProps {
  items: string[];        // ['🔵 蓝色=同步', '🟢 绿色=异步']
}

export function Legend({ items }: LegendProps) {
  return (
    <div className="my-4 flex flex-wrap gap-2">
      {items.map((item, i) => (
        <span
          key={i}
          className="inline-flex items-center px-3 py-1.5 bg-surface rounded-full text-sm text-secondary border border-subtle"
        >
          {item}
        </span>
      ))}
    </div>
  );
}