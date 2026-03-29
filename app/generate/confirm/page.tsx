'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClarificationScreen, ChatMessageData } from '@/components/ClarificationScreen';
import { useCourse } from '@/contexts/CourseContext';
import type { CourseBlueprint, ClarificationQuestion } from '@/types/course';

interface OutlineResponse {
  type: 'confirmation' | 'questions' | 'reconsider';
  blueprint?: CourseBlueprint;
  questions?: { id: string; question: string; options?: string[] }[];
  message?: string;
}

function ConfirmPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic') || '';
  const { submitOutlineMessage } = useCourse();

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);
  const [blueprint, setBlueprint] = useState<CourseBlueprint | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (topic) {
      fetchOutline();
    }
  }, [topic]);

  const fetchOutline = async () => {
    setIsLoading(true);
    try {
      const result = await submitOutlineMessage(topic) as OutlineResponse;

      if (result.type === 'confirmation') {
        setBlueprint(result.blueprint || undefined);
        setQuestions([]);
        setMessages([{ role: 'assistant', content: '这是为你生成的课程纲要，请确认：', timestamp: Date.now() }]);
      } else if (result.type === 'questions') {
        setQuestions((result.questions || []).map((q: { id: string; question: string; options?: string[] }) => ({
          id: q.id,
          question: q.question,
          type: 'single' as const,
          options: q.options,
        })));
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
    const result = await submitOutlineMessage(topic, message) as OutlineResponse;

    if (result.type === 'confirmation') {
      setBlueprint(result.blueprint || undefined);
      setQuestions([]);
      setMessages(prev => [...prev, { role: 'assistant', content: '这是为你生成的课程纲要，请确认：', timestamp: Date.now() }]);
    } else if (result.type === 'questions') {
      setQuestions((result.questions || []).map((q: { id: string; question: string; options?: string[] }) => ({
        id: q.id,
        question: q.question,
        type: 'single' as const,
        options: q.options,
      })));
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

export default function ConfirmPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center">
            <svg className="w-6 h-6 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-secondary text-sm">加载中...</p>
        </div>
      </main>
    }>
      <ConfirmPageContent />
    </Suspense>
  );
}
