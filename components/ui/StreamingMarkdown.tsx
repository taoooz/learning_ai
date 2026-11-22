'use client';

import { useEffect, useRef, useState } from 'react';
import { MarkdownContent } from './MarkdownContent';

/**
 * 用平滑补间把后端一次性到达的 markdown 增量“缓释”出来。
 * 只对同一次流式追加生效；内容被替换/重试时立即同步，避免旧内容混入。
 */
function useSmoothedMarkdown(target: string, streaming: boolean): string {
  // 首块内容到达时立即展示，后续增量再做平滑补间；否则结构化块先挂载时，
  // 前面的 markdown 会先被“空白缓释”，看起来像在等待后面的组件完成。
  const [displayed, setDisplayed] = useState(() => target);
  const displayedRef = useRef(displayed);
  const targetRef = useRef(target);
  const frameRef = useRef<number | null>(null);
  // 一旦进入过流式态，即使 task_completed 已到达，也让残差继续缓释完，避免结尾突跳。
  const smoothingRef = useRef(streaming);

  useEffect(() => {
    targetRef.current = target;
    if (streaming) smoothingRef.current = true;

    if (!smoothingRef.current) {
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }

    // 正常流式只追加；失败重试或版本替换时 target 不再是旧内容的延伸，直接跳齐。
    if (!target.startsWith(displayedRef.current)) {
      displayedRef.current = target;
      setDisplayed(target);
    }

    const advance = () => {
      frameRef.current = null;
      const nextTarget = targetRef.current;
      const current = displayedRef.current;
      if (current === nextTarget) return;

      if (!nextTarget.startsWith(current)) {
        displayedRef.current = nextTarget;
        setDisplayed(nextTarget);
        return;
      }

      const remaining = nextTarget.length - current.length;
      // 优先保证短增量不卡顿；长段落按比例缓释，避免“整段蹦出”。
      const step = Math.max(2, Math.min(18, Math.ceil(remaining / 8)));
      displayedRef.current = nextTarget.slice(0, current.length + step);
      setDisplayed(displayedRef.current);
      frameRef.current = requestAnimationFrame(advance);
    };

    if (frameRef.current == null) {
      frameRef.current = requestAnimationFrame(advance);
    }
  }, [streaming, target]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return displayed;
}

export function StreamingMarkdown({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const displayed = useSmoothedMarkdown(content, streaming);
  const revealing = streaming && displayed.length < content.length;

  return (
    <div
      className={revealing ? 'streaming-fade' : undefined}
      aria-live="off"
      aria-busy={streaming}
    >
      <MarkdownContent content={displayed} />
    </div>
  );
}
