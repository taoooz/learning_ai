'use client';

import { motion } from 'framer-motion';

type MessageBubbleProps = {
  message: {
    type: 'system' | 'user';
    content: string;
    timestamp: number;
  };
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.type === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
          isUser
            ? 'max-w-[80%] border border-[rgba(190,120,38,0.18)] bg-[linear-gradient(135deg,rgba(222,147,56,0.98),rgba(199,127,43,0.96))] text-white shadow-[0_10px_24px_rgba(191,123,43,0.18)]'
            : 'bg-surface border border-[rgba(0,0,0,0.06)] text-primary'
        }`}
      >
        {message.content}
      </div>
    </motion.div>
  );
}
