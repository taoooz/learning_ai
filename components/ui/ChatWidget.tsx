// components/ui/ChatWidget.tsx
'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage } from './ChatMessage';
import { useChatHistory } from '@/hooks/useChatHistory';
import {
  analyzeChatMessageForMemory,
  detectChatLearningPreferences,
  detectExplicitMasteredConcept,
  useUserMemory,
} from '@/hooks/useUserMemory';

interface ChatWidgetProps {
  courseId: string;
  courseTitle: string;
  memoryTopic?: string;
  isOpen: boolean;
  onClose: () => void;
  initialMessage?: string; // 初始消息（用于答疑解惑）
  // 额外上下文信息
  contextInfo?: {
    currentNodeTitle?: string;
    currentNodeGoal?: string;
  };
}

interface ChatLauncherProps {
  onClick: () => void;
  label?: string;
}

function AssistantGlyph({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="assistant-glyph-gradient" x1="10" y1="52" x2="54" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22D3EE" />
          <stop offset="0.52" stopColor="#6F8BFF" />
          <stop offset="1" stopColor="#F3B3D1" />
        </linearGradient>
      </defs>
      <path
        d="M32 6c4.5 0 6.9 8.2 9.7 14.1 1.6 3.5 4.3 6.2 7.8 7.8C55.4 30.7 64 33 64 37.6c0 4.7-8.6 7-14.5 9.7-3.5 1.6-6.2 4.3-7.8 7.8C38.9 61 36.5 64 32 64c-4.5 0-6.9-3-9.7-8.9-1.6-3.5-4.3-6.2-7.8-7.8C8.6 44.6 0 42.3 0 37.6c0-4.6 8.6-6.9 14.5-9.7 3.5-1.6 6.2-4.3 7.8-7.8C25.1 14.2 27.5 6 32 6Z"
        fill="url(#assistant-glyph-gradient)"
      />
      <rect x="21.5" y="27" width="7" height="13" rx="3.5" fill="white" fillOpacity="0.98" />
      <rect x="35.5" y="27" width="7" height="13" rx="3.5" fill="white" fillOpacity="0.98" />
    </svg>
  );
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
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const { messages, addMessage, flushSummary } = useChatHistory(courseId);
  const userMemory = useUserMemory();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(isOpen);
  const initialMessageSentRef = useRef(false);
  const questionContextRef = useRef<any>(null);

  const persistConversationSummary = useCallback((targetCourseId: string, summary: Parameters<typeof userMemory.addConversationSummary>[1]) => {
    userMemory.addConversationSummary(targetCourseId, summary);
  }, [userMemory]);

  // 监听 initialMessage 变化，更新 questionContext
  useEffect(() => {
    if (initialMessage) {
      try {
        const parsed = JSON.parse(initialMessage);
        if (parsed.type === 'correct' || parsed.type === 'incorrect') {
          questionContextRef.current = parsed;
        }
      } catch {
        // 不是 JSON，清空题目上下文（可能是课程目录页）
        questionContextRef.current = null;
      }
    }
  }, [initialMessage]);

  // 发送初始消息（答疑解惑）
  useEffect(() => {
    if (isOpen && initialMessage && !initialMessageSentRef.current) {
      initialMessageSentRef.current = true;
      
      // 解析题目名称
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
      // 自动发送
      setTimeout(() => {
        const form = document.querySelector('[data-chat-form]') as HTMLFormElement;
        form?.requestSubmit();
      }, 300);
    }
  }, [isOpen, initialMessage]);

  useEffect(() => {
    if (isOpen) {
      // 打开窗口时立即滚动到底部（instant 而非 smooth）
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    } else {
      // 关闭时只重置自动发送标记
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    
    setInput('');
    setIsLoading(true);
    setIsThinking(true);
    setStreamingContent('');

    addMessage(
      { role: 'user', content: userMessage },
      {
        onExpire: persistConversationSummary,
        onCompact: persistConversationSummary,
      }
    );

    try {
      const { getStoredData } = await import('@/lib/storage');
      const storedData = getStoredData();
      const course = storedData.courses.find((c) => c.courseId === courseId);

      if (!course) {
        throw new Error('Course not found');
      }

      // 限制历史消息：最多10条，且总长度不超过2000字符
      const MAX_MESSAGES = 10;
      const MAX_CONTENT_LENGTH = 2000;

      // 添加新消息
      const allMessages = [...messages, { role: 'user' as const, content: userMessage }];

      // 从最新开始保留，限制数量
      let limitedMessages = allMessages.slice(-MAX_MESSAGES);

      // 如果总长度超限，从最旧的开始删，直到总长度合适
      while (limitedMessages.length > 0) {
        const totalLength = limitedMessages.reduce((sum, m) => sum + m.content.length, 0);
        if (totalLength <= MAX_CONTENT_LENGTH) break;
        // 删除最旧的消息
        limitedMessages = limitedMessages.slice(1);
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course: {
            topic: course.topic,
          },
          messages: limitedMessages,
          contextInfo: {
            ...contextInfo,
            questionContext: questionContextRef.current,
          },
          conversationSummary: userMemory.getConversationSummary(courseId),
        }),
      });

      if (!response.ok) throw new Error('Failed to get response');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let fullContent = '';
      const decoder = new TextDecoder();

      let reasoningContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const delta = data.choices?.[0]?.delta;

              // 处理思考内容（reasoning_split: true 时分离出来）
              if (delta?.reasoning_details) {
                for (const detail of delta.reasoning_details) {
                  if (detail.text) {
                    reasoningContent += detail.text;
                  }
                }
                // 有思考内容时显示思考状态，但不显示思考内容
                if (reasoningContent && !fullContent) {
                  setIsThinking(true);
                }
              }

              // 处理实际回答内容
              const content = delta?.content;
              if (content) {
                fullContent += content;
                setStreamingContent(fullContent);
                setIsThinking(false);  // 开始收到回答时关闭思考指示器
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      addMessage(
        { role: 'assistant', content: fullContent },
        { onCompact: persistConversationSummary },
      );
      setStreamingContent('');
      setIsThinking(false);

      // 对话完成后更新记忆（V3 事件）
      const recentMessagesForMemory = [...messages, { role: 'user' as const, content: userMessage }];
      const lastUserMessage = recentMessagesForMemory.filter((m) => m.role === 'user').pop();
      const topicForMemory = memoryTopic || courseTitle;
      if (lastUserMessage) {
        // 记录学习偏好
        for (const preference of detectChatLearningPreferences(lastUserMessage.content)) {
          userMemory.addLearningPreference(preference);
        }

        // 记录掌握的概念
        const masteredConcept = detectExplicitMasteredConcept(lastUserMessage.content);
        if (masteredConcept) {
          userMemory.addMasteredConcept({
            ...masteredConcept,
            topic: topicForMemory,
          });
        }

        // 记录聊天信号（V3 事件，包含 question、confusion 等）
        const memorySignal = analyzeChatMessageForMemory(lastUserMessage.content);
        userMemory.recordChatSignals({
          topic: topicForMemory,
          question: lastUserMessage.content,
          confusionConcept: memorySignal.extractedConcept,
          confusionEvidence: memorySignal.shouldAddKnowledgeGap ? lastUserMessage.content : undefined,
          confidence: memorySignal.confidence,
          courseId,
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      addMessage({ role: 'assistant', content: '抱歉，发生了错误。请稍后再试。' });
      setIsThinking(false);
    } finally {
      setIsLoading(false);
    }
  };

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

            <div className="border-b border-black/6 px-4 pb-3 pt-4 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                      <AssistantGlyph className="h-4.5 w-4.5 shrink-0" />
                    </span>
                    <p className="flex min-h-5 items-center text-[11px] leading-none font-medium uppercase tracking-[0.16em] text-secondary/72">
                      学习助理
                    </p>
                  </div>
                  <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-primary">
                    一起拆开这节内容
                  </h2>
                  <p className="mt-1 truncate text-sm text-secondary">
                    当前课程：{courseTitle}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.045] text-secondary transition-colors hover:bg-black/[0.08] hover:text-primary"
                  aria-label="关闭助理"
                >
                  <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div
              className="flex-1 overflow-y-auto px-4 py-4 sm:px-5"
              onWheel={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              {messages.length === 0 && !isThinking && !streamingContent && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                  className="mb-4 rounded-[24px] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.90),rgba(246,250,249,0.92))] px-4 py-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(221,232,246,0.72))]">
                      <AssistantGlyph className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary">我会结合这节内容，帮你一起拆开难点。</p>
                      <p className="mt-1 text-sm leading-6 text-secondary">
                        你可以直接问我这一步的重点、哪里容易混淆，或者让我换一种更容易理解的讲法。
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              <div className="space-y-3">
                {messages.map((msg) => (
                  <ChatMessage key={msg.id} message={msg} />
                ))}
                {isThinking && !streamingContent && (
                  <div className="flex justify-start">
                    <div className="rounded-[20px] rounded-bl-md border border-black/5 bg-white/78 px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <motion.span className="h-2 w-2 rounded-full bg-[#7FBFC3]" animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.1, repeat: Infinity, delay: 0 }} />
                        <motion.span className="h-2 w-2 rounded-full bg-[#7FBFC3]" animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.1, repeat: Infinity, delay: 0.16 }} />
                        <motion.span className="h-2 w-2 rounded-full bg-[#7FBFC3]" animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.1, repeat: Infinity, delay: 0.32 }} />
                      </div>
                    </div>
                  </div>
                )}
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

            <form data-chat-form onSubmit={handleSubmit} className="border-t border-black/6 bg-white/62 px-4 pb-4 pt-3 sm:px-5">
              <div className="flex gap-2 rounded-[22px] border border-black/6 bg-white/88 p-2 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="哪里卡住了，直接问我"
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-primary placeholder:text-secondary/70 focus:outline-none"
                  disabled={isLoading}
                />
                <motion.button
                  type="submit"
                  whileHover={isLoading || !input.trim() ? undefined : { y: -1 }}
                  whileTap={isLoading || !input.trim() ? undefined : { y: 1, scale: 0.98 }}
                  disabled={isLoading || !input.trim()}
                  className="inline-flex min-w-[76px] items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#98B8E8,#7FBFC3)] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(127,191,195,0.20)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isLoading ? '思考中' : '发送'}
                </motion.button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
