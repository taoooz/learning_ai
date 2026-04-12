import { useState, useCallback } from 'react';
import { useCourse } from '@/contexts/CourseContext';
import { parseStreamContent } from '../utils/contentParser';
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
      timestamp: Date.now(),
    });

    try {
      const result = await submitOutlineMessage(topic, message);

      if (result.blueprint) {
        const { blueprint } = result;
        setCurrentBlueprint(blueprint);
        setGeneratedCourseName(blueprint.learningDirection.split('：')[0] || topic);
        updateMessageAt(idx, m => {
          if (m.type !== 'streaming') return m;
          return { ...m, content: `学习方向：${blueprint.learningDirection}\n学习目标：${blueprint.learningGoal}` };
        });
      } else if (result.questions) {
        const blocks = parseStreamContent(JSON.stringify(result.questions));
        const textContent = blocks.map(b => b.type === 'text' ? b.content : JSON.stringify(b)).join('\n');
        updateMessageAt(idx, m => {
          if (m.type !== 'streaming') return m;
          return { ...m, content: textContent };
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
