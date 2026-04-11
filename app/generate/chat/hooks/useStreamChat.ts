import { useState, useRef, useCallback } from 'react';
import { useCourse } from '@/contexts/CourseContext';
import { extractThinkingAndVisibleContent, getStreamingThinkingState } from '../utils/contentParser';
import { useChatMessages } from './useChatMessages';
import type { OutlineBlueprint } from '@/types/course';

export function useStreamChat(topic: string) {
  const { submitOutlineMessage } = useCourse();
  const {
    messages,
    addMessage,
    updateMessageAt,
  } = useChatMessages();

  const [isWaitingResponse, setIsWaitingResponse] = useState(false);
  const [currentBlueprint, setCurrentBlueprint] = useState<OutlineBlueprint | null>(null);
  const [generatedCourseName, setGeneratedCourseName] = useState('');

  const sessionIdRef = useRef<string | null>(null);

  const streamState = useRef({
    streamingIndex: -1,
    rawContent: '',
    visibleContent: '',
    thinkingContent: '',
    sawThinkTag: false,
  });

  const sendMessage = useCallback(async (message?: string) => {
    if (isWaitingResponse) return;
    setIsWaitingResponse(true);

    streamState.current = {
      streamingIndex: -1,
      rawContent: '',
      visibleContent: '',
      thinkingContent: '',
      sawThinkTag: false,
    };

    if (message) {
      addMessage({ type: 'user', content: message, timestamp: Date.now() });
    } else {
      addMessage({ type: 'system', content: `收到，让我来帮你规划学习路径`, timestamp: Date.now() });
    }

    try {
      await submitOutlineMessage(topic, message, {
        onThinking: (msg) => {
          const s = streamState.current;
          if (s.sawThinkTag) return;

          s.thinkingContent += (msg || '') + '\n';
          if (s.streamingIndex < 0) {
            const idx = addMessage({
              type: 'streaming',
              content: '',
              thinkingContent: s.thinkingContent,
              isThinking: true,
              timestamp: Date.now(),
            });
            s.streamingIndex = idx;
          } else {
            updateMessageAt(s.streamingIndex, m =>
              m.type === 'streaming' ? { ...m, thinkingContent: s.thinkingContent, isThinking: true } : m
            );
          }
        },
        onContentDelta: (content) => {
          const s = streamState.current;
          s.rawContent += content;
          const parsed = extractThinkingAndVisibleContent(s.rawContent);
          if (parsed.thinkingContent) {
            s.sawThinkTag = true;
            s.thinkingContent = parsed.thinkingContent;
          }
          s.visibleContent = parsed.visibleContent;
          const isThinking = getStreamingThinkingState({
            sawThinkTag: s.sawThinkTag,
            hasOpenThinkBlock: parsed.hasOpenThinkBlock,
            hasThinkingContent: Boolean(s.thinkingContent.trim()),
          });

          if (s.streamingIndex < 0) {
            const idx = addMessage({
              type: 'streaming',
              content: s.visibleContent,
              thinkingContent: s.thinkingContent || undefined,
              isThinking,
              timestamp: Date.now(),
            });
            s.streamingIndex = idx;
          } else {
            updateMessageAt(s.streamingIndex, m =>
              m.type === 'streaming'
                ? {
                    ...m,
                    content: s.visibleContent,
                    thinkingContent: s.thinkingContent || m.thinkingContent,
                    isThinking,
                  }
                : m
            );
          }
        },
        onQuestions: (_questions, sessionId) => {
          if (sessionId) sessionIdRef.current = sessionId;
        },
        onConfirmation: (blueprint, sessionId) => {
          if (sessionId) sessionIdRef.current = sessionId;
          if (blueprint) {
            setCurrentBlueprint(blueprint);
            if (blueprint.learningDirection) {
              setGeneratedCourseName(blueprint.learningDirection.split('：')[0] || topic);
            }
          }
        },
        onSessionCreated: (sessionId) => {
          sessionIdRef.current = sessionId;
        },
        onError: () => {
          addMessage({ type: 'system', content: '抱歉，出现了一些问题，请稍后重试', timestamp: Date.now() });
        },
      });
    } catch (err) {
      addMessage({ type: 'system', content: '抱歉，出现了一些问题，请稍后重试', timestamp: Date.now() });
    } finally {
      const s = streamState.current;
      if (s.streamingIndex >= 0) {
        updateMessageAt(s.streamingIndex, msg =>
          msg.type === 'streaming' ? { ...msg, isThinking: false } : msg
        );
      }
      setIsWaitingResponse(false);
    }
  }, [isWaitingResponse, topic, submitOutlineMessage, addMessage, updateMessageAt]);

  return { messages, isWaitingResponse, currentBlueprint, generatedCourseName, sendMessage };
}
