'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { ConfirmationCard } from '@/components/ConfirmationCard';
import { parseSSEStream } from '@/app/generate/chat/utils/sseParser';
import type { OutlineBlueprint, OutlineResponse } from '@/types/course';

/**
 * 从 SSE 流中提取最终结构化结果（供非流式页面使用）
 */
async function consumeOutlineStream(response: Response): Promise<OutlineResponse> {
  let sessionId: string | null = null;
  let blueprint: OutlineBlueprint | null = null;
  let questions: Array<{ id: string; question: string; options?: string[] }> = [];

  for await (const event of parseSSEStream(response)) {
    switch (event.type) {
      case 'session_created':
        sessionId = event.sessionId;
        break;
      case 'confirmation':
        blueprint = event.blueprint as OutlineBlueprint;
        sessionId = event.sessionId ?? sessionId;
        break;
      case 'questions':
        questions = event.questions ?? [];
        sessionId = event.sessionId ?? sessionId;
        break;
    }
  }

  if (sessionId) {
    sessionStorage.setItem('outlineSessionId', sessionId);
  }

  if (blueprint) {
    return { type: 'confirmation', blueprint };
  }
  if (questions.length > 0) {
    return { type: 'questions', questions: questions.map(q => ({ ...q, type: 'single' as const })) };
  }
  return { type: 'reconsider', message: '让我重新思考一下...' };
}

function ConfirmPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic') || '';
  const { submitOutlineMessage } = useCourse();

  const [response, setResponse] = useState<OutlineResponse | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<{ id: string; question: string; options?: string[] } | null>(null);
  const [currentAnswer, setCurrentAnswer] = useState<string>('');
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (topic) {
      // 清除之前的 session，开始新的生成
      sessionStorage.removeItem('outlineSessionId');
      fetchInitialOutline();
    }
  }, [topic]);

  const fetchInitialOutline = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await submitOutlineMessage(topic);
      const result = await consumeOutlineStream(resp);
      handleResponse(result);
    } catch (err) {
      setError('生成失败，请稍后重试');
    }
    setIsLoading(false);
  };

  const handleResponse = (result: OutlineResponse) => {
    setResponse(result);

    if (result.type === 'confirmation' && result.blueprint) {
      // 纲要已生成，直接显示确认
      setCurrentQuestion(null);
    } else if (result.type === 'questions' && result.questions && result.questions.length > 0) {
      // 有问题，先问第一个
      setCurrentQuestion(result.questions[0]);
      setCurrentQuestionIndex(0);
      setAnswers([]);
    } else if (result.type === 'reconsider') {
      // 模型重新思考，等用户触发重试
      setCurrentQuestion(null);
    }
  };

  const handleAnswerSubmit = async () => {
    if (!currentAnswer || !currentQuestion) return;

    setIsSubmitting(true);
    setError(null);

    const newAnswers = [...answers, currentAnswer];
    setAnswers(newAnswers);
    setCurrentAnswer('');

    try {
      // 将之前所有答案合并发送给模型
      const answerText = newAnswers.join('; ');
      const resp = await submitOutlineMessage(topic, answerText);
      const result = await consumeOutlineStream(resp);
      handleResponse(result);
    } catch (err) {
      setError('提交失败，请稍后重试');
    }
    setIsSubmitting(false);
  };

  const handleConfirm = (bp: OutlineBlueprint) => {
    sessionStorage.setItem('pendingOutline', JSON.stringify({
      topic,
      learningDirection: bp.learningDirection,
      learningGoal: bp.learningGoal,
      learnerPositioning: bp.learnerPositioning,
    }));
    router.push(`/generate/toc?topic=${encodeURIComponent(topic)}`);
  };

  const handleRetry = () => {
    fetchInitialOutline();
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

  // 单题提问模式
  if (currentQuestion) {
    const questionNumber = currentQuestionIndex + 1;
    const totalPossible = response?.questions?.length || 1;

    return (
      <main className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 p-6">
          <div className="max-w-2xl mx-auto">
            <div className="mb-6">
              <p className="text-sm text-muted mb-1">问题 {questionNumber}</p>
              <h1 className="text-2xl font-bold">补充信息</h1>
              <p className="text-secondary mt-2">请回答以下问题，帮助我们为你定制课程：</p>
            </div>

            <div className="bg-card border rounded-xl p-6">
              <p className="font-medium text-lg mb-4">{currentQuestion.question}</p>
              <div className="space-y-3">
                {currentQuestion.options?.map((option, optIndex) => (
                  <label
                    key={optIndex}
                    className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                      currentAnswer === option
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="answer"
                      value={option}
                      checked={currentAnswer === option}
                      onChange={() => setCurrentAnswer(option)}
                      className="w-5 h-5 text-primary"
                    />
                    <span className="text-base">{option}</span>
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-error text-sm mt-4">{error}</p>
            )}

            <button
              onClick={handleAnswerSubmit}
              disabled={!currentAnswer || isSubmitting}
              className="w-full mt-6 px-6 py-3 rounded-full bg-primary text-white font-medium disabled:opacity-50"
            >
              {isSubmitting ? '提交中...' : '确认答案'}
            </button>
          </div>
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
