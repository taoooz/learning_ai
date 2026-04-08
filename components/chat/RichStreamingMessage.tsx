'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { parseStreamContent, type ContentBlock } from '@/app/generate/chat/utils/contentParser';
import { getRichStreamingLayoutState } from './rich-streaming-layout';
import { getThinkingPresentationMode } from './rich-streaming-presentation';
import { QuestionCard } from './QuestionCard';
import { OutlineCard } from './OutlineCard';

type RichStreamingMessageProps = {
  content: string;
  thinkingContent?: string;
  isThinking?: boolean;
  onQuestionAnswer?: (answer: string) => void;
  onOutlineConfirm?: () => void;
  disableInteractions?: boolean;
};

export function RichStreamingMessage({
  content,
  thinkingContent,
  isThinking,
  onQuestionAnswer,
  onOutlineConfirm,
  disableInteractions = false,
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

  // 实时解析内容块（包括不完整块）
  useEffect(() => {
    if (!content) {
      setBlocks([]);
      return;
    }
    const parsedBlocks = parseStreamContent(content);
    setBlocks(parsedBlocks);
  }, [content]);

  const layoutState = getRichStreamingLayoutState({ blocks, content, thinkingContent });
  const shouldShowThinkingSection = layoutState.hasThinkingContent;
  const shouldShowPrimarySection = layoutState.hasPrimaryContent;
  const thinkingPresentation = getThinkingPresentationMode({
    isThinking,
    hasPrimaryContent: shouldShowPrimarySection,
    isExpanded: isThinkingExpanded,
  });
  const thinkingShellClassName =
    thinkingPresentation === 'secondary-collapsed'
      ? 'mx-3 mb-0 mt-3 rounded-[18px] border border-black/[0.04] bg-[rgba(246,244,240,0.88)]'
      : 'mx-3 mb-2 mt-3 rounded-[20px] border border-black/[0.04] bg-[linear-gradient(135deg,rgba(246,244,240,0.96),rgba(250,248,245,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]';
  const thinkingBodyClassName =
    'text-secondary/90';
  const thinkingLabelClassName =
    thinkingPresentation === 'secondary-collapsed'
      ? 'text-[11px] font-medium tracking-[0.01em] text-secondary/75'
      : 'text-[12px] font-medium text-secondary/80';
  const primarySectionClassName = shouldShowThinkingSection
    ? 'px-4 pb-4 pt-3'
    : 'px-4 py-4';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex justify-start w-full"
    >
      <div ref={contentRef} className="w-full max-w-[90%]">
        <div className="overflow-hidden rounded-[30px] border border-[rgba(0,0,0,0.06)] bg-[linear-gradient(180deg,rgba(255,252,248,0.98),rgba(255,255,255,0.98))] shadow-[0_14px_36px_rgba(15,23,42,0.05)]">
          {shouldShowThinkingSection && (
            <div className={thinkingShellClassName}>
              <button
                onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                className="flex w-full items-center justify-between px-4 py-3 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isThinking && (
                    <div className="inline-flex items-center gap-1.5 px-1 py-1">
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                        className="h-1.5 w-1.5 rounded-full bg-accent/70"
                      />
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
                        className="h-1.5 w-1.5 rounded-full bg-accent/70"
                      />
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
                        className="h-1.5 w-1.5 rounded-full bg-accent/70"
                      />
                    </div>
                  )}
                  {!isThinking && (
                    <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.04] text-secondary/70">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2" />
                      </svg>
                    </div>
                  )}
                  <span className={thinkingLabelClassName}>
                    {isThinking ? '思考中...' : '思考过程'}
                  </span>
                </div>
                <svg
                  className={`h-4 w-4 text-tertiary transition-transform duration-200 ${isThinkingExpanded ? 'rotate-180' : ''}`}
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
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className={`px-4 pb-4 text-[13px] leading-6 whitespace-pre-wrap ${thinkingBodyClassName}`}>
                    {thinkingContent}
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {shouldShowPrimarySection && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className={primarySectionClassName}
            >
              <div className="space-y-4">
                {blocks.length > 0 ? (
                  blocks.map((block, idx) => {
                    if (block.type === 'text') {
                      return (
                        <div
                          key={`t-${idx}`}
                          className="text-[15px] leading-7 text-primary whitespace-pre-wrap"
                        >
                          {block.content}
                        </div>
                      );
                    }

                    if (block.type === 'question') {
                      const optionsArray = Object.entries(block.options)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([, value]) => value);

                      return (
                        <QuestionCard
                          key={`q-${idx}`}
                          question={block.question}
                          options={optionsArray}
                          questionNumber={parseInt(block.id, 10) || idx + 1}
                          onSelect={(answer) => onQuestionAnswer?.(answer)}
                          disabled={disableInteractions}
                          embedded
                        />
                      );
                    }

                    return (
                      <OutlineCard
                        key={`o-${idx}`}
                        blueprint={{
                          learningDirection: block.learningDirection,
                          learningGoal: block.learningGoal,
                          learnerPositioning: {
                            estimatedLevel: block.estimatedLevel as 'novice' | 'beginner' | 'intermediate' | 'advanced',
                            difficultySummary: '',
                            backgroundSummary: block.backgroundSummary || '',
                            skipBasics: block.skipBasics || [],
                            whyThisCourseFits: '',
                          },
                        }}
                        onConfirm={() => onOutlineConfirm?.()}
                        showActions={block.complete && !disableInteractions}
                        embedded
                      />
                    );
                  })
                ) : (
                  <div className="text-[15px] leading-relaxed text-primary whitespace-pre-wrap">
                    {content}
                    {isThinking && !thinkingContent && (
                      <motion.span
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 0.8, repeat: Infinity }}
                        className="ml-0.5 inline-block h-4 w-0.5 align-middle bg-accent"
                      />
                    )}
                  </div>
                )}

                {blocks.some((block) => block.type !== 'text' && !block.complete) && (
                  <motion.span
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                    className="inline-block h-4 w-0.5 align-middle bg-accent"
                  />
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
