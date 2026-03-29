'use client';

import { useRouter } from 'next/navigation';

export default function ReviewClarificationPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">页面已迁移</h1>
        <p className="text-secondary mb-6">此页面已整合到课程创建流程中</p>
        <button
          onClick={() => router.push('/')}
          className="px-6 py-3 rounded-full bg-cta text-white"
        >
          返回首页
        </button>
      </div>
    </main>
  );
}
