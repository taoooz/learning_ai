// app/course/[courseId]/learn/[nodeIndex]/page.tsx
'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { buildLearningSteps, hasResolvedQuestions, shouldEnterLearningPhase, useCourse } from '@/contexts/CourseContext';
import { useProgress } from '@/contexts/ProgressContext';
import { RetryModal } from '@/components/RetryModal';
import { LearningCard, Question } from '@/types/course';
import { ChatLauncher, ChatWidget } from '@/components/ui/ChatWidget';
import { CardVisualization } from '@/components/ui/CardVisualization';
import { EnhancedLoadingScreen } from '@/components/learning/EnhancedLoadingScreen';
import { useUserMemory } from '@/hooks/useUserMemory';
import { getStoredDataV2 } from '@/lib/storage';

type LearningPhase = 'loading' | 'learning' | 'complete';
type LearnStep =
  | { id: string; type: 'intro'; title: string; description: string; sectionIndex: number }
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
  if (!question?.concept?.trim()) {
    const match = question?.question?.match(/([^，。？?\s]{2,12})/);
    return match?.[1] || '当前知识点';
  }
  return question.concept.trim();
}

function formatAnswerDisplay(question: Question): string {
  const answer = question.answer;
  const options = question.options || [];

  // 单选题：显示 "A. 选项文本"
  if (question.type === 'single') {
    const answerKey = Array.isArray(answer) ? answer[0] : answer;
    if (options.length > 0) {
      // 尝试通过 extractAnswerKey 匹配（处理 options 带前缀的情况）
      const optionText = options.find(opt => extractAnswerKey(opt) === answerKey);
      if (optionText) {
        const cleaned = optionText.replace(/^[A-D][.、：:]\s*/, '');
        // answerKey 是字母且 cleaned 不同 → "A. 选项文本"
        if (/^[A-D]$/.test(answerKey) && cleaned !== answerKey) {
          return `${answerKey}. ${cleaned}`;
        }
        // answerKey 是完整文本 → 通过索引拼字母前缀
        const idx = options.indexOf(optionText);
        const letter = String.fromCharCode(65 + idx);
        return `${letter}. ${cleaned || answerKey}`;
      }
      // answerKey 是字母但 options 没有前缀 → 通过索引查找
      if (/^[A-D]$/.test(answerKey)) {
        const idx = answerKey.charCodeAt(0) - 65;
        if (idx >= 0 && idx < options.length) {
          return `${answerKey}. ${options[idx]}`;
        }
      }
    }
    return String(answerKey);
  }

  // 多选题：显示 "A. 选项文本；B. 选项文本"
  if (question.type === 'multiple' && Array.isArray(answer)) {
    if (options.length > 0) {
      const parts = answer.map(key => {
        const optionText = options.find(opt => extractAnswerKey(opt) === key);
        if (optionText) {
          const cleaned = optionText.replace(/^[A-D][.、：:]\s*/, '');
          if (/^[A-D]$/.test(key) && cleaned !== key) {
            return `${key}. ${cleaned}`;
          }
          // key 是完整文本 → 通过索引拼字母前缀
          const idx = options.indexOf(optionText);
          const letter = String.fromCharCode(65 + idx);
          return `${letter}. ${cleaned || key}`;
        }
        // answerKey 是字母但 options 没有前缀 → 通过索引查找
        if (/^[A-D]$/.test(key)) {
          const idx = key.charCodeAt(0) - 65;
          if (idx >= 0 && idx < options.length) {
            return `${key}. ${options[idx]}`;
          }
        }
        return key;
      }).filter(Boolean);
      return parts.length > 0 ? parts.join('；') : answer.join('、');
    }
    return answer.join('、');
  }

  // 填空题
  if (question.type === 'fill_blank' && Array.isArray(answer)) {
    return answer.join('、');
  }

  // fallback
  if (Array.isArray(answer)) {
    return answer.join('、');
  }
  return String(answer);
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

  if (question.type === 'fill_blank' && Array.isArray(answer)) {
    const correctAnswers = answer as string[];
    return selectedAnswer.length === correctAnswers.length &&
      selectedAnswer.every((item, index) => item === correctAnswers[index]);
  }

  return false;
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
  const { courses, generateNodeContent, generateNodeQuestions, preloadNextNode, updateNodeQuestions, isHydrated } = useCourse();
  const { markCompleted } = useProgress();
  const userMemory = useUserMemory();

  const courseId = params.courseId as string;
  const nodeIndex = parseInt(params.nodeIndex as string);

  const [phase, setPhase] = useState<LearningPhase>('loading');
  const [showRetry, setShowRetry] = useState(false);
  // 练习题（后台生成）失败提示：不打断卡片学习，用户可手动重试
  const [questionsError, setQuestionsError] = useState(false);
  const [isRetryingQuestions, setIsRetryingQuestions] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string[]>([]);
  const [sortOptions, setSortOptions] = useState<string[]>([]);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInitialMessage, setChatInitialMessage] = useState<string | undefined>();
  const [progressPulseKey, setProgressPulseKey] = useState(0);

  // 用于跟踪当前有效的加载请求
  const loadingVersionRef = useRef(0);
  // 用于防止重复请求（key 是 courseId-nodeIndex）
  const hasRequestedRef = useRef<string>('');
  const hasRequestedQuestionsRef = useRef<string>('');
  const hasPreloadedNextRef = useRef<string>('');

  const course = courses.find(c => c.courseId === courseId);
  const node = course?.nodes.find((item) => item.index === nodeIndex);

  // 从 StoredCourseBundle 中获取 blueprint（CourseTree 没有 blueprint）
  const blueprint = useMemo(() => {
    if (!courseId) return undefined;
    const data = getStoredDataV2();
    const bundle = data.courses.find(c => c.blueprint.courseId === courseId);
    return bundle?.blueprint;
  }, [courseId]);
  
  // 用 ref 存储最新的 course 和 node，避免依赖对象引用
  const courseRef = useRef(course);
  const nodeRef = useRef(node);
  
  // 更新 ref
  useEffect(() => {
    courseRef.current = course;
    nodeRef.current = node;
  }, [course, node]);

  useEffect(() => {
    hasRequestedRef.current = '';
    hasRequestedQuestionsRef.current = '';
    hasPreloadedNextRef.current = '';
    setShowRetry(false);
    setQuestionsError(false);
    setIsRetryingQuestions(false);
    setPhase('loading');
    setCurrentStepIndex(0);
    setSelectedAnswer([]);
    setSortOptions([]);
    setIsAnswered(false);
    setIsCorrect(false);
  }, [courseId, nodeIndex]);

  const steps = useMemo(() => {
    const lessonSteps = buildLearningSteps(node?.cards, node?.questions) as LearnStep[];
    const description = blueprint?.nodes.find((item) => item.index === nodeIndex)?.teachingGoal?.trim();
    if (!node?.title || !description) {
      return lessonSteps;
    }

    return [
      {
        id: `intro-${nodeIndex}`,
        type: 'intro' as const,
        title: node.title,
        description,
        sectionIndex: nodeIndex + 1,
      },
      ...lessonSteps,
    ];
  }, [blueprint?.nodes, node?.cards, node?.questions, node?.title, nodeIndex]);
  const currentStep = steps[currentStepIndex];
  const progressPercent = steps.length > 0
    ? Math.round(((currentStepIndex + 1) / steps.length) * 100)
    : 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  useEffect(() => {
    const requestKey = `${courseId}-${nodeIndex}`;

    // 如果已完成学习，不做任何操作
    if (phase === 'complete') return;

    const currentCourse = courseRef.current;
    const currentNode = nodeRef.current;

    if (!currentCourse || !currentNode) return;

    // 如果节点内容还没生成，触发生成
    if (!shouldEnterLearningPhase(currentNode)) {
      // 如果已经发起过请求，直接返回
      if (hasRequestedRef.current === requestKey) {
        return;
      }
      hasRequestedRef.current = requestKey;

      const currentVersion = loadingVersionRef.current + 1;
      loadingVersionRef.current = currentVersion;

      loadNodeContent(currentVersion);
    } else if (phase === 'loading') {
      setPhase('learning');
    }
  }, [courseId, nodeIndex, course, node, phase]);
  
  useEffect(() => {
    const currentNode = nodeRef.current;
    const requestKey = `${courseId}-${nodeIndex}`;

    if (phase !== 'learning') return;
    if (!currentNode || !shouldEnterLearningPhase(currentNode)) return;
    if (hasResolvedQuestions(currentNode)) return;
    if (hasRequestedQuestionsRef.current === requestKey) return;

    generateNodeQuestions(courseId, nodeIndex)
      .then((data) => {
        // 空题目视为生成失败（否则本节会在没有练习的情况下静默推进）
        if (!Array.isArray(data?.questions) || data.questions.length === 0) {
          throw new Error('Questions result is empty');
        }
        hasRequestedQuestionsRef.current = requestKey;
        setQuestionsError(false);
        // 更新 React 状态 + localStorage
        updateNodeQuestions(courseId, nodeIndex, data.questions);
      })
      .catch((error) => {
        console.warn('[LearnPage] Questions generation failed:', error);
        // 不设置 ref，允许重试；向用户展示失败提示，避免静默丢失练习
        setQuestionsError(true);
      });
  }, [courseId, nodeIndex, generateNodeQuestions, updateNodeQuestions, node?.cards, node?.questions, phase]);

  // 当前节点可学习后，再预加载下一个节点知识
  useEffect(() => {
    if (phase === 'complete') return;
    if (phase !== 'learning') return;
    if (!shouldEnterLearningPhase(node)) return;
    const requestKey = `${courseId}-${nodeIndex}`;
    if (hasPreloadedNextRef.current === requestKey) return;
    hasPreloadedNextRef.current = requestKey;
    preloadNextNode(courseId, nodeIndex);
  }, [courseId, nodeIndex, node, phase, preloadNextNode]);

  // 当步骤变化时，重置题目状态
  useEffect(() => {
    if (!currentStep || currentStep.type !== 'question') return;
    setIsAnswered(false);
    setIsCorrect(false);
    setSelectedAnswer([]);
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
    setProgressPulseKey(prev => prev + 1);
    window.scrollTo({ top: 0, behavior: 'instant' });
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

  const handleFillBlankSelect = (option: string) => {
    if (isAnswered) return;
    setSelectedAnswer((prev) => [...prev, option]);
  };

  const handleCheckAnswer = () => {
    if (!currentStep || currentStep.type !== 'question' || !currentStep.question) return;
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

  // 手动重试生成练习题（失败提示条上的按钮）
  const handleRetryQuestions = async () => {
    if (isRetryingQuestions) return;
    setIsRetryingQuestions(true);
    try {
      const data = await generateNodeQuestions(courseId, nodeIndex);
      if (!Array.isArray(data?.questions) || data.questions.length === 0) {
        throw new Error('Questions result is empty');
      }
      updateNodeQuestions(courseId, nodeIndex, data.questions);
      hasRequestedQuestionsRef.current = `${courseId}-${nodeIndex}`;
      setQuestionsError(false);
    } catch (error) {
      console.warn('[LearnPage] Questions retry failed:', error);
      // 保持错误提示，用户可继续重试
    } finally {
      setIsRetryingQuestions(false);
    }
  };

  if (!course || !node) {
    // 水合完成前显示加载态
    if (!isHydrated) {
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

    // 水合后仍找不到课程或章节 → 明确的 404 界面，避免无限 loading
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-error/20 to-error/5 flex items-center justify-center">
            <svg className="w-8 h-8 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-primary mb-2">找不到这个章节</h2>
          <p className="text-secondary text-sm mb-6">课程可能已被删除，或链接已失效</p>
          <button
            onClick={() => router.push(course ? `/course/${courseId}` : '/')}
            className="px-6 py-3 rounded-full bg-accent text-white font-medium shadow-md hover:shadow-lg active:scale-95 transition-all duration-200"
          >
            {course ? '返回课程页' : '回到首页'}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100svh] overflow-y-auto overflow-x-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 right-[-7rem] h-64 w-64 rounded-full bg-gradient-to-br from-accent/8 to-transparent blur-3xl" />
      </div>

      <CourseHeaderBar
        title={node.title}
        backLabel="返回课程"
        onBack={() => router.push(`/course/${courseId}`)}
        trailing={(
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-14 rounded-full bg-black/[0.06] overflow-hidden relative">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${((currentStepIndex + 1) / Math.max(steps.length, 1)) * 100}%` }}
              />
              {progressPulseKey > 0 && (
                <motion.div
                  key={progressPulseKey}
                  initial={{ opacity: 0.6 }}
                  animate={{ opacity: 0, scale: 1.5 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className="absolute inset-0 rounded-full bg-accent/40"
                />
              )}
            </div>
            <span className="text-xs font-medium text-secondary">
              {currentStepIndex + 1}/{Math.max(steps.length, 1)}
            </span>
          </div>
        )}
      />

      <div
        className="relative mx-auto flex max-w-md flex-col box-border px-5 sm:px-6"
        style={{
          minHeight: '100svh',
          paddingTop: '80px',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}
      >
        {phase === 'loading' && <EnhancedLoadingScreen />}

        {phase === 'learning' && currentStep && (
          <div className="flex flex-1 flex-col pb-28">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={currentStep.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="flex-1 px-5 pt-6 sm:px-6"
              >
                {currentStep.type === 'intro' ? (
                  <div className="flex min-h-[68vh] flex-col justify-center">
                    <div className="mb-5 inline-flex w-fit items-center rounded-full border border-accent/20 bg-accent/8 px-3 py-1.5 text-xs font-semibold tracking-wide text-accent">
                      第 {currentStep.sectionIndex} 节
                    </div>

                    <div className="mb-6">
                      <LastLineMarker
                        contentClassName="text-[30px] font-semibold leading-[1.14] tracking-tight text-primary"
                        markerClassName="bg-gradient-to-r from-accent/18 via-sky-200/16 to-accent/10 blur-[0.7px]"
                      >
                        {currentStep.title}
                      </LastLineMarker>
                    </div>

                    <div className="rounded-[28px] border border-black/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,248,242,0.98))] px-5 py-5 shadow-[0_10px_30px_rgba(255,138,0,0.08)]">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-tertiary">
                        本节你会学到
                      </p>
                      <p className="text-[16px] leading-8 text-primary">
                        {currentStep.description}
                      </p>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <span className="rounded-full border border-black/[0.08] bg-subtle/60 px-3 py-1.5 text-xs font-medium text-secondary">
                        先看知识，再做练习
                      </span>
                    </div>
                  </div>
                ) : currentStep.type === 'card' ? (
                  <>
                    <div className="mb-5">
                      <LastLineMarker
                        contentClassName="text-[28px] font-semibold leading-[1.2] tracking-tight text-primary"
                        markerClassName="bg-gradient-to-r from-sky-300/18 via-sky-200/14 to-accent/12 blur-[0.7px]"
                      >
                        {currentStep.card.title}
                      </LastLineMarker>
                    </div>

                    <div className="prose prose-sm prose-p:my-3 prose-p:leading-relaxed prose-strong:font-semibold prose-strong:text-primary prose-code:rounded prose-code:bg-subtle prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:font-normal prose-code:text-primary prose-code:before:content-[''] prose-code:after:content-[''] prose-ul:my-3 prose-ul:space-y-2 prose-li:my-0 prose-li:leading-relaxed max-w-none text-[15px] text-[rgba(31,31,31,0.82)]">
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
                      <div className="mb-5">
                        <LastLineMarker
                          contentClassName="text-[26px] font-semibold leading-[1.24] tracking-tight text-primary [&_p]:m-0 [&_p]:inline"
                          markerClassName="bg-gradient-to-r from-sky-300/18 via-sky-200/14 to-accent/12 blur-[0.7px]"
                        >
                          <div className="inline">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentStep.question.question}</ReactMarkdown>
                            {' '}
                            <span className="inline-flex rounded-full bg-tag px-3 py-1 text-xs font-medium text-secondary align-middle">
                              {currentStep.question.type === 'single' ? '单选' : currentStep.question.type === 'multiple' ? '多选' : '填空'}
                            </span>
                          </div>
                        </LastLineMarker>
                      </div>

                      {currentStep.question.type === 'fill_blank' && currentStep.question.sentence ? (
                        <div className="space-y-4">
                          <div className="rounded-[22px] border-2 border-black/8 bg-white px-4 py-5 text-[15px] leading-8 text-primary">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {currentStep.question.sentence.replace(/___/g, '______')}
                            </ReactMarkdown>
                          </div>
                          {currentStep.question.options && (
                            <div className="flex flex-wrap gap-2">
                              {currentStep.question.options.map((option, optionIndex) => {
                                const correctAnswers = currentStep.question.answer as string[];
                                const blankIndex = selectedAnswer.length;
                                const isCorrectPosition = isAnswered && blankIndex < correctAnswers.length
                                  ? option === correctAnswers[blankIndex]
                                  : false;
                                const isSelected = selectedAnswer.includes(option);
                                const showUserAnswer = isAnswered && isSelected;

                                return (
                                  <button
                                    key={option}
                                    onClick={() => handleFillBlankSelect(option)}
                                    disabled={isAnswered || (isSelected && blankIndex < selectedAnswer.length)}
                                    className={`
                                      rounded-[22px] border-2 px-4 py-3 text-[14px] transition-all duration-150
                                      ${isSelected && !isAnswered ? 'border-accent bg-[linear-gradient(135deg,rgba(255,138,0,0.10),rgba(255,248,240,1))] text-primary shadow-[0_6px_14px_rgba(255,138,0,0.08)]' : ''}
                                      ${showUserAnswer && isCorrectPosition ? 'border-[#2E7D32] bg-[linear-gradient(135deg,rgba(52,199,89,0.14),rgba(247,252,248,1))] text-primary' : ''}
                                      ${showUserAnswer && !isCorrectPosition ? 'border-error bg-[linear-gradient(135deg,rgba(239,71,111,0.12),rgba(255,248,249,1))] text-primary' : ''}
                                      ${!isAnswered && !isSelected ? 'border-black/8 bg-white hover:border-accent/40 hover:bg-accent/[0.025]' : ''}
                                      ${isAnswered && !isSelected ? 'border-black/6 bg-white opacity-50' : ''}
                                    `}
                                  >
                                    {option}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <p className="text-xs text-secondary">点击候选词填入空位</p>
                        </div>
                      ) : currentStep.question.options && (
                        <div className="space-y-3">
                          {currentStep.question.options.map((option, optionIndex) => {
                            const isSelected = selectedAnswer.includes(option);
                            const showUserAnswer = isAnswered && isSelected;
                            const isCorrectOption = isAnswered && !isCorrect && option === currentStep.question.answer;

                            return (
                              <motion.button
                                key={option}
                                onClick={() => currentStep.question.type === 'single' ? handleSingleSelect(option) : handleMultiSelect(option)}
                                disabled={isAnswered}
                                animate={isAnswered ? (
                                  showUserAnswer && !isCorrect
                                    ? { x: [0, -6, 6, -4, 4, -2, 2, 0] }
                                    : isCorrectOption
                                      ? { scale: [1, 1.02, 1] }
                                      : {}
                                ) : {}}
                                transition={{ duration: 0.4 }}
                                className={`
                                  w-full rounded-[22px] border-2 px-4 py-4 text-left text-[15px] transition-colors duration-150
                                  ${isSelected && !isAnswered ? 'border-accent bg-[linear-gradient(135deg,rgba(255,138,0,0.10),rgba(255,248,240,1))] text-primary shadow-[0_6px_14px_rgba(255,138,0,0.08)]' : ''}
                                  ${showUserAnswer && isCorrect ? 'border-[#2E7D32] bg-[linear-gradient(135deg,rgba(52,199,89,0.14),rgba(247,252,248,1))] text-primary' : ''}
                                  ${showUserAnswer && !isCorrect ? 'border-error bg-[linear-gradient(135deg,rgba(239,71,111,0.12),rgba(255,248,249,1))] text-primary' : ''}
                                  ${isCorrectOption ? 'border-[#2E7D32] bg-[linear-gradient(135deg,rgba(52,199,89,0.14),rgba(247,252,248,1))] text-primary' : ''}
                                  ${!isAnswered && !isSelected ? 'border-black/8 bg-white hover:border-accent/40 hover:bg-accent/[0.025]' : ''}
                                  ${isAnswered && !isSelected && !isCorrectOption ? 'border-black/6 bg-white opacity-50' : ''}
                                `}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`
                                    flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-150
                                    ${(showUserAnswer && isCorrect) || isCorrectOption ? 'bg-success/22 text-success' : ''}
                                    ${showUserAnswer && !isCorrect ? 'bg-error/20 text-error' : ''}
                                    ${isSelected && !isAnswered ? 'bg-accent text-white' : ''}
                                    ${!showUserAnswer && !(isSelected && !isAnswered) && !isCorrectOption ? 'bg-subtle text-secondary' : ''}
                                  `}>
                                    {getOptionBadgeLabel(option, optionIndex)}
                                  </div>
                                  <div className="min-w-0 flex-1 leading-6 text-[rgba(31,31,31,0.82)]">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{option}</ReactMarkdown>
                                  </div>
                                </div>
                              </motion.button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
              </motion.div>
            </AnimatePresence>

            {/* 固定底部按钮区域 */}
            <div className="fixed bottom-0 left-0 right-0 z-10">
              <div className="mx-auto max-w-md">
                {/* 练习题生成失败提示：不打断卡片学习，提供手动重试 */}
                {questionsError && (
                  <motion.div
                    initial={{ y: 16, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="px-5 pb-2.5 sm:px-6"
                  >
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-error/20 bg-[#FFF5F6] px-4 py-3 shadow-[0_6px_18px_rgba(239,71,111,0.10)]">
                      <p className="text-[13px] leading-5 text-error">
                        练习题生成失败，不影响本节内容学习
                      </p>
                      <button
                        onClick={handleRetryQuestions}
                        disabled={isRetryingQuestions}
                        className="shrink-0 rounded-full border border-error/40 px-3.5 py-1.5 text-[13px] font-semibold text-error transition-all hover:bg-error/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isRetryingQuestions ? '重试中…' : '重试'}
                      </button>
                    </div>
                  </motion.div>
                )}

                {currentStep.type === 'question' && !isAnswered && (
                  <div className="bg-gradient-to-t from-white via-white/98 to-transparent px-5 pb-6 pt-8 sm:px-6">
                    <button
                      onClick={handleCheckAnswer}
                      disabled={
                        currentStep.question.type === 'fill_blank'
                          ? selectedAnswer.length < ((currentStep.question.answer as string[])?.length || 0)
                          : selectedAnswer.length === 0
                      }
                      className="inline-flex min-h-13 w-full items-center justify-center rounded-full bg-cta px-6 py-3 text-sm font-semibold text-cta shadow-[0_10px_24px_rgba(17,24,39,0.10)] transition-all duration-150 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      提交这一题
                    </button>
                  </div>
                )}

                {currentStep.type === 'question' && isAnswered && (
                  <motion.div
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className={`
                      rounded-t-[32px] border-t-[3px] px-5 py-6 shadow-[0_-10px_40px_rgba(15,23,42,0.08)]
                      ${isCorrect ? 'border-[#2E7D32] bg-[#E8F5E9]' : 'border-error bg-[#FFEBEE]'}
                    `}
                  >
                  <div className="mb-4 flex items-center gap-2">
                    <motion.span
                      initial={{ scale: 0, rotate: -15 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 }}
                      className={`text-2xl ${isCorrect ? 'text-[#2E7D32]' : 'text-error'}`}
                    >
                      {isCorrect ? '🎉' : '💡'}
                    </motion.span>
                    <p className={`text-lg font-semibold ${isCorrect ? 'text-[#2E7D32]' : 'text-error'}`}>
                      {isCorrect ? '答对了！' : '再想想'}
                    </p>
                  </div>
                  {!isCorrect && (
                    <p className="mb-5 text-[15px] leading-relaxed text-secondary">
                      正确答案是：<span className="font-medium text-primary">{formatAnswerDisplay(currentStep.question)}</span>
                    </p>
                  )}
                  
                  <div className="space-y-2.5">
                    <button
                      onClick={() => {
                        const initialMessage = JSON.stringify({
                          type: isCorrect ? 'correct' : 'incorrect',
                          question: currentStep.question.question,
                          correctAnswer: currentStep.question.answer,
                          userAnswer: isCorrect ? undefined : selectedAnswer[0],
                          options: currentStep.question.options
                        });
                        setChatInitialMessage(initialMessage);
                        setIsChatOpen(true);
                      }}
                      className={`
                        w-full rounded-full border-2 px-6 py-3.5 text-[15px] font-semibold transition-all duration-150 active:scale-[0.985]
                        ${isCorrect 
                          ? 'border-[#2E7D32] bg-white text-[#2E7D32] hover:bg-[#2E7D32]/8 shadow-[0_4px_12px_rgba(46,125,50,0.12)]' 
                          : 'border-error bg-white text-error hover:bg-error/8 shadow-[0_4px_12px_rgba(239,71,111,0.12)]'
                        }
                      `}
                    >
                      {isCorrect ? '💬 深入理解' : '🤔 为什么错了？'}
                    </button>

                    <button
                      onClick={goToNextStep}
                      className={`
                        w-full rounded-full px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(17,24,39,0.15)] transition-all duration-150 active:scale-[0.985]
                        ${isCorrect ? 'bg-[#2E7D32] hover:bg-[#1B5E20]' : 'bg-error hover:bg-[#D93F64]'}
                      `}
                    >
                      继续 →
                    </button>
                  </div>
                </motion.div>
              )}

              {currentStep.type === 'intro' && (
                <div className="bg-gradient-to-t from-white via-white/98 to-transparent px-5 pb-6 pt-8 sm:px-6">
                  <button
                    onClick={goToNextStep}
                    className="inline-flex min-h-13 w-full items-center justify-center rounded-full bg-cta px-6 py-3 text-sm font-semibold text-cta shadow-[0_10px_24px_rgba(17,24,39,0.10)] transition-all duration-150 active:scale-[0.985]"
                  >
                    开始学习
                  </button>
                </div>
              )}

              {currentStep.type === 'card' && (
                <div className="bg-gradient-to-t from-white via-white/98 to-transparent px-5 pb-6 pt-8 sm:px-6">
                  <button
                    onClick={goToNextStep}
                    className="inline-flex min-h-13 w-full items-center justify-center rounded-full bg-cta px-6 py-3 text-sm font-semibold text-cta shadow-[0_10px_24px_rgba(17,24,39,0.10)] transition-all duration-150 active:scale-[0.985]"
                  >
                    继续
                  </button>
                </div>
              )}
              </div>
            </div>
          </div>
        )}

        {phase === 'complete' && (() => {
          const nextNode = course?.nodes.find(n => n.index === nodeIndex + 1);
          const nextGoal = blueprint?.nodes.find(item => item.index === nodeIndex + 1)?.teachingGoal;

          return (
            <div className="flex flex-1 flex-col pt-1.5 gap-4">
              {/* 头部卡片 */}
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
              </motion.div>

              {/* 下节预告 */}
              {nextNode && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: 0.08 }}
                  className="rounded-[24px] border border-black/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(240,248,255,0.98))] px-5 py-5 shadow-[0_4px_16px_rgba(15,23,42,0.04)]"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">
                    下一节预告
                  </p>
                  <p className="text-[16px] font-semibold text-primary">{nextNode.title}</p>
                  {nextGoal && (
                    <p className="mt-1.5 text-[14px] leading-6 text-secondary">{nextGoal}</p>
                  )}
                </motion.div>
              )}

              {/* 继续按钮 */}
              <div className="pt-2">
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
                  {nextNode ? '进入下一节' : '返回学习路线'}
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      <RetryModal
        isOpen={showRetry}
        onRetry={handleRetry}
        message="AI 生成内容时遇到了问题，让我们再试一次"
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
            currentNodeGoal: blueprint?.nodes.find((item) => item.index === nodeIndex)?.teachingGoal,
          }}
        />
      )}
    </main>
  );
}
