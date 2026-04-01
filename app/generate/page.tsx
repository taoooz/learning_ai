// app/generate/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GeneratePage() {
  const router = useRouter();
  const [topic, setTopic] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (topic.trim()) {
      router.push(`/generate/chat?topic=${encodeURIComponent(topic)}`);
    }
  };

  return (
    <main className="min-h-[100svh] flex items-center justify-center bg-background p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">你想学习什么？</h1>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="例如：React Hooks 深入理解"
          className="w-full rounded-xl border p-4 min-h-[120px] resize-none"
        />
        <button
          type="submit"
          disabled={!topic.trim()}
          className="w-full mt-4 bg-primary text-white rounded-xl py-3 font-medium disabled:opacity-50"
        >
          开始
        </button>
      </form>
    </main>
  );
}