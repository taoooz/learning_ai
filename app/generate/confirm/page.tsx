'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClarificationScreen, ChatMessageData } from '@/components/ClarificationScreen';
import { useCourse } from '@/contexts/CourseContext';
import type { CourseBlueprint, ClarificationQuestion } from '@/types/course';

export default function ConfirmPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic') || '';
  const { submitOutlineMessage } = useCourse();

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);
  const [blueprint, setBlueprint] = useState<CourseBlueprint | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (topic) {
      fetchOutline();
    }
  }, [topic]);

  const fetchOutline = async () => {
    setIsLoading(true);
    try {
      const result = await submitOutlineMessage(topic);

      if (result.type === 'confirmation') {
        setBlueprint(result.blueprint);
        setQuestions([]);
        setMessages([{ role: 'assistant', content: '这是为你生成的课程纲要，请确认：', timestamp: Date.now() }]);
      } else if (result.type === 'questions') {
        setQuestions(result.questions || []);
        setMessages([{ role: 'assistant', content: result.message || '请回答以下问题：', timestamp: Date.now() }]);
      } else if (result.type === 'reconsider') {
        setMessages([{ role: 'assistant', content: result.message || '让我重新思考...', timestamp: Date.now() }]);
      }
    } catch (error) {
      setMessages([{ role: 'assistant', content: '生成失败，请稍后再试。', timestamp: Date.now() }]);
    }
    setIsLoading(false);
  };

  const handleSendMessage = async (message: string) => {
    const result = await submitOutlineMessage(topic, message);

    if (result.type === 'confirmation') {
      setBlueprint(result.blueprint);
      setQuestions([]);
      setMessages(prev => [...prev, { role: 'assistant', content: '这是为你生成的课程纲要，请确认：', timestamp: Date.now() }]);
    } else if (result.type === 'questions') {
      setQuestions(result.questions || []);
      setMessages(prev => [...prev, { role: 'assistant', content: result.message || '请回答以下问题：', timestamp: Date.now() }]);
    } else if (result.type === 'reconsider') {
      setMessages(prev => [...prev, { role: 'assistant', content: result.message || '让我重新思考...', timestamp: Date.now() }]);
    }
  };

  const handleConfirm = (bp: CourseBlueprint) => {
    // 存储 blueprint 到 sessionStorage，跳转到 toc 生成页
    sessionStorage.setItem('pendingBlueprint', JSON.stringify(bp));
    router.push(`/generate/toc?topic=${encodeURIComponent(topic)}`);
  };

  return (
    <ClarificationScreen
      topic={topic}
      initialMessages={messages}
      questions={questions}
      blueprint={blueprint}
      onConfirm={handleConfirm}
      onSendMessage={handleSendMessage}
    />
  );
}