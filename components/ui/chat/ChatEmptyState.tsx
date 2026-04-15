// components/ui/chat/ChatEmptyState.tsx

import { motion } from 'framer-motion';
import { AssistantGlyph } from './AssistantGlyph';

export function ChatEmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className="mb-4 rounded-[24px] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.90),rgba(246,250,249,0.92))] px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(221,232,246,0.72))]">
          <AssistantGlyph className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-primary">我会结合这节内容，帮你一起拆开难点。</p>
          <p className="mt-1 text-sm leading-6 text-secondary">
            你可以直接问我这一步的重点、哪里容易混淆，或者让我换一种更容易理解的讲法。
          </p>
        </div>
      </div>
    </motion.div>
  );
}
