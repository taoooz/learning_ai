'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { ConfirmationCard } from '@/components/ConfirmationCard';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import type { OutlineBlueprint, OutlineResponse } from '@/types/course';

function ConfirmPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic') || '';
  const { submitOutlineMessage } = useCourse();

  // 用于重试时强制重新初始化
  const [retryKey, setRetryKey] = useState(0);

  const [response, setResponse] = useState<OutlineResponse | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<{ id: string; question: string; options?: string[] } | null>(null);
  const [currentAnswer, setCurrentAnswer] = useState<string>('');
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0); // 从0开始，显示时+1
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 编辑态
  const [isEditing, setIsEditing] = useState(false);
  const [editedBlueprint, setEditedBlueprint] = useState<OutlineBlueprint | null>(null);

  // 用于标记是否已经发起过请求（防止 Strict Mode 重复请求）
  const hasRequestedRef = useRef(false);

  useEffect(() => {
    if (!topic) return;

    // 如果已经发起过请求，直接返回
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const result = await submitOutlineMessage(topic);
        handleResponse(result);
        setIsLoading(false);
      } catch (err) {
        setError('生成失败，请稍后重试');
        setIsLoading(false);
      }
    };

    fetchData();
  }, [topic, retryKey, submitOutlineMessage]);

  const handleResponse = (result: OutlineResponse) => {
    console.log('[DEBUG] handleResponse:', JSON.stringify(result));
    setResponse(result);

    if (result.type === 'confirmation' && result.blueprint) {
      console.log('[DEBUG] type=confirmation, showing blueprint');
      setCurrentQuestion(null);
    } else if (result.type === 'questions' && result.questions && result.questions.length > 0) {
      console.log('[DEBUG] type=questions, showing question:', result.questions[0]);
      setCurrentQuestion(result.questions[0]);
      // 不在这里 +1，保持 index 为实际问题数量
    } else if (result.type === 'reconsider') {
      console.log('[DEBUG] type=reconsider');
      setCurrentQuestion(null);
    } else {
      console.log('[DEBUG] unknown response type:', result.type);
    }
  };

  const handleAnswerSubmit = async () => {
    if (!currentAnswer || !currentQuestion) return;

    setIsSubmitting(true);
    setError(null);

    const newAnswers = [...answers, currentAnswer];
    setAnswers(newAnswers);
    setCurrentAnswer('');
    setCurrentQuestionIndex(prev => prev + 1); // 提交后才 +1

    try {
      const answerText = newAnswers.join('; ');
      const result = await submitOutlineMessage(topic, answerText) as OutlineResponse;
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
    hasRequestedRef.current = false; // 重置请求标记
    setRetryKey(k => k + 1);
  };

  // 进入编辑态
  const handleEdit = () => {
    if (response?.blueprint) {
      setEditedBlueprint({ ...response.blueprint });
      setIsEditing(true);
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditedBlueprint(null);
    setIsEditing(false);
  };

  // 确认编辑内容并跳转
  const handleConfirmEdit = () => {
    if (editedBlueprint) {
      sessionStorage.setItem('pendingOutline', JSON.stringify({
        topic,
        learningDirection: editedBlueprint.learningDirection,
        learningGoal: editedBlueprint.learningGoal,
        learnerPositioning: editedBlueprint.learnerPositioning,
      }));
      router.push(`/generate/toc?topic=${encodeURIComponent(topic)}`);
    }
  };

  // Loading 状态 - 温暖极简风格
  if (isLoading) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-background">
        {/* 装饰性渐变光晕 */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-gradient-to-br from-accent/10 to-transparent blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-gradient-to-tr from-accent/8 to-transparent blur-3xl" />
        </div>

        {/* 头部导航 */}
        <CourseHeaderBar
          title="生成中"
          backLabel="返回"
          onBack={() => router.push('/')}
        />

        <div className="relative text-center pt-24">
          {/* 动画图标 */}
          <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-surface shadow-[0_8px_32px_rgba(255,138,0,0.12)]">
            <svg className="h-10 w-10 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>

          <h2 className="mb-2 text-xl font-semibold text-primary">正在分析你的背景</h2>
          <p className="text-sm text-secondary">为你定制专属学习路径...</p>
        </div>
      </main>
    );
  }

  // 错误状态
  if (error && !response) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-background">
        {/* 装饰性渐变光晕 */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-gradient-to-br from-error/8 to-transparent blur-3xl" />
        </div>

        {/* 头部导航 */}
        <CourseHeaderBar
          title="出错了"
          backLabel="返回"
          onBack={() => router.push('/')}
        />

        <div className="relative text-center max-w-sm mx-auto px-6 pt-24">
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-error/10">
            <svg className="h-8 w-8 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-semibold text-primary">生成失败</h2>
          <p className="mb-6 text-sm text-secondary">{error}</p>
          <button
            onClick={handleRetry}
            className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--color-cta)] px-8 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(17,24,39,0.18)] transition-all duration-150 hover:shadow-[0_12px_28px_rgba(17,24,39,0.22)] active:scale-[0.98]"
          >
            重新尝试
          </button>
        </div>
      </main>
    );
  }

  // 重新思考模式
  if (response?.type === 'reconsider') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-background">
        {/* 装饰性渐变光晕 */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-gradient-to-br from-accent/10 to-transparent blur-3xl" />
        </div>

        {/* 头部导航 */}
        <CourseHeaderBar
          title="重新生成"
          backLabel="返回"
          onBack={() => router.push('/')}
        />

        <div className="relative text-center max-w-sm mx-auto px-6 pt-24">
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
            <svg className="h-8 w-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-semibold text-primary">让我重新思考</h2>
          <p className="mb-6 text-sm text-secondary">{response.message || '正在为你重新设计方案...'}</p>
          <button
            onClick={handleRetry}
            className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--color-cta)] px-8 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(17,24,39,0.18)] transition-all duration-150 hover:shadow-[0_12px_28px_rgba(17,24,39,0.22)] active:scale-[0.98]"
          >
            重新生成
          </button>
        </div>
      </main>
    );
  }

  // 单题提问模式 - 温暖卡片风格
  if (currentQuestion) {
    const questionNumber = currentQuestionIndex + 1;

    return (
      <main className="min-h-screen bg-background">
        {/* 顶部装饰 */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-accent/8 to-transparent blur-3xl" />
        </div>

        {/* 头部导航 - 使用固定顶部导航栏 */}
        <CourseHeaderBar
          title="补充信息"
          backLabel="返回"
          onBack={() => router.push('/')}
        />

        <div className="relative mx-auto max-w-lg px-5 pt-24 pb-12">
          {/* 顶部标签 */}
          <div className="mb-6 flex items-center gap-2">
            <span className="inline-flex h-7 items-center rounded-full bg-accent/12 px-3 text-xs font-medium text-accent">
              第 {questionNumber} 题
            </span>
            <span className="text-xs text-tertiary">帮助你更好地学习</span>
          </div>

          {/* 标题 */}
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-primary">
            {currentQuestion.question}
          </h1>
          <p className="mb-8 text-sm text-secondary">
            选择最符合你情况的选项
          </p>

          {/* 选项列表 - 卡片风格 */}
          <div className="mb-8 space-y-3">
            {currentQuestion.options?.map((option, optIndex) => {
              const isSelected = currentAnswer === option;
              const optionLetter = String.fromCharCode(65 + optIndex);

              return (
                <button
                  key={optIndex}
                  onClick={() => setCurrentAnswer(option)}
                  className={`
                    group w-full rounded-2xl border p-4 text-left transition-all duration-200
                    ${isSelected
                      ? 'border-accent/40 bg-[linear-gradient(135deg,rgba(255,138,0,0.08),rgba(255,248,240,1))] shadow-[0_4px_16px_rgba(255,138,0,0.12)]'
                      : 'border-[rgba(0,0,0,0.06)] bg-surface hover:border-accent/20 hover:bg-accent/[0.02]'
                    }
                  `}
                >
                  <div className="flex items-start gap-3">
                    {/* 选项字母标识 */}
                    <div className={`
                      flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors
                      ${isSelected
                        ? 'bg-accent text-white'
                        : 'bg-[rgba(0,0,0,0.04)] text-secondary group-hover:bg-accent/10 group-hover:text-accent'
                      }
                    `}>
                      {optionLetter}
                    </div>
                    {/* 选项文字 */}
                    <span className={`text-[15px] leading-relaxed ${isSelected ? 'text-primary font-medium' : 'text-[rgba(31,31,31,0.82)]'}`}>
                      {option}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 错误提示 */}
          {error && (
            <p className="mb-4 text-center text-sm text-error">{error}</p>
          )}

          {/* 提交按钮 - CTA 风格 */}
          <button
            onClick={handleAnswerSubmit}
            disabled={!currentAnswer || isSubmitting}
            className="inline-flex h-13 w-full items-center justify-center rounded-full bg-[var(--color-cta)] text-[var(--color-cta-text)] px-6 py-3.5 text-sm font-semibold shadow-[0_8px_24px_rgba(17,24,39,0.18)] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 hover:shadow-[0_12px_28px_rgba(17,24,39,0.22)] active:scale-[0.98]"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                提交中...
              </span>
            ) : '确认选择'
            }
          </button>
        </div>
      </main>
    );
  }

  // 确认模式
  if (response?.type === 'confirmation' && response.blueprint) {
    // 编辑态
    if (isEditing && editedBlueprint) {
      return (
        <main className="min-h-screen bg-background">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-accent/6 to-transparent blur-3xl" />
            <div className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-accent/4 to-transparent blur-3xl" />
          </div>

          <CourseHeaderBar
            title="编辑课程纲要"
            backLabel="取消"
            onBack={handleCancelEdit}
          />

          <div className="relative mx-auto max-w-lg px-5 pt-24 pb-12">
            <div className="bg-surface border border-[rgba(0,0,0,0.06)] rounded-2xl p-5 shadow-[0_8px_32px_rgba(255,138,0,0.08)]">
              <div className="space-y-5">
                {/* 学习方向 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-accent uppercase tracking-wide">学习方向</label>
                  <textarea
                    value={editedBlueprint.learningDirection}
                    onChange={(e) => setEditedBlueprint({ ...editedBlueprint, learningDirection: e.target.value })}
                    className="w-full h-20 px-4 py-3 rounded-xl border border-[rgba(0,0,0,0.08)] bg-background text-[15px] text-primary leading-relaxed resize-none focus:outline-none focus:border-accent/40"
                  />
                </div>

                {/* 学习目标 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-accent uppercase tracking-wide">学习目标</label>
                  <textarea
                    value={editedBlueprint.learningGoal}
                    onChange={(e) => setEditedBlueprint({ ...editedBlueprint, learningGoal: e.target.value })}
                    className="w-full h-20 px-4 py-3 rounded-xl border border-[rgba(0,0,0,0.08)] bg-background text-[15px] text-primary leading-relaxed resize-none focus:outline-none focus:border-accent/40"
                  />
                </div>

                {/* 难度级别 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-accent uppercase tracking-wide">难度级别</label>
                  <div className="flex gap-2">
                    {(['novice', 'beginner', 'intermediate', 'advanced'] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => setEditedBlueprint({
                          ...editedBlueprint,
                          learnerPositioning: { ...editedBlueprint.learnerPositioning, estimatedLevel: level }
                        })}
                        className={`flex-1 h-10 rounded-full text-sm font-medium transition-all ${
                          editedBlueprint.learnerPositioning.estimatedLevel === level
                            ? 'bg-accent text-white'
                            : 'bg-[rgba(0,0,0,0.04)] text-secondary hover:bg-accent/10'
                        }`}
                      >
                        {{ novice: '初学者', beginner: '入门', intermediate: '进阶', advanced: '高级' }[level]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 难度定位 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-accent uppercase tracking-wide">难度定位</label>
                  <input
                    type="text"
                    value={editedBlueprint.learnerPositioning.difficultySummary}
                    onChange={(e) => setEditedBlueprint({
                      ...editedBlueprint,
                      learnerPositioning: { ...editedBlueprint.learnerPositioning, difficultySummary: e.target.value }
                    })}
                    className="w-full h-11 px-4 rounded-xl border border-[rgba(0,0,0,0.08)] bg-background text-[15px] text-primary focus:outline-none focus:border-accent/40"
                  />
                </div>

                {/* 背景知识 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-accent uppercase tracking-wide">背景知识</label>
                  <input
                    type="text"
                    value={editedBlueprint.learnerPositioning.backgroundSummary}
                    onChange={(e) => setEditedBlueprint({
                      ...editedBlueprint,
                      learnerPositioning: { ...editedBlueprint.learnerPositioning, backgroundSummary: e.target.value }
                    })}
                    className="w-full h-11 px-4 rounded-xl border border-[rgba(0,0,0,0.08)] bg-background text-[15px] text-primary focus:outline-none focus:border-accent/40"
                  />
                </div>

                {/* 为什么适合 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-accent uppercase tracking-wide">为什么适合你</label>
                  <textarea
                    value={editedBlueprint.learnerPositioning.whyThisCourseFits}
                    onChange={(e) => setEditedBlueprint({
                      ...editedBlueprint,
                      learnerPositioning: { ...editedBlueprint.learnerPositioning, whyThisCourseFits: e.target.value }
                    })}
                    className="w-full h-20 px-4 py-3 rounded-xl border border-[rgba(0,0,0,0.08)] bg-background text-[15px] text-primary leading-relaxed resize-none focus:outline-none focus:border-accent/40"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCancelEdit}
                  className="flex-1 h-12 px-5 py-3 border border-[rgba(0,0,0,0.08)] rounded-full text-sm font-medium text-secondary bg-surface hover:bg-[rgba(0,0,0,0.03)] active:scale-[0.98] transition-all duration-150"
                >
                  返回
                </button>
                <button
                  onClick={handleConfirmEdit}
                  className="flex-1 h-12 px-5 py-3 bg-[var(--color-cta)] text-[var(--color-cta-text)] rounded-full text-sm font-semibold shadow-[0_8px_24px_rgba(255,138,0,0.25)] hover:shadow-[0_12px_28px_rgba(255,138,0,0.32)] active:scale-[0.98] transition-all duration-150"
                >
                  确认修改
                </button>
              </div>
            </div>
          </div>
        </main>
      );
    }

    // 只读态
    return (
      <main className="min-h-screen bg-background">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-accent/6 to-transparent blur-3xl" />
          <div className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-accent/4 to-transparent blur-3xl" />
        </div>

        <CourseHeaderBar
          title="课程纲要"
          backLabel="返回"
          onBack={() => router.push('/')}
        />

        <div className="relative mx-auto max-w-lg px-5 pt-24 pb-12">
          <ConfirmationCard
            blueprint={response.blueprint}
            onConfirm={handleConfirm}
            onEdit={handleEdit}
          />

          {error && (
            <p className="mt-4 text-center text-sm text-error">{error}</p>
          )}
        </div>
      </main>
    );
  }

  // 默认加载状态
  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="mb-4 h-12 w-12 animate-spin rounded-full border-2 border-accent/20 border-t-accent mx-auto" />
        <p className="text-sm text-secondary">加载中...</p>
      </div>
    </main>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-2 border-accent/20 border-t-accent mx-auto" />
          <p className="text-sm text-secondary">加载中...</p>
        </div>
      </main>
    }>
      <ConfirmPageContent />
    </Suspense>
  );
}
