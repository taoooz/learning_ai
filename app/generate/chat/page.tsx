'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { QuestionCard } from '@/components/chat/QuestionCard';
import { OutlineCard } from '@/components/chat/OutlineCard';
import { LoadingMessage } from '@/components/chat/LoadingMessage';
import { RichStreamingMessage } from '@/components/chat/RichStreamingMessage';
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

      <CourseHeaderBar title="创建课程" backLabel="首页" onBack={() => router.push('/')} />

      <div className="relative flex-1 overflow-y-auto px-5 pt-20 pb-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((msg, idx) => {
            if (msg.type === 'system' || msg.type === 'user') {
              return <MessageBubble key={idx} message={msg} />;
            } else if (msg.type === 'streaming') {
              return (
                <RichStreamingMessage
                  key={idx}
                  content={msg.content}
                  thinkingContent={msg.thinkingContent}
                  isThinking={msg.isThinking}
                  onQuestionAnswer={(id, answer) => sendMessage(answer)}
                  onOutlineConfirm={handleConfirmOutline}
                />
              );
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
        <div className="relative border-t border-black/[0.06] bg-white px-5 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
          <div className="mx-auto max-w-2xl flex gap-3">
            <input
              type="text"
              value={adjustmentInput}
              onChange={(e) => setAdjustmentInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdjustOutline()}
              placeholder="有什么想调整的吗？"
              disabled={isWaitingResponse}
              className="flex-1 rounded-full border-2 border-black/[0.08] bg-white px-5 py-3.5 text-[15px] text-primary placeholder:text-tertiary focus:border-accent focus:outline-none disabled:opacity-50 transition-colors"
            />
            <button
              onClick={handleAdjustOutline}
              disabled={!adjustmentInput.trim() || isWaitingResponse}
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-[0_4px_16px_rgba(255,138,0,0.20)] transition-all hover:shadow-[0_6px_20px_rgba(255,138,0,0.25)] active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
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
