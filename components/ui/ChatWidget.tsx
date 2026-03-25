// components/ui/ChatWidget.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useUserMemory } from '@/hooks/useUserMemory';
import { ChatMessage as ChatMessageType } from '@/types/chat';

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, isThinking]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);
    setIsThinking(true);
    setStreamingContent('');

    addMessage({ role: 'user', content: userMessage });

    try {
      const { getStoredData } = await import('@/lib/storage');
      const storedData = getStoredData();
      const course = storedData.courses.find((c) => c.courseId === courseId);

      if (!course) {
        throw new Error('Course not found');
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course,
          messages: [...messages, { role: 'user', content: userMessage }],
          userMemory: userMemory.userMemory,
          contextInfo,
        }),
      });

      if (!response.ok) throw new Error('Failed to get response');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let fullContent = '';
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                setStreamingContent(fullContent);
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

      // 对话完成后更新记忆
      const allMessages = [...messages, { role: 'user' as const, content: userMessage }];
      const lastUserMessage = allMessages.filter((m) => m.role === 'user').pop();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-3xl w-full max-w-md mx-4 h-[600px] max-h-[80vh] flex flex-col shadow-float">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-subtle">
          <h2 className="font-bold text-primary">课程助理</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-subtle flex items-center justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          {isThinking && !streamingContent && (
            <div className="flex justify-start">
              <div className="px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-secondary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-secondary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-secondary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
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
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-subtle">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入你的问题..."
              className="flex-1 px-4 py-2 rounded-xl bg-subtle text-primary placeholder-secondary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-2 rounded-xl bg-accent text-white font-medium text-sm hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? '...' : '发送'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}