'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CourseHeaderBar } from '@/components/CourseHeaderBar';
import { MessageBubble } from '@/components/chat/MessageBubble';
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
    // 新课程生成时，清除旧 session，防止走 answer_agent 分支
    sessionStorage.removeItem('outlineSessionId');
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
                  onQuestionAnswer={(answer) => sendMessage(answer)}
                  onOutlineConfirm={handleConfirmOutline}
                  disableInteractions={isWaitingResponse}
                />
              );
            }
            return null;
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {currentBlueprint && (
        <div className="relative border-t border-black/[0.05] bg-[linear-gradient(180deg,rgba(255,252,248,0.92),rgba(255,255,255,0.98))] px-5 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.04)] backdrop-blur-sm">
          <div className="mx-auto max-w-2xl flex gap-3">
            <input
              type="text"
              value={adjustmentInput}
              onChange={(e) => setAdjustmentInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdjustOutline()}
              placeholder="有什么想调整的吗？"
              disabled={isWaitingResponse}
              className="flex-1 rounded-full border border-[rgba(0,0,0,0.08)] bg-white/92 px-5 py-3.5 text-[15px] text-primary placeholder:text-tertiary focus:border-[rgba(190,120,38,0.34)] focus:outline-none disabled:opacity-50 transition-colors"
            />
            <button
              onClick={handleAdjustOutline}
              disabled={!adjustmentInput.trim() || isWaitingResponse}
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-[rgba(190,120,38,0.16)] bg-[linear-gradient(135deg,rgba(224,149,58,1),rgba(198,126,42,0.98))] text-white shadow-[0_10px_24px_rgba(191,123,43,0.20)] transition-all hover:shadow-[0_14px_30px_rgba(191,123,43,0.24)] active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
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
