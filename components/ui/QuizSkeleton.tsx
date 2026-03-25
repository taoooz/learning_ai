// components/ui/QuizSkeleton.tsx
'use client';

export function QuizSkeleton() {
  return (
    <div className="w-full max-w-md mx-auto">
      {/* 进度骨架 */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-2">
          <div className="h-4 w-16 bg-subtle rounded animate-pulse" />
          <div className="h-4 w-12 bg-subtle rounded animate-pulse" />
        </div>
        <div className="w-full h-1 bg-subtle rounded animate-pulse" />
      </div>

      {/* 题目卡骨架 */}
      <div className="bg-surface rounded-lg p-6 mb-4 animate-pulse">
        {/* 题目类型 */}
        <div className="h-4 w-16 bg-subtle rounded mb-3" />
        {/* 题目文本 */}
        <div className="h-6 w-full bg-subtle rounded mb-2" />
        <div className="h-6 w-3/4 bg-subtle rounded mb-6" />

        {/* 选项骨架 */}
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-14 w-full bg-subtle rounded-lg" />
          ))}
        </div>
      </div>

      {/* 按钮骨架 */}
      <div className="flex justify-end">
        <div className="h-10 w-24 bg-subtle rounded-pill animate-pulse" />
      </div>
    </div>
  );
}
