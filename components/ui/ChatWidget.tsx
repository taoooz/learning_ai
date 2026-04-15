// components/ui/ChatWidget.tsx
'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage } from './ChatMessage';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useUserMemory } from '@/hooks/useUserMemory';
import { useChatSubmit } from '@/hooks/useChatSubmit';
import { AssistantGlyph } from './chat/AssistantGlyph';
import { ChatHeader } from './chat/ChatHeader';
import { ChatEmptyState } from './chat/ChatEmptyState';
import { ChatThinkingIndicator } from './chat/ChatThinkingIndicator';
import { ChatInputForm } from './chat/ChatInputForm';

interface ChatWidgetProps {
  courseId: string;
  courseTitle: string;
  memoryTopic?: string;
  isOpen: boolean;
  onClose: () => void;
  initialMessage?: string;
  contextInfo?: {
    currentNodeTitle?: string;
    currentNodeGoal?: string;
  };
}

interface ChatLauncherProps {
  onClick: () => void;
  label?: string;
}

export function ChatLauncher({ onClick, label = '问助理' }: ChatLauncherProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2, scale: 1.02 }}
      whileTap={{ y: 1, scale: 0.975 }}
      className="group fixed bottom-24 right-5 z-40 flex h-[52px] w-[52px] items-center justify-center rounded-[18px] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(245,250,251,0.96))] text-primary shadow-[0_14px_34px_rgba(15,23,42,0.12)] backdrop-blur-md transition-shadow duration-200 hover:shadow-[0_18px_38px_rgba(15,23,42,0.16)]"
      aria-label={label}
    >
      <span className="pointer-events-none absolute inset-0 rounded-[18px] bg-[radial-gradient(circle_at_32%_24%,rgba(152,184,232,0.22),rgba(152,184,232,0)_46%),radial-gradient(circle_at_74%_72%,rgba(127,191,195,0.18),rgba(127,191,195,0)_48%)]" />
      <motion.span
        className="relative flex h-9 w-9 items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.06))] shadow-[0_10px_20px_rgba(127,191,195,0.16)]"
        animate={{ y: [0, -1.4, 0], scale: [1, 1.028, 1] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <AssistantGlyph className="h-7 w-7" />
      </motion.span>
    </motion.button>
  );
}

export function ChatWidget({ courseId, courseTitle, memoryTopic, isOpen, onClose, initialMessage, contextInfo }: ChatWidgetProps) {
  const [input, setInput] = useState('');
  const { messages, addMessage, flushSummary } = useChatHistory(courseId);
  const userMemory = useUserMemory();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(isOpen);
  const initialMessageSentRef = useRef(false);
  const questionContextRef = useRef<any>(null);

  const persistConversationSummary = useCallback((targetCourseId: string, summary: Parameters<typeof userMemory.addConversationSummary>[1]) => {
    userMemory.addConversationSummary(targetCourseId, summary);
  }, [userMemory]);

  const { isLoading, isThinking, streamingContent, handleSubmit } = useChatSubmit({
    courseId,
    courseTitle,
    memoryTopic,
    contextInfo,
    messages,
    addMessage,
    userMemory,
    questionContextRef,
    persistConversationSummary,
  });

  // 监听 initialMessage 变化，更新 questionContext
  useEffect(() => {
    if (initialMessage) {
      try {
        const parsed = JSON.parse(initialMessage);
        if (parsed.type === 'correct' || parsed.type === 'incorrect') {
          questionContextRef.current = parsed;
        }
      } catch {
        questionContextRef.current = null;
      }
    }
  }, [initialMessage]);

  // 发送初始消息（答疑解惑）
  useEffect(() => {
    if (isOpen && initialMessage && !initialMessageSentRef.current) {
      initialMessageSentRef.current = true;
      let displayMessage = '讲解一下这道题';
      try {
        const parsed = JSON.parse(initialMessage);
        if (parsed.question) {
          displayMessage = `讲解一下《${parsed.question}》`;
        }
      } catch {
        // 不是 JSON，使用默认消息
      }
      setInput(displayMessage);
      setTimeout(() => {
        const form = document.querySelector('[data-chat-form]') as HTMLFormElement;
        form?.requestSubmit();
      }, 300);
    }
  }, [isOpen, initialMessage]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    } else {
      initialMessageSentRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      flushSummary(persistConversationSummary);
    }
    wasOpenRef.current = isOpen;
  }, [flushSummary, isOpen, persistConversationSummary]);

  useEffect(() => {
    if (messages.length > 0 || streamingContent || isThinking) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingContent, isThinking]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const handlePageHide = () => {
      flushSummary(persistConversationSummary);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handlePageHide();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushSummary, isOpen, onClose, persistConversationSummary]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-end bg-[rgba(17,24,39,0.18)] p-3 backdrop-blur-[10px] sm:items-center sm:p-6"
          onClick={onClose}
          onWheel={(e) => e.stopPropagation()}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex h-[min(680px,80vh)] w-full max-w-[440px] flex-col overflow-hidden rounded-[30px] border border-white/55 bg-[linear-gradient(180deg,rgba(255,252,248,0.98),rgba(255,248,242,0.96))] shadow-[0_28px_80px_rgba(15,23,42,0.20)]"
          >
            <div className="pointer-events-none absolute left-0 top-0 h-28 w-36 opacity-35" style={{ backgroundImage: 'linear-gradient(to right, rgba(56,189,248,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.10) 1px, transparent 1px)', backgroundSize: '18px 18px', maskImage: 'radial-gradient(circle at 24% 18%, black 0%, rgba(0,0,0,0.82) 28%, transparent 78%)', WebkitMaskImage: 'radial-gradient(circle at 24% 18%, black 0%, rgba(0,0,0,0.82) 28%, transparent 78%)' }} />
            <div className="pointer-events-none absolute right-[-32px] top-[-18px] h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(127,191,195,0.20),rgba(127,191,195,0)_72%)]" />

            <ChatHeader courseTitle={courseTitle} onClose={onClose} />

            <div
              className="flex-1 overflow-y-auto px-4 py-4 sm:px-5"
              onWheel={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              {messages.length === 0 && !isThinking && !streamingContent && <ChatEmptyState />}

              <div className="space-y-3">
                {messages.map((msg) => (
                  <ChatMessage key={msg.id} message={msg} />
                ))}
                {isThinking && !streamingContent && <ChatThinkingIndicator />}
                {streamingContent && (
                  <ChatMessage
                    message={{
                      id: 'streaming',
                      role: 'assistant',
                      content: streamingContent,
                      timestamp: Date.now(),
                    }}
                  />
                )}
              </div>
              <div ref={messagesEndRef} />
            </div>

            <ChatInputForm
              input={input}
              setInput={setInput}
              isLoading={isLoading}
              onSubmit={(e) => handleSubmit(e, input, () => setInput(''))}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
