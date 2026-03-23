'use client';

import { useRouter } from 'next/navigation';
import { CourseTree as CourseTreeType } from '@/types/course';
import { CourseNode } from './CourseNode';
import { ProgressBar } from './ui/ProgressBar';

interface CourseTreeProps {
  course: CourseTreeType;
}

export function CourseTree({ course }: CourseTreeProps) {
  const router = useRouter();

  const completedCount = course.nodes.filter(n => n.status === 'completed').length;

  const handleNodeClick = (nodeIndex: number) => {
    const node = course.nodes[nodeIndex];
    if (node.status === 'locked') return;
    router.push(`/course/${course.courseId}/learn/${nodeIndex}`);
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* 课程标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{course.topic}</h1>
        <p className="text-gray-500 mt-1">{course.totalNodes} lessons</p>
      </div>

      {/* 进度条 */}
      <div className="mb-6">
        <ProgressBar current={completedCount} total={course.totalNodes} />
      </div>

      {/* 节点列表 */}
      <div className="space-y-3">
        {course.nodes.map((node) => (
          <CourseNode
            key={node.index}
            node={node}
            isActive={false}
            onClick={() => handleNodeClick(node.index)}
          />
        ))}
      </div>
    </div>
  );
}