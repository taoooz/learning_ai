'use client';

import { useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CourseTree as CourseTreeType } from '@/types/course';
import { CourseNode } from './CourseNode';

interface CourseTreeProps {
  course: CourseTreeType;
}

export function CourseTree({ course }: CourseTreeProps) {
  const router = useRouter();
  const nextNodeIndex = course.nodes.find((node) => node.status === 'available')?.index ?? 0;

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-course-node="${nextNodeIndex}"]`);
    if (!target) return;

    const targetTop = window.scrollY + target.getBoundingClientRect().top;
    const desiredTop = Math.max(0, targetTop - window.innerHeight * 0.3);
    window.scrollTo(0, desiredTop);
  }, [course.courseId, nextNodeIndex]);

  const handleNodeClick = (nodeIndex: number) => {
    const node = course.nodes[nodeIndex];
    if (node.status === 'locked') return;
    router.push(`/course/${course.courseId}/learn/${nodeIndex}`);
  };

  return (
    <div className="relative pl-12">
      <div className="absolute bottom-8 left-[24px] top-8 w-px bg-gradient-to-b from-sky-300/28 via-black/7 to-transparent" />
      <div className="space-y-4">
        {course.nodes.map((node, index) => (
          <div key={node.index} data-course-node={node.index} className="scroll-mt-28">
            <CourseNode
              node={node}
              isCurrent={node.index === nextNodeIndex}
              isFirst={index === 0}
              isLast={index === course.nodes.length - 1}
              onClick={() => handleNodeClick(node.index)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
