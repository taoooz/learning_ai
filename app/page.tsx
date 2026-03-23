// app/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';

export default function HomePage() {
  const [topic, setTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { generateCourse } = useCourse();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setIsGenerating(true);
    setError('');

    try {
      await generateCourse(topic.trim());
      router.push('/generate');
    } catch {
      setError('Failed to generate course. Please try again.');
      setIsGenerating(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Learning</h1>
          <p className="text-gray-600">输入任何感兴趣的主题，开始你的学习之旅</p>
        </div>

        {/* 输入表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：日本江户时代历史"
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
              disabled={isGenerating}
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={!topic.trim() || isGenerating}
            className="w-full py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isGenerating ? 'Generating...' : 'Start Learning →'}
          </button>
        </form>

        {/* 示例主题 */}
        <div className="mt-6">
          <p className="text-sm text-gray-500 mb-3">Try these topics:</p>
          <div className="flex flex-wrap gap-2">
            {['量子力学入门', '印象派绘画', '古罗马历史'].map((t) => (
              <button
                key={t}
                onClick={() => setTopic(t)}
                className="px-3 py-1 rounded-full bg-white border border-gray-200 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-500"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
