'use client';

import { motion } from 'framer-motion';

type LoadingMessageProps = {
  message: string;
};

export function LoadingMessage({ message }: LoadingMessageProps) {
  // 检查是否是思考中的消息
  const isThinking = message.includes('思考') || message.includes('分析');
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex justify-start"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-[rgba(0,0,0,0.06)] bg-surface px-4 py-3 max-w-[280px]">
        {/* 加载动画 */}
        <div className="flex gap-1 shrink-0">
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
            className="h-2 w-2 rounded-full bg-accent/60"
          />
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
            className="h-2 w-2 rounded-full bg-accent/60"
          />
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
            className="h-2 w-2 rounded-full bg-accent/60"
          />
        </div>
        <span className="text-sm text-secondary truncate">{message}</span>
      </div>
    </motion.div>
  );
}
