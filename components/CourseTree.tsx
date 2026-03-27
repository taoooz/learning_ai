'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { CourseTree as CourseTreeType } from '@/types/course';
import { CourseNode } from './CourseNode';
import {
  getCourseTreeInitialScrollTop,
  getCourseTreeLayout,
} from '@/lib/course-tree-layout';

interface CourseTreeProps {
  course: CourseTreeType;
}

export function CourseTree({ course }: CourseTreeProps) {
  const router = useRouter();
  const [animateIn, setAnimateIn] = useState(false);
  const nextNodeIndex = course.nodes.find((node) => node.status === 'available')?.index ?? 0;

  const layout = useMemo(() => {
    const positions = getCourseTreeLayout(course.nodes);
    return course.nodes.map((node, index) => ({
      node,
      ...positions[index],
    }));
  }, [course.nodes]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setAnimateIn(true));
    return () => window.cancelAnimationFrame(frame);
  }, [course.courseId]);

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-course-node="${nextNodeIndex}"]`);
    if (!target) return;

    const targetTop = window.scrollY + target.getBoundingClientRect().top;
    const desiredTop = getCourseTreeInitialScrollTop({
      nodeTop: targetTop,
      viewportHeight: window.innerHeight,
    });
    window.scrollTo(0, desiredTop);
  }, [course.courseId, nextNodeIndex]);

  const handleNodeClick = (nodeIndex: number) => {
    const node = course.nodes[nodeIndex];
    if (node.status === 'locked') return;
    router.push(`/course/${course.courseId}/learn/${nodeIndex}`);
  };

  return (
    <div className="relative overflow-hidden rounded-[34px] px-1 py-1.5">
      <div className="relative mx-auto flex w-full max-w-[360px] flex-col gap-2 pt-2">
        {layout.map((item) => (
          <motion.div
            key={item.node.index}
            data-course-node={item.node.index}
            className="scroll-mt-32"
            initial={{ opacity: 0, y: 14 }}
            animate={animateIn ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: item.node.index * 0.035 }}
          >
            <CourseNode
              node={item.node}
              isCurrent={item.node.index === nextNodeIndex}
              offset={item.offset}
              onClick={() => handleNodeClick(item.node.index)}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
