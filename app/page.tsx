// app/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { useProgress } from '@/contexts/ProgressContext';

export default function HomePage() {
  const [topic, setTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { courses, currentCourse, generateCourse } = useCourse();
  const { isCompleted } = useProgress();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setIsGenerating(true);
    setError('');

    try {
      await generateCourse(topic.trim());
      router.push('/generate');
    } catch {
      setError('抱歉，课程生成失败了');
      setIsGenerating(false);
    }
  };

  const handleCourseClick = (courseId: string) => {
    router.push(`/course/${courseId}`);
  };

  // 获取课程完成进度
  const getCourseProgress = (courseId: string) => {
    const course = courses.find(c => c.courseId === courseId);
    if (!course) return { completed: 0, total: 0 };
    const completed = course.nodes.filter(n => n.status === 'completed').length;
    return { completed, total: course.nodes.length };
  };

  // 按时间倒序排列课程（最新的在前面）
  const sortedCourses = [...courses].reverse();

  return (
    <main className="min-h-screen p-6 bg-gray-50 relative">
      {/* 用户设置入口 */}
      <button
        onClick={() => router.push('/profile')}
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
        aria-label="个人设置"
      >
        <svg
          className="w-5 h-5 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      </button>

      <div className="w-full max-w-md mx-auto">
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
            {isGenerating ? 'AI 正在创建课程...' : '开始学习 →'}
          </button>
        </form>

        {/* 示例主题 */}
        <div className="mt-6">
          <p className="text-sm text-gray-500 mb-3">试试这些主题：</p>
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

        {/* 历史课程列表 */}
        {sortedCourses.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">我的课程</h2>
            <div className="space-y-3">
              {sortedCourses.map((course) => {
                const progress = getCourseProgress(course.courseId);
                const isCurrentCourse = currentCourse?.courseId === course.courseId;
                return (
                  <button
                    key={course.courseId}
                    onClick={() => handleCourseClick(course.courseId)}
                    className="w-full p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all text-left"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">{course.topic}</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          {progress.completed}/{progress.total} 节已完成
                        </p>
                      </div>
                      {isCurrentCourse && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-600 text-xs rounded-full">
                          进行中
                        </span>
                      )}
                    </div>
                    {/* 进度条 */}
                    <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all"
                        style={{
                          width: progress.total > 0
                            ? `${(progress.completed / progress.total) * 100}%`
                            : '0%'
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
