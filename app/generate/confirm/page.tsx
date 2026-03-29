'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { ConfirmationCard } from '@/components/ConfirmationCard';
import type { OutlineBlueprint, OutlineResponse } from '@/types/course';

function ConfirmPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic') || '';
  const { submitOutlineMessage } = useCourse();

  const [response, setResponse] = useState<OutlineResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (topic) {
      fetchOutline();
    }
  }, [topic]);

  const fetchOutline = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await submitOutlineMessage(topic) as OutlineResponse;
      setResponse(result);
      // 初始化答案
      if (result.questions) {
        const initialAnswers: Record<string, string> = {};
        result.questions.forEach(q => {
          initialAnswers[q.id] = '';
        });
        setAnswers(initialAnswers);
      }
    } catch (err) {
      setError('生成失败，请稍后重试');
    }
    setIsLoading(false);
  };

  const handleAnswerChange = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleSubmitAnswers = async () => {
    if (!response?.questions) return;

    // 检查是否所有问题都已回答
    const unanswered = response.questions.filter(q => !answers[q.id]);
    if (unanswered.length > 0) {
      setError('请回答所有问题');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // 构建回答字符串
      const answerText = response.questions
        .map(q => `${q.question}: ${answers[q.id]}`)
        .join('; ');
      const result = await submitOutlineMessage(topic, answerText) as OutlineResponse;
      setResponse(result);
      if (result.questions) {
        const initialAnswers: Record<string, string> = {};
        result.questions.forEach(q => {
          initialAnswers[q.id] = '';
        });
        setAnswers(initialAnswers);
      }
    } catch (err) {
      setError('提交失败，请稍后重试');
    }
    setIsSubmitting(false);
  };

  const handleConfirm = (bp: OutlineBlueprint) => {
    // 存储 outline 到 sessionStorage（不包含 nodes）
    sessionStorage.setItem('pendingOutline', JSON.stringify({
      topic,
      learningDirection: bp.learningDirection,
      learningGoal: bp.learningGoal,
      learnerPositioning: bp.learnerPositioning,
    }));
    router.push(`/generate/toc?topic=${encodeURIComponent(topic)}`);
  };

  const handleRetry = () => {
    fetchOutline();
  };

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center">
            <svg className="w-6 h-6 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-secondary text-sm">分析你的背景信息...</p>
        </div>
      </main>
    );
  }

  if (error && !response) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-error mb-4">{error}</p>
          <button
            onClick={handleRetry}
            className="px-6 py-3 rounded-full bg-accent text-white"
          >
            重试
          </button>
        </div>
      </main>
    );
  }

  // 提问模式
  if (response?.type === 'questions' && response.questions && response.questions.length > 0) {
    return (
      <main className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 p-6">
          <div className="max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-2">补充信息</h1>
            <p className="text-secondary mb-6">请回答以下问题，帮助我们为你定制课程：</p>

            <div className="space-y-6">
              {response.questions.map((q, index) => (
                <div key={q.id} className="bg-card border rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">
                      {index + 1}
                    </span>
                    <div className="flex-1">
                      <p className="font-medium mb-3">{q.question}</p>
                      <div className="space-y-2">
                        {q.options?.map((option, optIndex) => (
                          <label
                            key={optIndex}
                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                              answers[q.id] === option
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:border-primary/50'
                            }`}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              value={option}
                              checked={answers[q.id] === option}
                              onChange={() => handleAnswerChange(q.id, option)}
                              className="w-4 h-4 text-primary"
                            />
                            <span className="text-sm">{option}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <p className="text-error text-sm mt-4">{error}</p>
            )}

            <button
              onClick={handleSubmitAnswers}
              disabled={isSubmitting}
              className="w-full mt-6 px-6 py-3 rounded-full bg-primary text-white font-medium disabled:opacity-50"
            >
              {isSubmitting ? '提交中...' : '确认答案'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // 重新思考模式
  if (response?.type === 'reconsider') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-4">
          <p className="text-secondary mb-4">{response.message || '让我重新思考一下...'}</p>
          <button
            onClick={handleRetry}
            className="px-6 py-3 rounded-full bg-accent text-white"
          >
            重新生成
          </button>
        </div>
      </main>
    );
  }

  // 确认模式
  if (response?.type === 'confirmation' && response.blueprint) {
    return (
      <main className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 p-6">
          <div className="max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-2">课程纲要</h1>
            <p className="text-secondary mb-6">请确认以下课程纲要是否满足你的需求：</p>

            <ConfirmationCard
              blueprint={response.blueprint}
              onConfirm={handleConfirm}
              onEdit={() => {}}
            />

            {error && (
              <p className="text-error text-sm mt-4 text-center">{error}</p>
            )}
          </div>
        </div>
      </main>
    );
  }

  // 默认加载状态
  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center">
          <svg className="w-6 h-6 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        <p className="text-secondary text-sm">加载中...</p>
      </div>
    </main>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center">
            <svg className="w-6 h-6 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-secondary text-sm">加载中...</p>
        </div>
      </main>
    }>
      <ConfirmPageContent />
    </Suspense>
  );
}
