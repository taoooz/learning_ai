// app/generate/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';

export default function GeneratePage() {
  const router = useRouter();
  const { currentCourse, generationStatus, clarification, submitClarification, setClarification } = useCourse();

  // 检查是否所有问题都已回答
  const allQuestionsAnswered = clarification
    ? clarification.questions.every(q => q.answer.trim() !== '')
    : false;

  useEffect(() => {
    if (generationStatus === 'success' && currentCourse) {
      router.replace(`/course/${currentCourse.courseId}`);
    } else if (generationStatus === 'error') {
      router.replace('/');
    }
  }, [generationStatus, currentCourse, router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-background overflow-hidden">
      {clarification ? (
        /* 澄清问题表单 */
        <div className="relative w-full max-w-lg px-4">
          <div className="bg-card rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-primary mb-6 text-center">
              为了更好地为您生成课程，请回答以下问题
            </h2>
            <div className="space-y-4">
              {clarification.questions.map((q) => (
                <div key={q.id} className="question-item">
                  <label className="block text-sm font-medium text-primary mb-2">
                    {q.question}
                  </label>
                  <textarea
                    value={q.answer}
                    onChange={(e) => {
                      setClarification(prev => prev ? {
                        ...prev,
                        questions: prev.questions.map(item =>
                          item.id === q.id ? { ...item, answer: e.target.value } : item
                        )
                      } : null)
                    }}
                    placeholder="请输入您的回答"
                    className="w-full px-4 py-3 bg-background border border-border rounded-xl text-primary placeholder:text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
                    rows={3}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={submitClarification}
              disabled={generationStatus === 'generating' || !allQuestionsAnswered}
              className="w-full mt-6 px-6 py-3 bg-accent text-white font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!allQuestionsAnswered ? '请回答所有问题' : generationStatus === 'generating' ? '生成中...' : '提交并生成课程'}
            </button>
          </div>
        </div>
      ) : (
        /* 正常加载动画 */
        <>
          {/* 背景装饰 */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-accent/15 to-transparent rounded-full blur-3xl animate-pulse" />
            <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-tr from-blue-400/10 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }} />
          </div>

          <div className="relative text-center">
            {/* 动画图标 */}
            <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center animate-bounce">
              <svg className="w-12 h-12 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>

            <h2 className="text-xl font-bold text-primary mb-2">
              正在生成你的好奇之旅...
            </h2>
            <p className="text-secondary text-sm">
              AI 正在编织知识网络
            </p>

            {/* 加载动画 */}
            <div className="mt-8 flex justify-center gap-2">
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </>
      )}
    </main>
  );
}