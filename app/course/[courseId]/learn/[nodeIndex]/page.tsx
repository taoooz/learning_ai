// app/course/[courseId]/learn/[nodeIndex]/page.tsx
'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { useCourse } from '@/contexts/CourseContext';
import { useProgress } from '@/contexts/ProgressContext';
import { RetryModal } from '@/components/RetryModal';
import { LearningCard, Question } from '@/types/course';
import { ChatLauncher, ChatWidget } from '@/components/ui/ChatWidget';
import { CardVisualization } from '@/components/ui/CardVisualization';
import { useUserMemory } from '@/hooks/useUserMemory';

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

function extractQuestionConcept(question: Question): string {
  if (question.concept?.trim()) return question.concept.trim();

  const match = question.question.match(/([^，。？?\s]{2,12})/);
  return match ? match[1] : '当前知识点';
}

function checkIsCorrect(question: Question, selectedAnswer: string[], sortOptions: string[]): boolean {
  const answer = question.answer;

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

  if (question.type === 'sorting' && Array.isArray(answer)) {
    return sortOptions.length === answer.length &&
      sortOptions.every((item, index) => extractAnswerKey(item) === answer[index]);
  }

  return false;
}

function buildLearningSteps(cards: LearningCard[], questions: Question[]): LearnStep[] {
  // 先学完所有卡片，再做所有练习
  const steps: LearnStep[] = [];

  // 先添加所有卡片
  cards.forEach((card) => {
    steps.push({
      id: `card-${card.id}`,
      type: 'card',
      card,
    });
  });

  // 再添加所有题目
  questions.forEach((question) => {
    steps.push({
      id: `question-${question.id}`,
      type: 'question',
      question,
    });
  });

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
  const userMemory = useUserMemory();

  const courseId = params.courseId as string;
  const nodeIndex = parseInt(params.nodeIndex as string);

  const [phase, setPhase] = useState<LearningPhase>('loading');
  const [showRetry, setShowRetry] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string[]>([]);
  const [sortOptions, setSortOptions] = useState<string[]>([]);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInitialMessage, setChatInitialMessage] = useState<string | undefined>();

  // 用于跟踪当前有效的加载请求
  const loadingVersionRef = useRef(0);
  // 用于防止重复请求（key 是 courseId-nodeIndex）
  const hasRequestedRef = useRef<string>('');

  const course = courses.find(c => c.courseId === courseId);
  const node = course?.nodes[nodeIndex];
  
  // 获取 blueprint
  const blueprint = useMemo(() => {
    if (!courseId || nodeIndex === undefined) return undefined;
    const stored = localStorage.getItem(`blueprint_${courseId}_${nodeIndex}`);
    return stored ? JSON.parse(stored) : undefined;
  }, [courseId, nodeIndex]);
  
  // 用 ref 存储最新的 course 和 node，避免依赖对象引用
  const courseRef = useRef(course);
  const nodeRef = useRef(node);
  
  // 更新 ref
  useEffect(() => {
    courseRef.current = course;
    nodeRef.current = node;
  }, [course, node]);

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
    const requestKey = `${courseId}-${nodeIndex}`;
    console.log('[LearnPage] Main useEffect triggered', {
      courseId,
      nodeIndex,
      phase,
      requestKey,
      hasRequested: hasRequestedRef.current === requestKey,
      hasCards: !!nodeRef.current?.cards,
      hasQuestions: !!nodeRef.current?.questions,
    });
    
    // 如果已完成学习，不做任何操作
    if (phase === 'complete') return;

    const currentCourse = courseRef.current;
    const currentNode = nodeRef.current;
    
    if (!currentCourse || !currentNode) return;

    // 如果节点内容还没生成，触发生成
    if (!currentNode.cards || !currentNode.questions) {
      // 如果已经发起过请求，直接返回
      if (hasRequestedRef.current === requestKey) {
        console.log('[LearnPage] Request already in progress, skipping');
        return;
      }
      hasRequestedRef.current = requestKey;
      console.log('[LearnPage] Starting node content generation');

      const currentVersion = loadingVersionRef.current + 1;
      loadingVersionRef.current = currentVersion;
      
      loadNodeContent(currentVersion);
    } else if (phase === 'loading') {
      console.log('[LearnPage] Content ready, switching to learning phase');
      setPhase('learning');
    }
  }, [courseId, nodeIndex]); // 移除 phase 依赖，避免循环
  
  // 单独处理预加载
  useEffect(() => {
    if (phase === 'complete') return;
    preloadNextNode(courseId, nodeIndex);
  }, [courseId, nodeIndex, preloadNextNode]);

  // 当节点内容变化时（卡片或题目更新），重置到第一步
  useEffect(() => {
    // 不要重置 hasRequestedRef，避免重复请求
    setCurrentStepIndex(0);
    setSelectedAnswer([]);
    setSortOptions([]);
    setIsAnswered(false);
    setIsCorrect(false);
  }, [courseId, nodeIndex, steps.length]);

  // 当步骤变化时，如果是排序题，初始化 sortOptions
  useEffect(() => {
    if (!currentStep || currentStep.type !== 'question') return;
    if (currentStep.question.type !== 'sorting') return;
    if (!currentStep.question.options) return;
    setSortOptions([...currentStep.question.options]);
    setIsAnswered(false);
    setIsCorrect(false);
  }, [currentStepIndex, currentStep]);

  const loadNodeContent = async (expectedVersion: number) => {
    if (!course) return;
    try {
      await generateNodeContent(courseId, nodeIndex);
      // 只有版本号匹配时才更新状态
      if (loadingVersionRef.current === expectedVersion) {
        setPhase('learning');
      }
    } catch {
      if (loadingVersionRef.current === expectedVersion) {
        setShowRetry(true);
      }
    }
  };

  const handleNodeComplete = () => {
    markCompleted(courseId, nodeIndex);

    // 节点完成事件已在 ProgressContext 中记录，无需额外操作
    setPhase('complete');
  };

  const resetQuestionState = () => {
    setSelectedAnswer([]);
    setSortOptions([]);
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
    const correct = checkIsCorrect(currentStep.question, selectedAnswer, sortOptions);
    setIsCorrect(correct);
    setIsAnswered(true);

    if (course) {
      userMemory.recordQuestionAttempt({
        courseId,
        topic: course.topic,
        concept: extractQuestionConcept(currentStep.question),
        question: currentStep.question.question,
        isCorrect: correct,
        difficulty: currentStep.question.difficulty,
        dimension: currentStep.question.dimension,
      });
    }
  };

  const handleRetry = async () => {
    setShowRetry(false);
    const currentVersion = loadingVersionRef.current + 1;
    loadingVersionRef.current = currentVersion;
    await loadNodeContent(currentVersion);
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
    <main className="min-h-[100svh] overflow-y-auto overflow-x-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 right-[-7rem] h-64 w-64 rounded-full bg-gradient-to-br from-accent/12 to-transparent blur-3xl" />
        <div className="absolute left-[-5rem] top-28 h-48 w-48 rounded-full bg-gradient-to-br from-sky-400/8 to-transparent blur-3xl" />
      </div>

      <CourseHeaderBar
        title={node.title}
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
                        <div className="rounded-full bg-tag px-3 py-1 text-xs font-medium text-secondary">
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
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentStep.card.content}</ReactMarkdown>
                      </div>

                      {currentStep.card.imageUrl && (
                        <div className="mt-5 overflow-hidden rounded-2xl">
                          <img src={currentStep.card.imageUrl} alt="" className="max-h-48 w-full object-cover" />
                        </div>
                      )}

                      {currentStep.card.visualization && (
                        <CardVisualization visualization={currentStep.card.visualization} />
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mb-5 flex items-center gap-2">
                        <p className="text-sm font-medium text-accent">第 {currentStepIndex + 1} 步</p>
                        <div className="rounded-full bg-tag px-3 py-1 text-xs font-medium text-secondary">
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
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentStep.question.question}</ReactMarkdown>
                        </LastLineMarker>
                      </div>

                      {currentStep.question.type === 'sorting' ? (
                        <div className="space-y-2">
                          <p className="text-xs text-secondary mb-2">点击上下箭头调整顺序</p>
                          {sortOptions.map((option, optionIndex) => {
                            const answer = currentStep.question.answer;
                            const isCorrectPosition = isAnswered && Array.isArray(answer)
                              ? extractAnswerKey(option) === answer[optionIndex]
                              : false;

                            return (
                              <div key={option} className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-subtle text-xs flex items-center justify-center text-secondary">
                                  {optionIndex + 1}
                                </span>
                                <div
                                  className={`
                                    flex-1 rounded-[22px] border px-4 py-4 text-[15px] text-primary
                                    ${isAnswered && isCorrectPosition ? 'border-success/40 bg-success/10' : ''}
                                    ${isAnswered && !isCorrectPosition ? 'border-error/30' : ''}
                                    ${!isAnswered ? 'border-black/6 bg-white' : ''}
                                  `}
                                >
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{option}</ReactMarkdown>
                                </div>
                                {!isAnswered && (
                                  <div className="flex flex-col gap-1">
                                    <button
                                      onClick={() => {
                                        const newOptions = [...sortOptions];
                                        const temp = newOptions[optionIndex];
                                        newOptions[optionIndex] = newOptions[optionIndex - 1];
                                        newOptions[optionIndex - 1] = temp;
                                        setSortOptions(newOptions);
                                      }}
                                      disabled={optionIndex === 0}
                                      aria-label="上移"
                                      className="flex items-center justify-center w-10 h-10 rounded-xl bg-subtle text-secondary hover:bg-subtle/80 active:scale-95 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
                                    >
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => {
                                        const newOptions = [...sortOptions];
                                        const temp = newOptions[optionIndex];
                                        newOptions[optionIndex] = newOptions[optionIndex + 1];
                                        newOptions[optionIndex + 1] = temp;
                                        setSortOptions(newOptions);
                                      }}
                                      disabled={optionIndex === sortOptions.length - 1}
                                      aria-label="下移"
                                      className="flex items-center justify-center w-10 h-10 rounded-xl bg-subtle text-secondary hover:bg-subtle/80 active:scale-95 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
                                    >
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : currentStep.question.options && (
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
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{option}</ReactMarkdown>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
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
                    {isCorrect ? '答对了。' : '答错了'}
                  </p>
                  <p className="mt-1 text-secondary">
                    {isCorrect
                      ? '你已经跟上当前这个知识点了。'
                      : '没关系，继续学习吧。'}
                  </p>
                  {!isCorrect && (
                    <button
                      onClick={() => {
                        const initialMessage = `我在「${currentStep.question.question}」这道题上答错了，能帮我解释一下吗？`;
                        setChatInitialMessage(initialMessage);
                        setIsChatOpen(true);
                      }}
                      className="mt-3 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      </svg>
                      答疑解惑
                    </button>
                  )}
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
                    currentStep.question.type === 'sorting'
                      ? sortOptions.length < (currentStep.question.options?.length || 0)
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

      <ChatLauncher onClick={() => setIsChatOpen(true)} />

      {node && (
        <ChatWidget
          courseId={courseId}
          courseTitle={node.title}
          memoryTopic={course.topic}
          isOpen={isChatOpen}
          onClose={() => {
            setIsChatOpen(false);
            setChatInitialMessage(undefined);
          }}
          initialMessage={chatInitialMessage}
          contextInfo={{
            currentNodeTitle: node.title,
            currentNodeGoal: blueprint?.teachingGoal,
          }}
        />
      )}
    </main>
  );
}
