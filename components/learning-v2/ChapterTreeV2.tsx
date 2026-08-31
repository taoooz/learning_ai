'use client';

// components/learning-v2/ChapterTreeV2.tsx
// V2 章节树：复用 CourseTree 的布局与节点视觉语言（locked/available/completed 三态）。
// 适配点：V2 章节 index 为 1 基，V1 CourseNode 按 0 基显示（按钮数字 = index + 1），映射时 -1；
// 点击 available/completed 进入章节学习页 /course/{id}/chapter/{chapterId}，locked 忽略。

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import type { CourseTreeViewV2 } from '@/types/learning-v2';
import type { CourseNode as CourseNodeType } from '@/types/course';
import { CourseNode } from '../CourseNode';
import { getCourseTreeInitialScrollTop, getCourseTreeLayout } from '@/lib/course-tree-layout';

interface ChapterTreeV2Props {
  courseId: string;
  treeView: CourseTreeViewV2;
}

export function ChapterTreeV2({ courseId, treeView }: ChapterTreeV2Props) {
  const router = useRouter();
  const [animateIn, setAnimateIn] = useState(false);

  const chapters = useMemo(
    () => [...treeView.chapters].sort((a, b) => a.index - b.index),
    [treeView.chapters],
  );
  const nextChapterId = chapters.find((c) => c.status === 'available')?.chapterId;

  // V2 章节 → V1 CourseNode 薄适配：只消费 index/title/status，cards/questions 不参与树渲染
  const layout = useMemo(() => {
    const nodes: CourseNodeType[] = chapters.map((c) => ({
      index: c.index - 1,
      title: c.title,
      status: c.status,
    }));
    const positions = getCourseTreeLayout(nodes);
    return nodes.map((node, i) => ({ node, chapter: chapters[i], ...positions[i] }));
  }, [chapters]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setAnimateIn(true));
    return () => window.cancelAnimationFrame(frame);
  }, [courseId]);

  useLayoutEffect(() => {
    if (!nextChapterId) return;
    const target = document.querySelector<HTMLElement>(`[data-v2-chapter="${nextChapterId}"]`);
    if (!target) return;

    const targetTop = window.scrollY + target.getBoundingClientRect().top;
    const desiredTop = getCourseTreeInitialScrollTop({
      nodeTop: targetTop,
      viewportHeight: window.innerHeight,
    });
    window.scrollTo(0, desiredTop);
  }, [courseId, nextChapterId]);

  const handleChapterClick = (chapterId: string, status: string) => {
    if (status === 'locked') return;
    router.push(`/course/${courseId}/chapter/${chapterId}`);
  };

  return (
    <div className="relative overflow-hidden rounded-[34px] px-1 py-1.5">
      <div className="relative mx-auto flex w-full max-w-[360px] flex-col gap-2 pt-0">
        {layout.map((item) => (
          <motion.div
            key={item.chapter.chapterId}
            data-v2-chapter={item.chapter.chapterId}
            className="scroll-mt-32"
            initial={{ opacity: 0, y: 14 }}
            animate={animateIn ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: item.node.index * 0.035 }}
          >
            <CourseNode
              node={item.node}
              isCurrent={item.chapter.chapterId === nextChapterId}
              offset={item.offset}
              onClick={() => handleChapterClick(item.chapter.chapterId, item.chapter.status)}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
