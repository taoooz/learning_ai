// components/ui/CardSkeleton.tsx
'use client';

export function CardSkeleton() {
  return (
    <div className="w-full h-full flex flex-col p-6 bg-surface-white rounded-2xl animate-pulse">
      {/* 标题骨架 */}
      <div className="h-7 w-3/4 bg-divider-light rounded-lg mb-4" />

      {/* 内容骨架 */}
      <div className="flex-1 space-y-3">
        <div className="h-4 w-full bg-divider-light rounded" />
        <div className="h-4 w-5/6 bg-divider-light rounded" />
        <div className="h-4 w-4/6 bg-divider-light rounded" />
        <div className="h-4 w-full bg-divider-light rounded" />
        <div className="h-4 w-3/6 bg-divider-light rounded" />
      </div>

      {/* 图片骨架（如果有） */}
      <div className="mt-4 h-24 w-full bg-divider-light rounded-xl" />
    </div>
  );
}
