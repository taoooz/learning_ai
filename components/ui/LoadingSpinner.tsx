// components/ui/LoadingSpinner.tsx
'use client';

export function LoadingSpinner({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh]">
      <div className="relative w-16 h-16">
        <div className="absolute top-0 left-0 w-full h-full border-4 border-gray-200 rounded-full" />
        <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-500 rounded-full animate-spin" />
      </div>
      <p className="mt-4 text-gray-600">{message}</p>
    </div>
  );
}