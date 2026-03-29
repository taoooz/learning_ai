'use client';

import { useState, useRef, useEffect } from 'react';
import type { ClarificationQuestion } from '@/types/course';
import { ChatMessage } from './ui/ChatMessage';

interface ClarificationScreenProps {
  topic: string;
  initialMessages: ChatMessageData[];
  questions?: ClarificationQuestion[];
  onSendMessage: (message: string) => Promise<void>;
}

export interface ChatMessageData {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function ClarificationScreen({ topic, initialMessages, questions, onSendMessage }: ClarificationScreenProps) {
  const [messages, setMessages] = useState<ChatMessageData[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    setError(null);
    const userMessage = { role: 'user' as const, content: input, timestamp: Date.now() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      await onSendMessage(input);
    } catch (err) {
      setError('发送失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    setError(null);
    handleSend();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={{ id: String(i), ...msg }} />
        ))}
        {isLoading && <div className="animate-pulse">AI 思考中...</div>}
        {error && (
          <div className="bg-error/10 border border-error/30 rounded-lg p-3 text-error text-sm">
            <div className="flex items-center justify-between">
              <span>{error}</span>
              <button onClick={handleRetry} className="underline hover:no-underline">
                重试
              </button>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="补充信息或回答问题..."
            className="flex-1 rounded-lg border px-4 py-2"
          />
          <button onClick={handleSend} disabled={isLoading} className="px-4 py-2 bg-primary text-white rounded-lg">
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
