// components/ui/chat/ChatThinkingIndicator.tsx

import { motion } from 'framer-motion';

export function ChatThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="rounded-[20px] rounded-bl-md border border-black/5 bg-white/78 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <motion.span className="h-2 w-2 rounded-full bg-[#7FBFC3]" animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.1, repeat: Infinity, delay: 0 }} />
          <motion.span className="h-2 w-2 rounded-full bg-[#7FBFC3]" animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.1, repeat: Infinity, delay: 0.16 }} />
          <motion.span className="h-2 w-2 rounded-full bg-[#7FBFC3]" animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.1, repeat: Infinity, delay: 0.32 }} />
        </div>
      </div>
    </div>
  );
}
