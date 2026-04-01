// hooks/useChatHistory.ts
import { useCallback } from 'react';
import type { ChatMessage } from '@/types/chat';
import type { ConversationSummary } from '@/types/course';
import {
  analyzeChatMessageForMemory,
  detectAssistantExplanationStyle,
  detectChatLearningPreferences,
} from '@/lib/memory/aggregator';
import { generateId } from '@/lib/quiz-utils';

const CHAT_HISTORY_PREFIX = 'chatHistory_';
const EXPIRATION_DAYS = 7;
const MAX_MESSAGE_PAIRS = 5;  // 最多保留5对问答
const MAX_TOTAL_CHARS = 2000;  // 总字符数限制

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

function diffDroppedMessages(previous: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  const nextIds = new Set(next.map((message) => message.id));
  return previous.filter((message) => !nextIds.has(message.id));
}

export function compactChatHistoryMessages(
  messages: ChatMessage[],
  maxPairs: number = MAX_MESSAGE_PAIRS,
  maxChars: number = MAX_TOTAL_CHARS,
): {
  messages: ChatMessage[];
  droppedSummary?: Omit<ConversationSummary, 'courseId' | 'timestamp'>;
} {
  const pairs = groupMessagesIntoPairs(messages);
  if (pairs.length <= maxPairs && calculateTotalChars(pairs) <= maxChars) {
    return { messages };
  }

  const compacted = truncateByPairs(messages, maxPairs, maxChars);
  const droppedMessages = diffDroppedMessages(messages, compacted);
  if (droppedMessages.length < 2) {
    return { messages: compacted };
  }

  return {
    messages: compacted,
    droppedSummary: generateConversationSummary(droppedMessages),
  };
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

function truncateText(text: string, maxLength: number = 26): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function inferResolutionStatus(messages: ChatMessage[]): ConversationSummary['resolutionStatus'] {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  if (!lastUserMessage) return 'partial';

  const latestSignal = analyzeChatMessageForMemory(lastUserMessage.content);
  if (latestSignal.shouldAddKnowledgeGap) return 'open';
  return 'partial';
}

export function generateConversationSummary(messages: ChatMessage[]): Omit<ConversationSummary, 'courseId' | 'timestamp'> {
  const userMessages = messages.filter((message) => message.role === 'user');
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  
  // 提取最近3个问题（简化版）
  const mainQuestions = userMessages
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(-3)
    .map((item) => truncateText(item, 40));

  // 提取未解决的概念
  const unresolvedConcepts = Array.from(new Set(
    userMessages
      .map((message) => analyzeChatMessageForMemory(message.content))
      .filter((result) => result.shouldAddKnowledgeGap && result.extractedConcept)
      .map((result) => result.extractedConcept as string),
  )).slice(0, 3);

  // 提取偏好的解释方式
  const preferredExplanationStyles = Array.from(new Set(
    userMessages.flatMap((message) => detectChatLearningPreferences(message.content).map((item) => item.value)),
  )).slice(0, 2);

  // 提取最近使用的解释路径
  const explanationPath = [...assistantMessages]
    .reverse()
    .map((message) => detectAssistantExplanationStyle(message.content))
    .find(Boolean);

  const resolutionStatus = inferResolutionStatus(messages);

  // 生成简洁的摘要文本
  const summaryParts: string[] = [];
  
  if (mainQuestions.length > 0) {
    summaryParts.push(`讨论了：${mainQuestions.join('、')}`);
  }
  
  if (unresolvedConcepts.length > 0) {
    summaryParts.push(`待深入：${unresolvedConcepts.join('、')}`);
  }

  return {
    summary: summaryParts.join('。') || '进行了课程相关讨论',
    mainQuestions,
    unresolvedConcepts,
    preferredExplanationStyles,
    explanationPath,
    resolutionStatus,
    followUp: unresolvedConcepts[0] ? `可继续探讨 ${unresolvedConcepts[0]}` : undefined,
  };
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
      onExpire?: (courseId: string, summary: Omit<ConversationSummary, 'courseId' | 'timestamp'>) => void;
      onCompact?: (courseId: string, summary: Omit<ConversationSummary, 'courseId' | 'timestamp'>) => void;
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
      const summary = generateConversationSummary(updatedMessages);
      updatedMessages = updatedMessages.map(m => ({ ...m, isExpired: true }));
      options?.onExpire?.(courseId, summary);
    }

    if (!isExpired) {
      const compacted = compactChatHistoryMessages(updatedMessages);
      updatedMessages = compacted.messages;
      if (compacted.droppedSummary) {
        options?.onCompact?.(courseId, compacted.droppedSummary);
      }
    }

    try {
      localStorage.setItem(`${CHAT_HISTORY_PREFIX}${courseId}`, JSON.stringify(updatedMessages));
    } catch {
      // localStorage 可能已满，忽略
    }
  }, [courseId, getMessages]);

  const flushSummary = useCallback((
    callback?: (courseId: string, summary: Omit<ConversationSummary, 'courseId' | 'timestamp'>) => void,
  ): void => {
    const messages = getMessages().filter((message) => !message.isExpired);
    if (messages.length < 2) return;
    callback?.(courseId, generateConversationSummary(messages));
  }, [courseId, getMessages]);

  const clearHistory = useCallback((): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(`${CHAT_HISTORY_PREFIX}${courseId}`);
  }, [courseId]);

  return {
    messages: getMessages(),
    addMessage,
    clearHistory,
    flushSummary,
  };
}
