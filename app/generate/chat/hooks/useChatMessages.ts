import { useState, useCallback, useRef } from 'react';

export type Message =
  | { type: 'system'; content: string; timestamp: number }
  | { type: 'user'; content: string; timestamp: number }
  | { type: 'streaming'; content: string; thinkingContent?: string; isThinking?: boolean; timestamp: number };

export function useChatMessages() {
  const [messages, setMessages] = useState<Message[]>([]);
  // ref 追踪长度，解决 addMessage 返回 index 的 race condition
  const lengthRef = useRef(0);

  const addMessage = useCallback((message: Message): number => {
    const index = lengthRef.current;
    lengthRef.current += 1;
    setMessages(prev => [...prev, message]);
    return index;
  }, []);

  const updateMessageAt = useCallback((index: number, updater: (msg: Message) => Message) => {
    setMessages(prev => prev.map((msg, i) => i === index ? updater(msg) : msg));
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    lengthRef.current = 0;
  }, []);

  return { messages, addMessage, updateMessageAt, reset };
}
