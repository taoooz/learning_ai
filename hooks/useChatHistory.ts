// hooks/useChatHistory.ts
import { useCallback } from 'react';
import { ChatMessage } from '@/types/chat';

const CHAT_HISTORY_PREFIX = 'chatHistory_';
const EXPIRATION_DAYS = 7;
const MAX_MESSAGE_PAIRS = 5;  // 最多保留5对问答
const MAX_TOTAL_CHARS = 2000;  // 总字符数限制

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function groupMessagesIntoPairs(messages: ChatMessage[]): Array<{ q: ChatMessage; a: ChatMessage }> {
  const pairs: Array<{ q: ChatMessage; a: ChatMessage }> = [];
  let i = 0;
  while (i < messages.length - 1) {
    if (messages[i].role === 'user') {
      const nextMsg = messages[i + 1];
      if (nextMsg && nextMsg.role === 'assistant') {
        pairs.push({ q: messages[i], a: nextMsg });
        i += 2;
        continue;
      }
    }
    i++;
  }
  return pairs;
}

function truncateByPairs(messages: ChatMessage[], maxPairs: number, maxChars: number): ChatMessage[] {
  const pairs = groupMessagesIntoPairs(messages);

  let validPairs = pairs;
  while (validPairs.length > maxPairs || calculateTotalChars(validPairs) > maxChars) {
    if (validPairs.length === 0) break;
    validPairs = validPairs.slice(1);
  }

  return validPairs.flatMap(pair => [pair.q, pair.a]);
}

function calculateTotalChars(pairs: Array<{ q: ChatMessage; a: ChatMessage }>): number {
  return pairs.reduce((sum, pair) => sum + pair.q.content.length + pair.a.content.length, 0);
}

function checkExpiration(messages: ChatMessage[]): boolean {
  if (messages.length === 0) return false;

  const lastMessage = messages[messages.length - 1];
  const daysSinceLastMessage = (Date.now() - lastMessage.timestamp) / (1000 * 60 * 60 * 24);

  return daysSinceLastMessage > EXPIRATION_DAYS;
}

function generateSimpleSummary(messages: ChatMessage[]): string {
  const userQuestions = messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .slice(-3);

  if (userQuestions.length === 0) return '用户询问了课程相关问题';

  const firstQuestion = userQuestions[0];
  return `用户问了：${firstQuestion.slice(0, 15)}${firstQuestion.length > 15 ? '...' : ''}`;
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

  const addMessage = useCallback((
    message: Omit<ChatMessage, 'id' | 'timestamp'>,
    options?: {
      onExpire?: (courseId: string, summary: string) => void;
    }
  ): void => {
    if (typeof window === 'undefined') return;

    const messages = getMessages();
    const newMessage: ChatMessage = {
      ...message,
      id: generateId(),
      timestamp: Date.now(),
    };

    let updatedMessages = [...messages, newMessage];

    const isExpired = checkExpiration(updatedMessages);

    if (isExpired) {
      const summary = generateSimpleSummary(updatedMessages);
      updatedMessages = updatedMessages.map(m => ({ ...m, isExpired: true }));
      options?.onExpire?.(courseId, summary);
    }

    if (!isExpired) {
      const pairs = groupMessagesIntoPairs(updatedMessages);
      if (pairs.length > MAX_MESSAGE_PAIRS || calculateTotalChars(pairs) > MAX_TOTAL_CHARS) {
        updatedMessages = truncateByPairs(updatedMessages, MAX_MESSAGE_PAIRS, MAX_TOTAL_CHARS);
      }
    }

    try {
      localStorage.setItem(`${CHAT_HISTORY_PREFIX}${courseId}`, JSON.stringify(updatedMessages));
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
