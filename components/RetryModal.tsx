'use client';

import { motion } from 'framer-motion';

interface RetryModalProps {
  isOpen: boolean;
  onRetry: () => void;
  message?: string;
}

export function RetryModal({ isOpen, onRetry, message = '内容生成遇到了问题' }: RetryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm rounded-[28px] bg-white p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
      >
        <motion.div
          initial={{ scale: 0.8, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ duration: 0.4, delay: 0.1, type: 'spring', stiffness: 200 }}
          className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-error/20 via-error/10 to-error/5 shadow-[0_8px_24px_rgba(239,71,111,0.15)]"
        >
          <svg className="h-10 w-10 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </motion.div>

        <h2 className="mb-3 text-[24px] font-bold text-primary">生成遇到问题</h2>
        <p className="mb-8 text-[15px] leading-relaxed text-secondary">
          {message}
        </p>

        <button
          onClick={onRetry}
          className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-accent px-6 py-4 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(255,138,0,0.20)] transition-all duration-150 hover:shadow-[0_12px_32px_rgba(255,138,0,0.25)] active:scale-[0.985]"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          重新生成
        </button>
      </motion.div>
    </div>
  );
}