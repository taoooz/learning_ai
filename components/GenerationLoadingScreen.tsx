'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const loadingMessages = [
  '先理解你想学什么，以及你为什么现在要学它',
  '正在整理更适合你的学习顺序',
  '把复杂知识拆成更容易坚持的小步',
  '正在生成第一版课程目录',
  '继续打磨每一节的学习节奏',
  '快好了，正在润色你的专属学习路径',
];

interface GenerationLoadingScreenProps {
  title?: string;
}

export function GenerationLoadingScreen({
  title = '正在为你编排学习路径',
}: GenerationLoadingScreenProps) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % loadingMessages.length);
    }, 3800);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="relative min-h-[100svh] overflow-x-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 right-[-8rem] h-80 w-80 rounded-full bg-gradient-to-br from-accent/16 via-accent/8 to-transparent blur-3xl" />
        <div className="absolute left-[-5rem] top-20 h-64 w-64 rounded-full bg-gradient-to-br from-sky-400/16 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-[-7rem] left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-gradient-to-br from-amber-200/12 to-transparent blur-3xl" />
      </div>

      <div
        className="relative mx-auto flex w-full max-w-2xl flex-col px-6 pt-5 text-center sm:px-8"
        style={{
          minHeight: '100svh',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="mb-6 flex justify-start self-stretch">
          <button
            type="button"
            onClick={() => window.history.length > 1 ? window.history.back() : (window.location.href = '/')}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/70 bg-surface/88 px-3.5 text-sm font-medium text-secondary shadow-[0_6px_16px_rgba(15,23,42,0.05)] backdrop-blur-md transition-colors hover:bg-surface"
            aria-label="返回"
          >
            <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>返回</span>
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-xl"
        >
          <div className="relative mx-auto mb-9 flex h-[320px] w-full max-w-[430px] items-center justify-center">
            <motion.div
              animate={{ y: [-4, 4, -4] }}
              transition={{ duration: 5.4, repeat: Infinity, ease: 'easeInOut' }}
              className="relative h-[248px] w-full max-w-[340px] overflow-hidden rounded-[36px]"
            >
              <div className="absolute inset-0 rounded-[36px] bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(255,248,241,0.98)_58%,rgba(255,255,255,0.95))] shadow-[0_28px_64px_rgba(15,23,42,0.10)]" />

              <div
                className="pointer-events-none absolute left-0 top-0 h-36 w-44 opacity-38"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgba(56,189,248,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.11) 1px, transparent 1px)',
                  backgroundSize: '18px 18px',
                  maskImage: 'radial-gradient(circle at 25% 18%, black 0%, rgba(0,0,0,0.86) 32%, transparent 80%)',
                  WebkitMaskImage: 'radial-gradient(circle at 25% 18%, black 0%, rgba(0,0,0,0.86) 32%, transparent 80%)',
                }}
              />

              <motion.div
                animate={{ opacity: [0.55, 0.9, 0.55], scale: [0.98, 1.02, 0.98] }}
                transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute right-8 top-7 h-2 w-16 rounded-full bg-[linear-gradient(90deg,rgba(56,189,248,0.16),rgba(255,138,0,0.12))]"
              />

              <div className="absolute inset-x-6 top-7 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="rounded-full bg-accent/12 px-3 py-1 text-[11px] font-semibold text-accent">
                    生成中
                  </div>
                  <div className="h-px flex-1 bg-[linear-gradient(90deg,rgba(255,138,0,0.16),rgba(56,189,248,0.14),transparent)]" />
                </div>

                <div className="text-left">
                  <p className="text-[22px] font-semibold leading-[1.25] tracking-tight text-primary">
                    你的专属课程正在成形
                  </p>
                </div>
              </div>

              <div className="absolute inset-x-6 bottom-7 space-y-3">
                <motion.div
                  animate={{ x: ['0%', '8%', '0%'] }}
                  transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
                  className="h-2 rounded-full bg-[linear-gradient(90deg,rgba(255,138,0,0.88),rgba(255,188,92,0.75),rgba(56,189,248,0.58))]"
                />
                <div className="grid grid-cols-3 gap-2">
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                    className="rounded-2xl bg-white/82 px-3 py-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
                  >
                    <div className="mb-2 h-2 w-10 rounded-full bg-accent/18" />
                    <div className="h-2 w-full rounded-full bg-black/[0.06]" />
                    <div className="mt-2 h-2 w-2/3 rounded-full bg-black/[0.06]" />
                  </motion.div>
                  <motion.div
                    animate={{ y: [0, 5, 0] }}
                    transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.35 }}
                    className="rounded-2xl bg-white/78 px-3 py-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
                  >
                    <div className="mb-2 h-2 w-8 rounded-full bg-sky-300/28" />
                    <div className="h-2 w-full rounded-full bg-black/[0.06]" />
                    <div className="mt-2 h-2 w-1/2 rounded-full bg-black/[0.06]" />
                  </motion.div>
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
                    className="rounded-2xl bg-white/76 px-3 py-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
                  >
                    <div className="mb-2 h-2 w-7 rounded-full bg-amber-300/32" />
                    <div className="h-2 w-full rounded-full bg-black/[0.06]" />
                    <div className="mt-2 h-2 w-3/5 rounded-full bg-black/[0.06]" />
                  </motion.div>
                </div>
              </div>
            </motion.div>

            <motion.div
              animate={{ opacity: [0.2, 0.6, 0.2], scale: [0.98, 1.05, 0.98] }}
              transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute left-8 top-9 h-3 w-3 rounded-full bg-sky-300"
            />
            <motion.div
              animate={{ opacity: [0.25, 0.7, 0.25], scale: [1, 1.16, 1] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.35 }}
              className="absolute right-9 top-14 h-2.5 w-2.5 rounded-full bg-accent/90"
            />
            <motion.div
              animate={{ opacity: [0.18, 0.55, 0.18], y: [0, -8, 0] }}
              transition={{ duration: 4.1, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
              className="absolute bottom-10 left-10 h-2 w-2 rounded-full bg-sky-400"
            />
          </div>

          <h1 className="text-[32px] font-semibold tracking-tight text-primary sm:text-[38px]">
            {title}
          </h1>

          <div className="mt-4 min-h-[56px] px-3">
            <AnimatePresence mode="wait">
              <motion.p
                key={messageIndex}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                className="mx-auto max-w-xl text-[15px] leading-7 text-secondary"
              >
                {loadingMessages[messageIndex]}
              </motion.p>
            </AnimatePresence>
          </div>

          <div className="mt-7 flex items-center justify-center gap-2">
            <motion.div
              animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="h-2.5 w-2.5 rounded-full bg-accent"
            />
            <motion.div
              animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.16 }}
              className="h-2.5 w-2.5 rounded-full bg-accent/85"
            />
            <motion.div
              animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.32 }}
              className="h-2.5 w-2.5 rounded-full bg-sky-400/70"
            />
          </div>
        </motion.div>
        </div>
      </div>
    </main>
  );
}
