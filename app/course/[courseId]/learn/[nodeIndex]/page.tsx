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
  const { courses, generateNodeContent, preloadNextNode, updateNodeContent } = useCourse();
  const { markCompleted } = useProgress();

  const courseId = params.courseId as string;
  const nodeIndex = parseInt(params.nodeIndex as string);

  const [phase, setPhase] = useState<LearningPhase>('loading');
  const [showRetry, setShowRetry] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const course = courses.find(c => c.courseId === courseId);
  const node = course?.nodes[nodeIndex];

  useEffect(() => {
    // 如果已完成学习，不做任何操作
    if (phase === 'complete') return;

    if (!course || !node) return;

    // 如果节点内容还没生成，触发生成
    if (!node.cards || !node.questions) {
      loadNodeContent();
    } else if (phase === 'loading') {
      // 只有在 loading 阶段才自动切换到 cards
      setPhase('cards');
    }

    // 预加载下一个节点内容
    preloadNextNode(courseId, nodeIndex);
  }, [course, node, courseId, nodeIndex, preloadNextNode, phase]);

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
        <LoadingSpinner message="加载中..." />
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
        ← 返回课程
      </button>

      {/* 节点标题 */}
      <h1 className="text-xl font-bold text-gray-900 mb-6">{node.title}</h1>

      {/* 内容 */}
      {phase === 'loading' && (
        <LoadingSpinner message="正在生成学习内容..." />
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
          <h2 className="text-2xl font-bold text-gray-900 mb-2">课程完成！</h2>
          <p className="text-gray-600 mb-6">太棒了，你已完成 {node.title}</p>
          <button
            onClick={() => router.push(`/course/${courseId}`)}
            className="px-6 py-3 rounded-full bg-blue-500 text-white"
          >
            下一节 →
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