'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { createStoredCourseBundleFromBlueprint } from '@/lib/course-blueprint';
import type { CourseBlueprint, StoredCourseBundle, OutlineLearnerPositioning } from '@/types/course';

interface TocResponse {
  courseName: string;
  courseDescription: string;
  nodes: { index: number; title: string; teachingGoal: string; description: string }[];
}

interface PendingOutline {
  topic: string;
  learningDirection: string;
  learningGoal: string;
  learnerPositioning: OutlineLearnerPositioning;
}

function TocPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic') || '';
  const { generateToc, addCourse } = useCourse();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 用于标记当前最新的请求版本
  const requestVersionRef = useRef(0);
  // 用于取消正在进行的请求
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const outlineData = sessionStorage.getItem('pendingOutline');
    if (!outlineData) {
      setError('没有找到课程纲要，请重新开始');
      setIsLoading(false);
      return;
    }

    const outline: PendingOutline = JSON.parse(outlineData);

    // 递增版本号，标记这是一个新的请求
    const currentVersion = requestVersionRef.current + 1;
    requestVersionRef.current = currentVersion;

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    console.log('[TOC Page] Starting TOC generation, version:', currentVersion);

    // 调用 toc API 生成课程名称、描述、节点详情
    generateToc(outline).then(async (result) => {
      // 检查是否是最新版本的请求
      if (currentVersion !== requestVersionRef.current) {
        console.log('[TOC Page] Ignoring stale response, version:', currentVersion);
        return;
      }

      try {
        const tocResult = result as TocResponse;

        // 构建完整的 CourseBlueprint
        const blueprint: CourseBlueprint = {
          courseId: `course-${Date.now()}`,
          topic: outline.topic,
          learnerPositioning: {
            estimatedLevel: outline.learnerPositioning.estimatedLevel,
            difficultySummary: outline.learnerPositioning.difficultySummary,
            whyThisCourseFits: outline.learnerPositioning.whyThisCourseFits,
          },
          courseGoal: tocResult.courseDescription || outline.learningGoal,
          globalConcepts: [],
          nodes: tocResult.nodes.map((n, i) => ({
            index: n.index,
            title: n.title,
            teachingGoal: n.teachingGoal,
            teachConceptIds: [],
            prerequisiteConceptIds: [],
            bridgeFromPreviousNode: '',
            status: 'available',
          })),
        };

        // 创建课程 bundle
        const bundle: StoredCourseBundle = createStoredCourseBundleFromBlueprint(blueprint);

        // 保存 bundle 并更新上下文状态
        addCourse(bundle);

        // 清理 sessionStorage
        sessionStorage.removeItem('pendingOutline');

        // 跳转到课程页面
        router.push(`/course/${blueprint.courseId}`);
      } catch (err) {
        console.error('[TOC Page] Failed to create course:', err);
        setError('创建课程失败，请稍后再试');
        setIsLoading(false);
      }
    }).catch((err) => {
      console.error('[TOC Page] Failed to generate TOC:', err);
      if (currentVersion !== requestVersionRef.current) {
        console.log('[TOC Page] Ignoring stale error, version:', currentVersion);
        return;
      }
      setError('生成目录失败，请稍后再试');
      setIsLoading(false);
    });

    // 清理函数
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [topic, generateToc, addCourse, router]);

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
          <p className="text-secondary text-sm">生成课程目录中...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <p className="text-error">{error}</p>
        <button
          onClick={() => router.push('/generate')}
          className="mt-4 px-6 py-3 rounded-full bg-accent text-white"
        >
          重新开始
        </button>
      </div>
    </main>
  );
}

export default function TocPage() {
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
      <TocPageContent />
    </Suspense>
  );
}
