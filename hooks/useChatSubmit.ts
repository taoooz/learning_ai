// hooks/useChatSubmit.ts

import { useState, useRef } from 'react';
import {
  analyzeChatMessageForMemory,
  detectChatLearningPreferences,
  detectExplicitMasteredConcept,
  getChatMemoryPayload,
} from '@/lib/memory';
import { refineAndApply } from '@/lib/memory/refine';

interface UseChatSubmitParams {
  courseId: string;
  courseTitle: string;
  memoryTopic?: string;
  contextInfo?: {
    currentNodeTitle?: string;
    currentNodeGoal?: string;
  };
  messages: Array<{ role: string; content: string; isExpired?: boolean }>;
  addMessage: (
    msg: { role: 'user' | 'assistant'; content: string },
    opts?: { onExpire?: (...args: any[]) => void; onCompact?: (...args: any[]) => void },
  ) => void;
  userMemory: {
    memoryStore: any;
    getConversationSummary: (courseId: string) => any;
    addLearningPreference: (preference: any) => void;
    addMasteredConcept: (concept: any) => void;
    recordChatSignals: (signals: any) => void;
  };
  questionContextRef: React.MutableRefObject<any>;
  persistConversationSummary: (...args: any[]) => void;
}

export function useChatSubmit(params: UseChatSubmitParams) {
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');

  // 用 ref 保存最新参数，避免闭包过期
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const isLoadingRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent, inputText: string, clearInput: () => void) => {
    e.preventDefault();
    if (!inputText.trim() || isLoadingRef.current) return;

    const {
      courseId,
      courseTitle,
      memoryTopic,
      contextInfo,
      messages,
      addMessage,
      userMemory,
      questionContextRef,
      persistConversationSummary,
    } = paramsRef.current;

    const userMessage = inputText.trim();

    clearInput();
    isLoadingRef.current = true;
    setIsLoading(true);
    setIsThinking(true);
    setStreamingContent('');

    addMessage(
      { role: 'user', content: userMessage },
      {
        onExpire: persistConversationSummary,
        onCompact: persistConversationSummary,
      },
    );

    try {
      const { getStoredData } = await import('@/lib/storage');
      const storedData = getStoredData();
      const course = storedData.courses.find((c: any) => c.courseId === courseId);

      if (!course) {
        throw new Error('Course not found');
      }

      // 限制历史消息：最多10条，且总长度不超过2000字符
      // 过期消息已凝结为对话摘要（conversationSummary）单独传递，不再重复发送原文
      const MAX_MESSAGES = 10;
      const MAX_CONTENT_LENGTH = 2000;
      const activeMessages = messages.filter((m) => !m.isExpired);
      const allMessages = [...activeMessages, { role: 'user' as const, content: userMessage }];
      let limitedMessages = allMessages.slice(-MAX_MESSAGES);

      while (limitedMessages.length > 0) {
        const totalLength = limitedMessages.reduce((sum, m) => sum + m.content.length, 0);
        if (totalLength <= MAX_CONTENT_LENGTH) break;
        limitedMessages = limitedMessages.slice(1);
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseTopic: course.topic,
          messages: limitedMessages,
          chatMemory: getChatMemoryPayload({
            topic: course.topic,
            currentNodeTitle: contextInfo?.currentNodeTitle,
            currentQuestion: questionContextRef.current?.question,
            userMemory: userMemory.memoryStore,
          }),
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
      // SSE 行缓冲：一行 data: 可能被拆到多个 chunk，逐 chunk split 会丢行；
      // decode 传 { stream: true } 避免多字节中文字符在 chunk 边界被截断产生乱码
      let buffer = '';

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        try {
          const data = JSON.parse(line.slice(6));
          const delta = data.choices?.[0]?.delta;

          if (delta?.reasoning_details) {
            for (const detail of delta.reasoning_details) {
              if (detail.text) {
                reasoningContent += detail.text;
              }
            }
            if (reasoningContent && !fullContent) {
              setIsThinking(true);
            }
          }

          const content = delta?.content;
          if (content) {
            fullContent += content;
            setStreamingContent(fullContent);
            setIsThinking(false);
          }
        } catch {
          // 忽略解析错误
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          processLine(line);
        }
      }
      // 处理流结束时残留在缓冲中的最后一行（正常以换行结尾的 SSE 不会有残留）
      processLine(buffer);

      addMessage(
        { role: 'assistant', content: fullContent },
        { onCompact: persistConversationSummary },
      );
      setStreamingContent('');
      setIsThinking(false);

      // 对话完成后更新记忆
      const lastUserMessage = [...messages, { role: 'user' as const, content: userMessage }]
        .filter((m) => m.role === 'user')
        .pop();
      const topicForMemory = memoryTopic || courseTitle;

      if (lastUserMessage) {
        for (const preference of detectChatLearningPreferences(lastUserMessage.content)) {
          userMemory.addLearningPreference(preference);
        }

        const masteredConcept = detectExplicitMasteredConcept(lastUserMessage.content);
        if (masteredConcept) {
          userMemory.addMasteredConcept({
            ...masteredConcept,
            topic: topicForMemory,
          });
        }

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

      // 后台触发 LLM 精炼（fire-and-forget，不阻塞）；过期消息已被摘要覆盖，不再参与精炼
      const allMessagesForRefine = [...activeMessages, { role: 'user' as const, content: userMessage }, { role: 'assistant' as const, content: fullContent }];
      refineAndApply(allMessagesForRefine).catch(() => {});
    } catch (error) {
      console.error('Chat error:', error);
      addMessage({ role: 'assistant', content: '抱歉，发生了错误。请稍后再试。' });
      setIsThinking(false);
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  };

  return { isLoading, isThinking, streamingContent, handleSubmit };
}
