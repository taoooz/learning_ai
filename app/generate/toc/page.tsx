'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { createStoredCourseBundleFromBlueprint } from '@/lib/storage';
import type { CourseBlueprint, StoredCourseBundle } from '@/types/course';

export default function TocPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic') || '';
  const { generateToc, addCourse } = useCourse();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const blueprintData = sessionStorage.getItem('pendingBlueprint');
    if (!blueprintData) {
      setError('没有找到课程纲要，请重新开始');
      setIsLoading(false);
      return;
    }

    const blueprint: CourseBlueprint = JSON.parse(blueprintData);

    // 调用 toc API 生成课程名称、描述、节点详情
    generateToc(blueprint).then(async (result) => {
      try {
        // 更新 blueprint 的节点结构（添加 description）
        // 注意：description 暂时存储在内存中，不修改原始 blueprint 类型
        const updatedBlueprint: CourseBlueprint = {
          ...blueprint,
          // 使用 API 返回的 courseName 和 courseDescription 更新对应字段
          courseGoal: result.courseDescription || blueprint.courseGoal,
          // 节点描述通过 generateNodeContent 动态生成，这里只需确保结构正确
          nodes: blueprint.nodes.map((node, i) => ({
            ...node,
            // 如果 toc 返回了 description 则使用，否则使用 teachingGoal
            teachingGoal: result.nodes?.[i]?.description || node.teachingGoal,
          })),
        };

        // 创建课程 bundle
        const bundle: StoredCourseBundle = createStoredCourseBundleFromBlueprint(updatedBlueprint);

        // 保存 bundle 并更新上下文状态
        addCourse(bundle);

        // 清理 sessionStorage
        sessionStorage.removeItem('pendingBlueprint');

        // 跳转到课程页面
        router.push(`/course/${blueprint.courseId}`);
      } catch (err) {
        console.error('Failed to create course:', err);
        setError('创建课程失败，请稍后再试');
        setIsLoading(false);
      }
    }).catch((err) => {
      console.error('Failed to generate TOC:', err);
      setError('生成目录失败，请稍后再试');
      setIsLoading(false);
    });
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