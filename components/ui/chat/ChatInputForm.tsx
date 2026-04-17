// components/ui/chat/ChatInputForm.tsx

import { motion } from 'framer-motion';
import { useRef } from 'react';

interface ChatInputFormProps {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export function ChatInputForm({ input, setInput, isLoading, onSubmit }: ChatInputFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form data-chat-form onSubmit={onSubmit} className="border-t border-black/6 bg-white/62 px-4 pb-4 pt-3 sm:px-5">
      <div className="flex gap-2 rounded-[22px] border border-black/6 bg-white/88 p-2 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="哪里卡住了，直接问我"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-primary placeholder:text-secondary/70 focus:outline-none"
          disabled={isLoading}
        />
        <motion.button
          type="submit"
          whileHover={isLoading || !input.trim() ? undefined : { y: -1 }}
          whileTap={isLoading || !input.trim() ? undefined : { y: 1, scale: 0.98 }}
          disabled={isLoading || !input.trim()}
          className="inline-flex min-w-[76px] items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#98B8E8,#7FBFC3)] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(127,191,195,0.20)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isLoading ? '思考中' : '发送'}
        </motion.button>
      </div>
    </form>
  );
}
