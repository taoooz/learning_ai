// app/course/[courseId]/learn/[nodeIndex]/page.tsx
'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { useCourse } from '@/contexts/CourseContext';
import { useProgress } from '@/contexts/ProgressContext';
import { RetryModal } from '@/components/RetryModal';
import { LearningCard, Question } from '@/types/course';

type LearningPhase = 'loading' | 'learning' | 'complete';
type LearnStep =
  | { id: string; type: 'card'; card: LearningCard }
  | { id: string; type: 'question'; question: Question };

function extractAnswerKey(option: string): string {
  const match = option.match(/^([A-D])[.、：:]\s*/);
  return match ? match[1] : option;
}

function getOptionBadgeLabel(option: string, index: number): string {
  const extracted = extractAnswerKey(option);
  if (/^[A-D]$/.test(extracted)) return extracted;
  return String.fromCharCode(65 + index);
}

function checkIsCorrect(question: Question, selectedAnswer: string[], fillAnswer: string): boolean {
  const answer = question.answer;

  if (question.type === 'fill') {
    return fillAnswer.trim().toLowerCase() === String(answer).trim().toLowerCase();
  }

  if (question.type === 'single') {
    const selected = selectedAnswer[0];
    if (!selected) return false;
    const selectedKey = extractAnswerKey(selected);
    return selectedKey === answer || selected === answer;
  }

  if (question.type === 'multiple' && Array.isArray(answer)) {
    const selectedKeys = selectedAnswer.map(extractAnswerKey);
    return selectedKeys.length === answer.length && selectedKeys.every((key) => answer.includes(key));
  }

  return false;
}

function buildLearningSteps(cards: LearningCard[], questions: Question[]): LearnStep[] {
  if (cards.length === 0) {
    return questions.map((question) => ({
      id: `question-${question.id}`,
      type: 'question',
      question,
    }));
  }

  const steps: LearnStep[] = [];
  const questionsCount = questions.length;
  let questionCursor = 0;

  cards.forEach((card, index) => {
    steps.push({
      id: `card-${card.id}`,
      type: 'card',
      card,
    });

    if (questionsCount === 0) return;

    const shouldInsertQuestion = ((index + 1) * questionsCount) / cards.length >= questionCursor + 1;
    if (shouldInsertQuestion && questions[questionCursor]) {
      steps.push({
        id: `question-${questions[questionCursor].id}`,
        type: 'question',
        question: questions[questionCursor],
      });
      questionCursor += 1;
    }
  });

  while (questionCursor < questions.length) {
    steps.push({
      id: `question-${questions[questionCursor].id}`,
      type: 'question',
      question: questions[questionCursor],
    });
    questionCursor += 1;
  }

  return steps;
}

function LastLineMarker({
  children,
  className = '',
  contentClassName = '',
  markerClassName = '',
}: {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  markerClassName?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState({ left: 0, top: 0, width: 0, height: 0, visible: false });

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    let frame = 0;
    const updateMarker = () => {
      if (!contentRef.current) return;

      const range = document.createRange();
      range.selectNodeContents(contentRef.current);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      const containerRect = contentRef.current.getBoundingClientRect();

      if (rects.length === 0) {
        setMarker((prev) => prev.visible ? { ...prev, visible: false } : prev);
        return;
      }

      const lastRect = rects[rects.length - 1];
      setMarker({
        left: Math.max(0, lastRect.left - containerRect.left - 3),
        top: lastRect.bottom - containerRect.top - lastRect.height * 0.44,
        width: lastRect.width + 6,
        height: Math.max(10, lastRect.height * 0.42),
        visible: true,
      });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateMarker);
    };

    scheduleUpdate();

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(element);
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [children]);

  return (
    <div className={`relative max-w-full ${className}`}>
      {marker.visible && (
        <span
          className={`pointer-events-none absolute rounded-[999px] ${markerClassName}`}
          style={{
            left: marker.left,
            top: marker.top,
            width: marker.width,
            height: marker.height,
          }}
          aria-hidden="true"
        />
      )}
      <div ref={contentRef} className={`relative z-[1] ${contentClassName}`}>
        {children}
      </div>
    </div>
  );
}

export default function LearnPage() {
  const params = useParams();
  const router = useRouter();
  const { courses, generateNodeContent, preloadNextNode } = useCourse();
  const { markCompleted } = useProgress();

  const courseId = params.courseId as string;
  const nodeIndex = parseInt(params.nodeIndex as string);

  const [phase, setPhase] = useState<LearningPhase>('loading');
  const [showRetry, setShowRetry] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string[]>([]);
  const [fillAnswer, setFillAnswer] = useState('');
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const course = courses.find(c => c.courseId === courseId);
  const node = course?.nodes[nodeIndex];
  const steps = useMemo(() => {
    if (!node?.cards || !node.questions) return [];
    return buildLearningSteps(node.cards, node.questions);
  }, [node?.cards, node?.questions]);
  const currentStep = steps[currentStepIndex];
  const progressPercent = steps.length > 0
    ? Math.round(((currentStepIndex + 1) / steps.length) * 100)
    : 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  useEffect(() => {
    // 如果已完成学习，不做任何操作
    if (phase === 'complete') return;

    if (!course || !node) return;

    // 如果节点内容还没生成，触发生成
    if (!node.cards || !node.questions) {
      loadNodeContent();
    } else if (phase === 'loading') {
      setPhase('learning');
    }

    // 预加载下一个节点内容
    preloadNextNode(courseId, nodeIndex);
  }, [course, node, courseId, nodeIndex, preloadNextNode, phase]);

  useEffect(() => {
    setCurrentStepIndex(0);
    setSelectedAnswer([]);
    setFillAnswer('');
    setIsAnswered(false);
    setIsCorrect(false);
  }, [courseId, nodeIndex, steps.length]);

  const loadNodeContent = async () => {
    if (!course) return;

    try {
      await generateNodeContent(courseId, nodeIndex);
      setPhase('learning');
      setRetryCount(0);
    } catch {
      if (retryCount < 2) {
        setRetryCount(prev => prev + 1);
        // 自动重试
        await loadNodeContent();
      } else {
        setShowRetry(true);
      }
    }
  };

  const handleNodeComplete = () => {
    markCompleted(courseId, nodeIndex);
    setPhase('complete');
  };

  const resetQuestionState = () => {
    setSelectedAnswer([]);
    setFillAnswer('');
    setIsAnswered(false);
    setIsCorrect(false);
  };

  const goToNextStep = () => {
    if (isLastStep) {
      handleNodeComplete();
      return;
    }

    setCurrentStepIndex(prev => prev + 1);
    resetQuestionState();
  };

  const handleSingleSelect = (option: string) => {
    if (isAnswered) return;
    setSelectedAnswer([option]);
  };

  const handleMultiSelect = (option: string) => {
    if (isAnswered) return;
    setSelectedAnswer((prev) =>
      prev.includes(option) ? prev.filter((item) => item !== option) : [...prev, option]
    );
  };

  const handleCheckAnswer = () => {
    if (!currentStep || currentStep.type !== 'question') return;
    const correct = checkIsCorrect(currentStep.question, selectedAnswer, fillAnswer);
    setIsCorrect(correct);
    setIsAnswered(true);
  };

  const handleRetry = async () => {
    setShowRetry(false);
    setRetryCount(0);
    await loadNodeContent();
  };

  const handleSkip = () => {
    setShowRetry(false);
    if (course && nodeIndex + 1 < course.nodes.length) {
      router.push(`/course/${courseId}/learn/${nodeIndex + 1}`);
    } else {
      router.push(`/course/${courseId}`);
    }
  };

  if (!course || !node) {
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

  return (
    <main className="min-h-[100svh] overflow-x-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 right-[-7rem] h-64 w-64 rounded-full bg-gradient-to-br from-accent/12 to-transparent blur-3xl" />
        <div className="absolute left-[-5rem] top-28 h-48 w-48 rounded-full bg-gradient-to-br from-sky-400/8 to-transparent blur-3xl" />
      </div>

      <CourseHeaderBar
        title={(
          <LastLineMarker
            className="min-w-0"
            contentClassName="text-[15px] font-semibold leading-5 text-primary [text-shadow:0_8px_18px_rgba(56,189,248,0.06)]"
            markerClassName="bg-gradient-to-r from-sky-300/18 via-sky-200/12 to-accent/10 blur-[0.55px]"
          >
            {node.title}
          </LastLineMarker>
        )}
        backLabel="返回课程"
        onBack={() => router.push(`/course/${courseId}`)}
        trailing={(
          <div className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-semibold text-secondary">
            {Math.min(currentStepIndex + 1, Math.max(steps.length, 1))}/{Math.max(steps.length, 1)}
          </div>
        )}
      />

      <div
        className="relative mx-auto flex max-w-md flex-col box-border px-5 sm:px-6"
        style={{
          minHeight: '100svh',
          paddingTop: '88px',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}
      >
        {phase === 'loading' && (
          <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-accent/5 animate-bounce">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <p className="mb-2 text-sm text-secondary">正在准备这一小节</p>
            <p className="text-xs text-tertiary">马上进入下一步学习</p>
          </div>
        )}

        {phase === 'learning' && currentStep && (
          <div className="flex flex-1 flex-col">
            <div className="flex flex-1 flex-col pt-1.5">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={currentStep.id}
                  initial={{ opacity: 0, y: 12, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.99 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="relative rounded-[30px] border border-white/80 bg-surface/96 px-5 py-5 shadow-[0_10px_22px_rgba(15,23,42,0.05)] sm:px-6 sm:py-6"
                >
                  <div
                    className="pointer-events-none absolute left-0 top-0 h-28 w-36 opacity-32"
                    style={{
                      backgroundImage:
                        'linear-gradient(to right, rgba(56,189,248,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.10) 1px, transparent 1px)',
                      backgroundSize: '18px 18px',
                      maskImage: 'radial-gradient(circle at 24% 18%, black 0%, rgba(0,0,0,0.82) 28%, transparent 78%)',
                      WebkitMaskImage: 'radial-gradient(circle at 24% 18%, black 0%, rgba(0,0,0,0.82) 28%, transparent 78%)',
                    }}
                  />
                  {currentStep.type === 'card' ? (
                    <>
                      <div className="mb-5 flex items-center gap-2">
                        <p className="text-sm font-medium text-accent">第 {currentStepIndex + 1} 步</p>
                        <div className="rounded-full bg-[#ECEEEC] px-3 py-1 text-xs font-medium text-secondary">
                          理解一下
                        </div>
                      </div>
                      <div className="mb-5">
                        <LastLineMarker
                          contentClassName="text-[28px] font-semibold leading-[1.2] tracking-tight text-primary"
                          markerClassName="bg-gradient-to-r from-sky-300/18 via-sky-200/14 to-accent/12 blur-[0.7px]"
                        >
                          {currentStep.card.title}
                        </LastLineMarker>
                      </div>

                      <div className="prose prose-p:mb-4 prose-strong:text-primary max-w-none text-[15px] leading-7 text-[rgba(31,31,31,0.82)]">
                        <ReactMarkdown>{currentStep.card.content}</ReactMarkdown>
                      </div>

                      {currentStep.card.imageUrl && (
                        <div className="mt-5 overflow-hidden rounded-2xl">
                          <img src={currentStep.card.imageUrl} alt="" className="max-h-48 w-full object-cover" />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mb-5 flex items-center gap-2">
                        <p className="text-sm font-medium text-accent">第 {currentStepIndex + 1} 步</p>
                        <div className="rounded-full bg-[#ECEEEC] px-3 py-1 text-xs font-medium text-secondary">
                          试一试
                        </div>
                        {currentStep.question.dimension && (
                          <div className="rounded-full bg-subtle px-3 py-1 text-xs font-medium text-secondary">
                            {currentStep.question.dimension === 'memory'
                              ? '记忆'
                              : currentStep.question.dimension === 'understanding'
                                ? '理解'
                                : currentStep.question.dimension === 'application'
                                  ? '应用'
                                  : '分析'}
                          </div>
                        )}
                      </div>
                      <div className="mb-5">
                        <LastLineMarker
                          contentClassName="text-[26px] font-semibold leading-[1.24] tracking-tight text-primary [&_p]:m-0"
                          markerClassName="bg-gradient-to-r from-sky-300/18 via-sky-200/14 to-accent/12 blur-[0.7px]"
                        >
                          <ReactMarkdown>{currentStep.question.question}</ReactMarkdown>
                        </LastLineMarker>
                      </div>

                      {currentStep.question.type !== 'fill' && currentStep.question.options && (
                        <div className="space-y-3">
                          {currentStep.question.options.map((option, optionIndex) => {
                            const isSelected = selectedAnswer.includes(option);
                            const answer = currentStep.question.answer;
                            const isCorrectOption = Array.isArray(answer)
                              ? answer.includes(extractAnswerKey(option))
                              : extractAnswerKey(option) === answer;
                            const showCorrect = isAnswered && isCorrectOption;
                            const showIncorrect = isAnswered && isSelected && !isCorrectOption;

                            return (
                              <button
                                key={option}
                                onClick={() => currentStep.question.type === 'single' ? handleSingleSelect(option) : handleMultiSelect(option)}
                                disabled={isAnswered}
                                className={`
                                  w-full rounded-[22px] border px-4 py-4 text-left text-[15px] transition-all duration-150
                                  ${isSelected && !isAnswered ? 'border-accent/30 bg-[linear-gradient(135deg,rgba(255,138,0,0.10),rgba(255,248,240,1))] text-primary shadow-[0_6px_14px_rgba(255,138,0,0.08)]' : ''}
                                  ${showCorrect ? 'border-success/40 bg-[linear-gradient(135deg,rgba(52,199,89,0.14),rgba(247,252,248,1))] text-primary' : ''}
                                  ${showIncorrect ? 'border-error/34 bg-[linear-gradient(135deg,rgba(239,71,111,0.12),rgba(255,248,249,1))] text-primary' : ''}
                                  ${!isAnswered && !isSelected ? 'border-black/6 bg-white hover:border-accent/20 hover:bg-accent/[0.025]' : ''}
                                `}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`
                                    flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-150
                                    ${showCorrect ? 'bg-success/22 text-success' : ''}
                                    ${showIncorrect ? 'bg-error/20 text-error' : ''}
                                    ${isSelected && !isAnswered ? 'bg-accent text-white' : ''}
                                    ${!showCorrect && !showIncorrect && !(isSelected && !isAnswered) ? 'bg-subtle text-secondary' : ''}
                                  `}>
                                    {getOptionBadgeLabel(option, optionIndex)}
                                  </div>
                                  <div className="min-w-0 flex-1 leading-6 text-[rgba(31,31,31,0.82)]">
                                    <ReactMarkdown>{option}</ReactMarkdown>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {currentStep.question.type === 'fill' && (
                        <input
                          type="text"
                          value={fillAnswer}
                          onChange={(e) => setFillAnswer(e.target.value)}
                          disabled={isAnswered}
                          className={`
                            w-full rounded-[22px] border px-4 py-4 text-[15px] text-primary outline-none transition-all duration-150
                            ${isAnswered && isCorrect ? 'border-success/30 bg-success/8' : ''}
                            ${isAnswered && !isCorrect ? 'border-error/25 bg-error/6' : ''}
                            ${!isAnswered ? 'border-black/6 bg-white focus:border-accent/30 focus:bg-accent/[0.03]' : ''}
                          `}
                          placeholder="输入你的答案"
                        />
                      )}
                    </>
                  )}
                </motion.div>
              </AnimatePresence>

              {currentStep.type === 'question' && isAnswered && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`
                  mt-3 rounded-[24px] border px-4 py-3 text-sm leading-6
                  ${isCorrect ? 'border-success/24 bg-success/[0.10] text-primary' : 'border-error/20 bg-error/[0.08] text-primary'}
                `}>
                  <p className="font-semibold">
                    {isCorrect ? '答对了。' : '先看一下这个点。'}
                  </p>
                  <p className="mt-1 text-secondary">
                    {isCorrect
                      ? '你已经跟上当前这个知识点了。'
                      : currentStep.question.explanation}
                  </p>
                </motion.div>
              )}
            </div>

            <div className="mt-auto pt-3">
              <button
                onClick={() => {
                  if (currentStep.type === 'card') {
                    goToNextStep();
                    return;
                  }

                  if (!isAnswered) {
                    handleCheckAnswer();
                    return;
                  }

                  goToNextStep();
                }}
                disabled={
                  currentStep.type === 'question' && !isAnswered && (
                    currentStep.question.type === 'fill'
                      ? !fillAnswer.trim()
                      : selectedAnswer.length === 0
                  )
                }
                className="inline-flex min-h-13 w-full items-center justify-center rounded-full bg-cta px-6 py-3 text-sm font-semibold text-cta shadow-[0_10px_24px_rgba(17,24,39,0.10)] transition-all duration-150 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {currentStep.type === 'card'
                  ? (isLastStep ? '完成这一节' : '我知道了')
                  : !isAnswered
                    ? '提交这一题'
                    : '下一步'}
              </button>
            </div>
          </div>
        )}

        {phase === 'complete' && (
          <div className="flex flex-1 flex-col pt-1.5">
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-[32px] border border-white/80 bg-surface/96 px-6 py-7 text-center shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
            >
              <motion.div
                initial={{ scale: 0.88, rotate: -6 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.34, delay: 0.05, type: 'spring', stiffness: 260, damping: 18 }}
                className="mb-5 inline-flex h-18 w-18 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(255,138,0,0.20),rgba(56,189,248,0.14),rgba(255,255,255,0.98))] text-accent shadow-[0_10px_22px_rgba(255,138,0,0.10)]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-accent shadow-sm">
                  <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </motion.div>
              <p className="text-sm font-medium text-accent">这一节完成了</p>
              <h2 className="mt-2 text-[28px] font-semibold tracking-tight text-primary">{node.title}</h2>
              <p className="mt-3 text-sm leading-6 text-secondary">
                当前进度已经更新，接下来继续往前学。
              </p>
            </motion.div>

            <div className="mt-auto pt-3">
              <button
                onClick={() => {
                  if (course && nodeIndex + 1 < course.nodes.length) {
                    router.push(`/course/${courseId}/learn/${nodeIndex + 1}`);
                    return;
                  }

                  router.push(`/course/${courseId}`);
                }}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-cta px-6 py-3 text-sm font-semibold text-cta shadow-[0_10px_24px_rgba(17,24,39,0.10)] transition-all duration-150 active:scale-[0.985]"
              >
                {course && nodeIndex + 1 < course.nodes.length ? '进入下一节' : '返回学习路线'}
              </button>
            </div>
          </div>
        )}
      </div>

      <RetryModal
        isOpen={showRetry}
        onRetry={handleRetry}
        onSkip={handleSkip}
        message="这一节内容还没准备好，我们可以再试一次，或者先去下一节。"
      />
    </main>
  );
}
