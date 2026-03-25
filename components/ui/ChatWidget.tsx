// components/ui/ChatWidget.tsx
'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useUserMemory } from '@/hooks/useUserMemory';

function extractSimpleConcept(text: string): string {
  const match = text.match(/([^，,？?\s]{2,10})(是什么|为什么|如何|怎么)/);
  return match ? match[1] : text.slice(0, 10);
}

interface ChatWidgetProps {
  courseId: string;
  courseTitle: string;
  isOpen: boolean;
  onClose: () => void;
  // 额外上下文信息
  contextInfo?: {
    // 当前节点信息（学习页使用）
    currentNodeTitle?: string;
    currentNodeCards?: string[];
    currentQuestion?: string;
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
      className="group fixed bottom-24 right-5 z-40 inline-flex h-13 items-center gap-2 rounded-full border border-black/6 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(255,248,242,0.98))] px-3.5 pr-4 text-primary shadow-[0_10px_30px_rgba(15,23,42,0.10)] backdrop-blur-md transition-[width,box-shadow] duration-200 hover:shadow-[0_16px_34px_rgba(15,23,42,0.12)]"
      aria-label={label}
    >
      <span className="relative flex h-8.5 w-8.5 items-center justify-center rounded-full bg-[linear-gradient(135deg,#F4B476,#E59B58)] text-primary shadow-[0_8px_18px_rgba(229,155,88,0.18)]">
        <span className="absolute inset-0 rounded-full bg-white/20" />
        <svg className="relative h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </span>
      <span className="hidden pr-0.5 text-[13px] font-medium text-primary/86 sm:inline">
        {label}
      </span>
    </motion.button>
  );
}

export function ChatWidget({ courseId, courseTitle, isOpen, onClose, contextInfo }: ChatWidgetProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const { messages, addMessage } = useChatHistory(courseId);
  const userMemory = useUserMemory();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      // 打开窗口时立即滚动到底部（instant 而非 smooth）
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      inputRef.current?.focus();
    }
  }, [isOpen]);

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

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

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
        onExpire: (courseId: string, summary: string) => {
          userMemory.addConversationSummary(courseId, summary);
        },
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
          course,
          messages: limitedMessages,
          userMemory: userMemory.userMemory,
          contextInfo,
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

      addMessage({ role: 'assistant', content: fullContent });
      setStreamingContent('');
      setIsThinking(false);

      // 对话完成后更新记忆（使用未限制的全部消息）
      const recentMessagesForMemory = [...messages, { role: 'user' as const, content: userMessage }];
      const lastUserMessage = recentMessagesForMemory.filter((m) => m.role === 'user').pop();
      if (lastUserMessage) {
        userMemory.addQuestionPattern(lastUserMessage.content, courseTitle);

        const simplePatterns = ['是什么', '为什么', '如何', '怎么', '区别', '关系'];
        const hasConfusion = simplePatterns.some((p) => lastUserMessage.content.includes(p));
        if (hasConfusion) {
          const concept = extractSimpleConcept(lastUserMessage.content);
          userMemory.addKnowledgeGap(concept, courseTitle, lastUserMessage.content);
        }

        userMemory.updateInterests(courseTitle, 'chat', courseId);
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
            <div className="pointer-events-none absolute right-[-32px] top-[-18px] h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(255,174,92,0.26),rgba(255,174,92,0)_72%)]" />

            <div className="border-b border-black/6 px-4 pb-3 pt-4 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-secondary/72">
                    学习助理
                  </p>
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
                <div className="mb-4 rounded-[24px] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(250,246,241,0.92))] px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#F1DCC6,#E8C59E)] text-primary">
                      <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary">我会结合这节内容，帮你一起拆开难点。</p>
                      <p className="mt-1 text-sm leading-6 text-secondary">
                        你可以直接问我这一步的重点、哪里容易混淆，或者让我换一种更容易理解的讲法。
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {messages.map((msg) => (
                  <ChatMessage key={msg.id} message={msg} />
                ))}
                {isThinking && !streamingContent && (
                  <div className="flex justify-start">
                    <div className="rounded-[20px] rounded-bl-md border border-black/5 bg-white/78 px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <motion.span className="h-2 w-2 rounded-full bg-[#D89B61]" animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.1, repeat: Infinity, delay: 0 }} />
                        <motion.span className="h-2 w-2 rounded-full bg-[#D89B61]" animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.1, repeat: Infinity, delay: 0.16 }} />
                        <motion.span className="h-2 w-2 rounded-full bg-[#D89B61]" animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.1, repeat: Infinity, delay: 0.32 }} />
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

            <form onSubmit={handleSubmit} className="border-t border-black/6 bg-white/62 px-4 pb-4 pt-3 sm:px-5">
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
                  className="inline-flex min-w-[76px] items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#F4B476,#E59B58)] px-4 py-2 text-sm font-semibold text-primary shadow-[0_10px_20px_rgba(229,155,88,0.18)] disabled:cursor-not-allowed disabled:opacity-45"
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
