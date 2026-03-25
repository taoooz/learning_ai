'use client';

import { useLayoutEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CourseTree as CourseTreeType } from '@/types/course';
import { CourseNode } from './CourseNode';
import { ChatWidget } from './ui/ChatWidget';

interface CourseTreeProps {
  course: CourseTreeType;
}

const PATH_OFFSETS = [0, 14, -8, 12, -14, 8, -6, 10];
const NODE_STEP = 108;
const START_TOP = 18;

function getOffset(index: number) {
  return PATH_OFFSETS[index % PATH_OFFSETS.length];
}

export function CourseTree({ course }: CourseTreeProps) {
  const router = useRouter();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const nextNodeIndex = course.nodes.find((node) => node.status === 'available')?.index ?? 0;

  const layout = useMemo(() => {
    return course.nodes.map((node, index) => ({
      node,
      offset: getOffset(index),
      top: START_TOP + index * NODE_STEP,
    }));
  }, [course.nodes]);

  const height = START_TOP + course.nodes.length * NODE_STEP + 36;

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-course-node="${nextNodeIndex}"]`);
    if (!target) return;

    const targetTop = window.scrollY + target.getBoundingClientRect().top;
    const desiredTop = Math.max(0, targetTop - window.innerHeight * 0.26);
    window.scrollTo(0, desiredTop);
  }, [course.courseId, nextNodeIndex]);

  const handleNodeClick = (nodeIndex: number) => {
    const node = course.nodes[nodeIndex];
    if (node.status === 'locked') return;
    router.push(`/course/${course.courseId}/learn/${nodeIndex}`);
  };

  return (
    <div className="relative overflow-hidden rounded-[34px] px-1 py-1.5">
      <div className="relative mx-auto w-full max-w-[360px]" style={{ height: `${height}px` }}>
        {layout.map((item) => (
          <div key={item.node.index} data-course-node={item.node.index} className="scroll-mt-32">
            <CourseNode
              node={item.node}
              isCurrent={item.node.index === nextNodeIndex}
              top={item.top}
              offset={item.offset}
              onClick={() => handleNodeClick(item.node.index)}
            />
          </div>
        ))}
      </div>

      <button
        onClick={() => setIsChatOpen(true)}
        className="mt-6 w-full rounded-2xl border border-dashed border-black/10 bg-white/50 py-3 text-sm text-secondary transition-colors hover:bg-white/80"
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
