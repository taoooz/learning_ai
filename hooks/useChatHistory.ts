// hooks/useChatHistory.ts
import { useCallback } from 'react';
import { ChatMessage } from '@/types/chat';

const CHAT_HISTORY_PREFIX = 'chatHistory_';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useChatHistory(courseId: string) {
  const getMessages = useCallback((): ChatMessage[] => {
    if (typeof window === 'undefined') return [];

    try {
      const raw = localStorage.getItem(`${CHAT_HISTORY_PREFIX}${courseId}`);
      if (!raw) return [];
      return JSON.parse(raw) as ChatMessage[];
    } catch {
      return [];
    }
  }, [courseId]);

  const addMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>): void => {
    if (typeof window === 'undefined') return;

    const messages = getMessages();
    const newMessage: ChatMessage = {
      ...message,
      id: generateId(),
      timestamp: Date.now(),
    };
    messages.push(newMessage);

    try {
      localStorage.setItem(`${CHAT_HISTORY_PREFIX}${courseId}`, JSON.stringify(messages));
    } catch {
      // localStorage 可能已满，忽略
    }
  }, [courseId, getMessages]);

  const clearHistory = useCallback((): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(`${CHAT_HISTORY_PREFIX}${courseId}`);
  }, [courseId]);

  return {
    messages: getMessages(),
    addMessage,
    clearHistory,
  };
}
