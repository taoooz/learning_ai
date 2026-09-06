'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

type StreamingMessageProps = {
  content: string;
  thinkingContent?: string;
  isThinking?: boolean;
};

export function StreamingMessage({ content, thinkingContent, isThinking }: StreamingMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(true);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [content]);

  // 思考完成后自动折叠
  useEffect(() => {
    if (!isThinking && thinkingContent) {
      setIsThinkingExpanded(false);
    }
  }, [isThinking, thinkingContent]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex justify-start"
    >
      <div className="max-w-[90%] rounded-2xl border border-[rgba(0,0,0,0.06)] bg-surface overflow-hidden">
        {/* 思考区域 */}
        {thinkingContent && (
          <div className="border-b border-subtle/50">
            <button
              onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
              className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-subtle/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isThinking && (
                  <div className="flex gap-1">
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                      className="h-1.5 w-1.5 rounded-full bg-accent/60"
                    />
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
                      className="h-1.5 w-1.5 rounded-full bg-accent/60"
                    />
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
                      className="h-1.5 w-1.5 rounded-full bg-accent/60"
                    />
                  </div>
                )}
                <span className="text-xs font-medium text-tertiary">
                  {isThinking ? '思考中...' : '思考过程'}
                </span>
              </div>
              <svg
                className={`w-4 h-4 text-tertiary transition-transform ${isThinkingExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <AnimatePresence>
              {isThinkingExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-3 text-sm text-tertiary leading-relaxed whitespace-pre-wrap">
                    {/* 渲染层 trim：流尾残留换行不显示为空行（数据保持原样） */}
                    {thinkingContent.trim()}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 正式内容 */}
        {content && (
          <div ref={contentRef} className="px-4 py-3">
            <div className="text-[15px] leading-relaxed text-primary whitespace-pre-wrap">
              {content}
              {isThinking && !thinkingContent && (
                <motion.span
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="inline-block w-0.5 h-4 bg-accent ml-0.5 align-middle"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
