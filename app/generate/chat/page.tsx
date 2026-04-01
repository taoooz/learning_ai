'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { QuestionCard } from '@/components/chat/QuestionCard';
import { OutlineCard } from '@/components/chat/OutlineCard';
import { LoadingMessage } from '@/components/chat/LoadingMessage';
import { useStreamChat } from './hooks/useStreamChat';

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic') || '';

  const { messages, isWaitingResponse, currentBlueprint, generatedCourseName, sendMessage } = useStreamChat(topic);

  const [adjustmentInput, setAdjustmentInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!topic || hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    sendMessage();
  }, [topic, sendMessage]);

  const handleConfirmOutline = () => {
    if (!currentBlueprint) return;
    const outline = {
      topic: generatedCourseName || topic,
      learningDirection: currentBlueprint.learningDirection,
      learningGoal: currentBlueprint.learningGoal,
      learnerPositioning: currentBlueprint.learnerPositioning,
    };
    sessionStorage.setItem('pendingOutline', JSON.stringify(outline));
    router.push(`/generate/toc?topic=${encodeURIComponent(outline.topic)}`);
  };

  const handleAdjustOutline = async () => {
    if (!adjustmentInput.trim() || isWaitingResponse) return;
    const msg = adjustmentInput.trim();
    setAdjustmentInput('');
    await sendMessage(msg);
  };

  return (
    <main className="flex h-screen flex-col bg-background">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-accent/8 to-transparent blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-accent/6 to-transparent blur-3xl" />
      </div>

      <CourseHeaderBar title="创建课程" backLabel="返回" onBack={() => router.push('/')} />

      <div className="relative flex-1 overflow-y-auto px-5 pt-20 pb-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((msg, idx) => {
            if (msg.type === 'system' || msg.type === 'user') {
              return <MessageBubble key={idx} message={msg} />;
            } else if (msg.type === 'question') {
              return (
                <QuestionCard
                  key={idx}
                  question={msg.question}
                  options={msg.options}
                  questionNumber={msg.questionNumber}
                  onSelect={(answer) => sendMessage(answer)}
                  disabled={isWaitingResponse || msg.disabled || false}
                />
              );
            } else if (msg.type === 'outline') {
              return (
                <OutlineCard
                  key={idx}
                  blueprint={msg.blueprint}
                  onConfirm={handleConfirmOutline}
                  showActions={idx === messages.length - 1}
                />
              );
            } else if (msg.type === 'loading') {
              return <LoadingMessage key={idx} message={msg.message} />;
            }
            return null;
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {currentBlueprint && (
        <div className="relative border-t border-[rgba(0,0,0,0.06)] bg-surface px-5 py-4">
          <div className="mx-auto max-w-2xl flex gap-3">
            <input
              type="text"
              value={adjustmentInput}
              onChange={(e) => setAdjustmentInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdjustOutline()}
              placeholder="有什么想调整的吗？"
              disabled={isWaitingResponse}
              className="flex-1 rounded-full border border-[rgba(0,0,0,0.1)] bg-background px-5 py-3 text-sm text-primary placeholder:text-tertiary focus:border-accent/40 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={handleAdjustOutline}
              disabled={!adjustmentInput.trim() || isWaitingResponse}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-all hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ChatPageContent />
    </Suspense>
  );
}
