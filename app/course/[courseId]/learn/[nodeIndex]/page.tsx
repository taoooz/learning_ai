// app/course/[courseId]/learn/[nodeIndex]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { useProgress } from '@/contexts/ProgressContext';
import { LearningCardStack } from '@/components/LearningCardStack';
import { QuizQuestion } from '@/components/QuizQuestion';
import { RetryModal } from '@/components/RetryModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type LearningPhase = 'loading' | 'cards' | 'quiz' | 'complete';

export default function LearnPage() {
  const params = useParams();
  const router = useRouter();
  const { courses, generateNodeContent, updateNodeContent } = useCourse();
  const { markCompleted } = useProgress();

  const courseId = params.courseId as string;
  const nodeIndex = parseInt(params.nodeIndex as string);

  const [phase, setPhase] = useState<LearningPhase>('loading');
  const [showRetry, setShowRetry] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const course = courses.find(c => c.courseId === courseId);
  const node = course?.nodes[nodeIndex];

  useEffect(() => {
    if (!course || !node) return;

    // 如果节点内容还没生成，触发生成
    if (!node.cards || !node.questions) {
      loadNodeContent();
    } else {
      setPhase('cards');
    }
  }, [course, node]);

  const loadNodeContent = async () => {
    if (!course) return;

    try {
      await generateNodeContent(courseId, nodeIndex);
      setPhase('cards');
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

  const handleCardsComplete = () => {
    setPhase('quiz');
  };

  const handleQuizComplete = () => {
    markCompleted(courseId, nodeIndex);
    setPhase('complete');
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
      <main className="min-h-screen flex items-center justify-center">
        <LoadingSpinner message="Loading..." />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      {/* 返回按钮 */}
      <button
        onClick={() => router.push(`/course/${courseId}`)}
        className="mb-4 text-gray-500 hover:text-gray-700"
      >
        ← Back to Course
      </button>

      {/* 节点标题 */}
      <h1 className="text-xl font-bold text-gray-900 mb-6">{node.title}</h1>

      {/* 内容 */}
      {phase === 'loading' && (
        <LoadingSpinner message="Generating content..." />
      )}

      {phase === 'cards' && node.cards && (
        <LearningCardStack cards={node.cards} onComplete={handleCardsComplete} />
      )}

      {phase === 'quiz' && node.questions && (
        <QuizQuestion questions={node.questions} onComplete={handleQuizComplete} />
      )}

      {phase === 'complete' && (
        <div className="flex flex-col items-center justify-center min-h-[50vh]">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Lesson Complete!</h2>
          <p className="text-gray-600 mb-6">Great job learning {node.title}</p>
          <button
            onClick={() => router.push(`/course/${courseId}`)}
            className="px-6 py-3 rounded-full bg-blue-500 text-white"
          >
            Continue →
          </button>
        </div>
      )}

      {/* 重试弹窗 */}
      <RetryModal
        isOpen={showRetry}
        onRetry={handleRetry}
        onSkip={handleSkip}
      />
    </main>
  );
}