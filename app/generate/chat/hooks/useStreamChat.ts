import { useState, useRef, useCallback } from 'react';
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
    removeLoadingMessages,
    disableQuestions,
  } = useChatMessages();

  const [isWaitingResponse, setIsWaitingResponse] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentBlueprint, setCurrentBlueprint] = useState<OutlineBlueprint | null>(null);
  const [generatedCourseName, setGeneratedCourseName] = useState('');

  // 用 ref 避免 useCallback 闭包过期问题
  const sessionIdRef = useRef<string | null>(null);
  const questionCountRef = useRef(0);

  // 流式处理中间状态（不需要触发渲染）
  const streamState = useRef({
    questionText: '',
    questionOptions: [] as string[],
    questionIndex: -1,
    questionNumber: 0,
    blueprint: {} as any,
  });

  const sendMessage = useCallback(async (message?: string) => {
    if (isWaitingResponse) return;
    setIsWaitingResponse(true);

    // 重置流式状态
    streamState.current = { questionText: '', questionOptions: [], questionIndex: -1, questionNumber: 0, blueprint: {} };

    if (message) {
      disableQuestions();
      addMessage({ type: 'user', content: message, timestamp: Date.now() });
      addMessage({ type: 'loading', message: '正在处理你的回答...', timestamp: Date.now() });
    } else {
      addMessage({ type: 'system', content: `好的，让我们开始创建「${topic}」课程`, timestamp: Date.now() });
      addMessage({ type: 'loading', message: '正在分析你的需求...', timestamp: Date.now() });
    }

    try {
      const result = await submitOutlineMessage(topic, message, sessionIdRef.current || undefined);

      if (!(result instanceof Response)) {
        console.warn('[StreamChat] Expected streaming response');
        return;
      }

      for await (const event of parseSSEStream(result)) {
        removeLoadingMessages();

        switch (event.type) {
          case 'thinking':
            addMessage({ type: 'loading', message: event.message || '正在思考...', timestamp: Date.now() });
            break;

          case 'content_delta': {
            const s = streamState.current;
            s.questionText += event.content;

            if (s.questionIndex < 0) {
              s.questionNumber = questionCountRef.current + 1;
              const idx = addMessage({
                type: 'question',
                question: s.questionText,
                options: [],
                questionNumber: s.questionNumber,
                timestamp: Date.now(),
                disabled: false,
              });
              s.questionIndex = idx;
            } else {
              updateMessageAt(s.questionIndex, msg =>
                msg.type === 'question' ? { ...msg, question: s.questionText } : msg
              );
            }
            break;
          }

          case 'question_start':
            streamState.current.questionNumber = event.questionNumber;
            questionCountRef.current = event.questionNumber;
            break;

          case 'questions': {
            if (event.sessionId) {
              setSessionId(event.sessionId);
              sessionIdRef.current = event.sessionId;
            }
            const q = event.questions?.[0];
            if (!q) break;

            const s = streamState.current;
            s.questionOptions = q.options || [];

            if (s.questionIndex < 0) {
              const idx = addMessage({
                type: 'question',
                question: q.question,
                options: [],
                questionNumber: questionCountRef.current + 1,
                timestamp: Date.now(),
                disabled: false,
              });
              s.questionIndex = idx;
            } else {
              updateMessageAt(s.questionIndex, msg =>
                msg.type === 'question' ? { ...msg, question: q.question } : msg
              );
            }

            // 延迟逐个显示选项
            for (let i = 0; i < s.questionOptions.length; i++) {
              await new Promise(r => setTimeout(r, 200));
              updateMessageAt(s.questionIndex, msg =>
                msg.type === 'question' ? { ...msg, options: s.questionOptions.slice(0, i + 1) } : msg
              );
            }
            break;
          }

          case 'blueprint_start':
            streamState.current.blueprint = {};
            addMessage({ type: 'system', content: '根据你的情况，我为你设计了这个学习路径', timestamp: Date.now() });
            addMessage({ type: 'loading', message: '正在生成学习路径...', timestamp: Date.now() });
            break;

          case 'blueprint_field': {
            streamState.current.blueprint[event.field] = event.value;
            const names: Record<string, string> = { learningDirection: '学习方向', learningGoal: '学习目标', learnerPositioning: '学习者定位' };
            addMessage({ type: 'loading', message: `正在生成${names[event.field] || event.field}...`, timestamp: Date.now() });
            break;
          }

          case 'confirmation':
            if (event.sessionId) {
              setSessionId(event.sessionId);
              sessionIdRef.current = event.sessionId;
            }
            if (event.blueprint) {
              setCurrentBlueprint(event.blueprint);
              if (event.blueprint.learningDirection) {
                setGeneratedCourseName(event.blueprint.learningDirection.split('：')[0] || topic);
              }
              removeLoadingMessages();
              addMessage({ type: 'outline', blueprint: event.blueprint, editable: true, timestamp: Date.now() });
            }
            break;
        }
      }
    } catch (err) {
      removeLoadingMessages();
      addMessage({ type: 'system', content: '抱歉，出现了一些问题，请稍后重试', timestamp: Date.now() });
    } finally {
      setIsWaitingResponse(false);
    }
  }, [isWaitingResponse, topic, submitOutlineMessage, addMessage, updateMessageAt, removeLoadingMessages, disableQuestions]);

  return { messages, isWaitingResponse, currentBlueprint, generatedCourseName, sendMessage };
}
