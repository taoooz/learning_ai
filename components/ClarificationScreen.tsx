'use client';

import { useState, useRef, useEffect } from 'react';
import type { CourseBlueprint, ClarificationQuestion } from '@/types/course';
import { ChatMessage } from './ui/ChatMessage';
import { ConfirmationCard } from './ConfirmationCard';

interface ClarificationScreenProps {
  topic: string;
  initialMessages: ChatMessageData[];
  questions?: ClarificationQuestion[];
  blueprint?: CourseBlueprint;
  onConfirm: (blueprint: CourseBlueprint) => void;
  onSendMessage: (message: string) => Promise<void>;
}

export interface ChatMessageData {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function ClarificationScreen({ topic, initialMessages, questions, blueprint, onConfirm, onSendMessage }: ClarificationScreenProps) {
  const [messages, setMessages] = useState<ChatMessageData[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user' as const, content: input, timestamp: Date.now() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      await onSendMessage(input);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (blueprint) onConfirm(blueprint);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={{ id: String(i), ...msg }} />
        ))}
        {isLoading && <div className="animate-pulse">AI 思考中...</div>}
        <div ref={messagesEndRef} />
      </div>

      {!questions?.length && blueprint && (
        <ConfirmationCard blueprint={blueprint} onConfirm={handleConfirm} onEdit={() => {}} />
      )}

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