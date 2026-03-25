'use client';

import { useLayoutEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CourseTree as CourseTreeType } from '@/types/course';
import { CourseNode } from './CourseNode';
import { ChatWidget } from './ui/ChatWidget';

interface CourseTreeProps {
  course: CourseTreeType;
}

export function CourseTree({ course }: CourseTreeProps) {
  const router = useRouter();
  const [isChatOpen, setIsChatOpen] = useState(false);
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

      {/* Chat button for this course */}
      <button
        onClick={() => setIsChatOpen(true)}
        className="mt-4 w-full rounded-2xl border border-dashed border-black/10 bg-white/50 py-3 text-sm text-secondary hover:bg-white/80 transition-colors"
      >
        <span className="inline-flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          打开课程助理
        </span>
      </button>

      <ChatWidget
        courseId={course.courseId}
        courseTitle={course.topic}
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
      />
    </div>
  );
}
