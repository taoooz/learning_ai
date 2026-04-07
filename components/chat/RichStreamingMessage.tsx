'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { parseStreamContent, hasIncompleteBlock, type ContentBlock } from '@/app/generate/chat/utils/contentParser';
import { QuestionCard } from './QuestionCard';
import { OutlineCard } from './OutlineCard';

type RichStreamingMessageProps = {
  content: string;
  thinkingContent?: string;
  isThinking?: boolean;
  onQuestionAnswer?: (questionId: string, answer: string) => void;
  onOutlineConfirm?: () => void;
};

export function RichStreamingMessage({ 
  content, 
  thinkingContent, 
  isThinking,
  onQuestionAnswer,
  onOutlineConfirm,
}: RichStreamingMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(true);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [content]);

  useEffect(() => {
    if (!isThinking && thinkingContent) {
      setIsThinkingExpanded(false);
    }
  }, [isThinking, thinkingContent]);

  // 解析内容块
  useEffect(() => {
    if (content && !hasIncompleteBlock(content)) {
      const parsedBlocks = parseStreamContent(content);
      setBlocks(parsedBlocks);
      
      // 如果解析出了问题或纲要块，说明流式内容已完成，设置 isThinking 为 false
      // 这个逻辑应该在父组件处理，这里只是展示
    }
  }, [content]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex justify-start w-full"
    >
      <div className="w-full max-w-[90%] space-y-3">
        {/* 主卡片 */}
        <div className="rounded-2xl border border-[rgba(0,0,0,0.06)] bg-surface overflow-hidden">
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
              {isThinkingExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-3 text-sm text-tertiary leading-relaxed whitespace-pre-wrap">
                    {thinkingContent}
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {/* 内容区域 */}
          <div ref={contentRef} className="px-4 py-3">
            {blocks.length > 0 ? (
              <div className="space-y-4">
                {blocks.map((block, idx) => {
                  if (block.type === 'text') {
                    return (
                      <div key={idx} className="text-[15px] leading-relaxed text-primary whitespace-pre-wrap">
                        {block.content}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            ) : (
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
            )}
          </div>
        </div>

        {/* 结构化组件 */}
        {blocks.map((block, idx) => {
          if (block.type === 'question') {
            // 将 options 对象转换为数组
            const optionsArray = Object.entries(block.options).map(([key, value]) => value);
            return (
              <QuestionCard
                key={`q-${idx}`}
                question={block.question}
                options={optionsArray}
                questionNumber={parseInt(block.id) || idx + 1}
                onSelect={(answer) => onQuestionAnswer?.(block.id, answer)}
                disabled={false}
              />
            );
          }
          if (block.type === 'outline') {
            return (
              <OutlineCard
                key={`o-${idx}`}
                blueprint={{
                  learningDirection: block.learningDirection,
                  learningGoal: block.learningGoal,
                  learnerPositioning: {
                    estimatedLevel: block.estimatedLevel as 'novice' | 'beginner' | 'intermediate' | 'advanced',
                    backgroundSummary: block.backgroundSummary,
                    skipBasics: block.skipBasics,
                  },
                }}
                onConfirm={onOutlineConfirm}
                showActions={true}
              />
            );
          }
          return null;
        })}
      </div>
    </motion.div>
  );
}
