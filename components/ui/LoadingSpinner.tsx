// components/ui/LoadingSpinner.tsx
'use client';

export function LoadingSpinner({ message = '加载中...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh]">
      <div className="relative w-16 h-16">
        <div className="absolute top-0 left-0 w-full h-full border-4 border-subtle rounded-full" />
        <div className="absolute top-0 left-0 w-full h-full border-4 border-accent rounded-full animate-spin" />
      </div>
      <p className="mt-4 text-secondary">{message}</p>
    </div>
  );
}