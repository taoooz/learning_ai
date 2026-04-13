import { useState, useCallback } from 'react';
import { useCourse } from '@/contexts/CourseContext';
import { parseSSEStream } from '../utils/sseParser';
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

  const sendMessage = useCallback(async (message?: string) => {
    if (isWaitingResponse) return;
    setIsWaitingResponse(true);

    if (message) {
      addMessage({ type: 'user', content: message, timestamp: Date.now() });
    } else {
      addMessage({ type: 'system', content: `收到，让我来帮你规划学习路径`, timestamp: Date.now() });
    }

    const idx = addMessage({
      type: 'streaming',
      content: '',
      isThinking: true,
      timestamp: Date.now(),
    });

    try {
      const response = await submitOutlineMessage(topic, message);

      let fullContent = '';
      let thinkingContent = '';
      let foundBlueprint = false;

      for await (const event of parseSSEStream(response)) {
        switch (event.type) {
          case 'thinking':
            thinkingContent += event.message;
            updateMessageAt(idx, m => {
              if (m.type !== 'streaming') return m;
              return { ...m, thinkingContent, isThinking: true };
            });
            break;

          case 'content_delta':
            fullContent += event.content;
            updateMessageAt(idx, m => {
              if (m.type !== 'streaming') return m;
              return { ...m, content: fullContent, isThinking: false };
            });
            break;

          case 'session_created':
            if (event.sessionId) {
              sessionStorage.setItem('outlineSessionId', event.sessionId);
            }
            break;

          case 'questions': {
            const questions = event.questions || [];
            if (questions.length > 0) {
              const questionText = questions
                .map((q: { question: string; options?: string[] }) => {
                  let text = q.question;
                  if (q.options && q.options.length > 0) {
                    text += '\n' + q.options.map((o: string, i: number) => `  ${String.fromCharCode(65 + i)}. ${o}`).join('\n');
                  }
                  return text;
                })
                .join('\n\n');
              fullContent += questionText;
              updateMessageAt(idx, m => {
                if (m.type !== 'streaming') return m;
                return { ...m, content: fullContent, isThinking: false };
              });
            }
            if (event.sessionId) {
              sessionStorage.setItem('outlineSessionId', event.sessionId);
            }
            break;
          }

          case 'blueprint_field':
            if (event.field === 'learningDirection') {
              const direction = typeof event.value === 'string' ? event.value : '';
              setGeneratedCourseName(direction.split('：')[0] || topic);
            }
            break;

          case 'confirmation': {
            const blueprint = event.blueprint as OutlineBlueprint;
            if (blueprint) {
              foundBlueprint = true;
              setCurrentBlueprint(blueprint);
              setGeneratedCourseName(blueprint.learningDirection?.split('：')[0] || topic);
              updateMessageAt(idx, m => {
                if (m.type !== 'streaming') return m;
                return { ...m, content: `学习方向：${blueprint.learningDirection}\n学习目标：${blueprint.learningGoal}`, isThinking: false };
              });
            }
            if (event.sessionId) {
              sessionStorage.setItem('outlineSessionId', event.sessionId);
            }
            break;
          }

          case 'error':
            updateMessageAt(idx, m => {
              if (m.type !== 'streaming') return m;
              return { ...m, content: event.message || '生成出错', isThinking: false };
            });
            break;
        }
      }

      // 流结束后如果没有 blueprint，尝试从 content 中解析问题
      if (!foundBlueprint && fullContent) {
        updateMessageAt(idx, m => {
          if (m.type !== 'streaming') return m;
          return { ...m, content: fullContent, isThinking: false };
        });
      }
    } catch (_err) {
      addMessage({ type: 'system', content: '抱歉，出现了一些问题，请稍后重试', timestamp: Date.now() });
    } finally {
      updateMessageAt(idx, msg =>
        msg.type === 'streaming' ? { ...msg, isThinking: false } : msg
      );
      setIsWaitingResponse(false);
    }
  }, [isWaitingResponse, topic, submitOutlineMessage, addMessage, updateMessageAt]);

  return { messages, isWaitingResponse, currentBlueprint, generatedCourseName, sendMessage };
}
