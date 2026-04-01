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
            ? 'bg-accent text-white max-w-[80%]'
            : 'bg-surface border border-[rgba(0,0,0,0.06)] text-primary'
        }`}
      >
        {message.content}
      </div>
    </motion.div>
  );
}
