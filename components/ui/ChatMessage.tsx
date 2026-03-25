// components/ui/ChatMessage.tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage as ChatMessageType } from '@/types/chat';
import { motion } from 'framer-motion';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl ${
          isUser
            ? 'bg-accent text-white rounded-br-md'
            : 'bg-surface border border-subtle text-primary rounded-bl-md'
        }`}
      >
        {isUser ? (
          <p className="text-sm">{message.content}</p>
        ) : (
          <div className="text-sm leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ children }) => (
                  <table className="w-full border-collapse my-2 text-xs">
                    {children}
                  </table>
                ),
                thead: ({ children }) => (
                  <thead className="bg-subtle/50">{children}</thead>
                ),
                th: ({ children }) => (
                  <th className="border border-subtle px-2 py-1 text-left font-medium">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="border border-subtle px-2 py-1">{children}</td>
                ),
                tr: ({ children }) => (
                  <tr className="even:bg-subtle/20">{children}</tr>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        <p
          className={`text-xs mt-1 ${
            isUser ? 'text-white/60' : 'text-secondary'
          }`}
        >
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </motion.div>
  );
}