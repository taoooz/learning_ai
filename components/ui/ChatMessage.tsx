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
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[90%] px-4 py-3 rounded-[20px] ${
          isUser
            ? 'rounded-br-md bg-[linear-gradient(135deg,#A3C0EA,#84C8C6)] text-primary shadow-[0_10px_22px_rgba(132,200,198,0.16)]'
            : 'rounded-bl-md border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(249,248,244,0.94))] text-primary shadow-[0_8px_20px_rgba(15,23,42,0.04)]'
        }`}
      >
        {isUser ? (
          <p className="text-sm leading-6">{message.content}</p>
        ) : (
          <>
            <div className="mb-2 inline-flex items-center rounded-full bg-[linear-gradient(135deg,rgba(152,184,232,0.12),rgba(127,191,195,0.12))] px-2.5 py-1 text-[11px] font-medium text-secondary/86">
              助理解答
            </div>
            <div className="prose prose-sm max-w-none text-[15px] leading-7 text-primary prose-p:my-0 prose-p:leading-7 prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold prose-headings:text-primary prose-strong:font-semibold prose-strong:text-primary prose-ul:my-3 prose-ul:pl-5 prose-ol:my-3 prose-ol:pl-5 prose-li:my-1 prose-li:text-primary prose-code:rounded prose-code:bg-black/[0.04] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.92em] prose-code:text-primary prose-pre:bg-[#F7F3EE] prose-pre:text-primary prose-blockquote:border-l-[3px] prose-blockquote:border-[#C6D8E4] prose-blockquote:bg-[#F4F8FB] prose-blockquote:px-3 prose-blockquote:py-2 prose-blockquote:text-primary prose-table:my-3 prose-thead:bg-black/[0.03] prose-th:border prose-th:border-black/6 prose-th:px-2 prose-th:py-2 prose-th:text-left prose-th:font-medium prose-th:text-primary prose-td:border prose-td:border-black/6 prose-td:px-2 prose-td:py-2 prose-td:text-primary">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ children }) => (
                    <div className="my-3 overflow-x-auto">
                      <table className="w-full min-w-[320px] border-collapse text-sm">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => <thead>{children}</thead>,
                  th: ({ children }) => <th>{children}</th>,
                  td: ({ children }) => <td>{children}</td>,
                  tr: ({ children }) => <tr className="even:bg-black/[0.02]">{children}</tr>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          </>
        )}
        <p
          className={`text-xs mt-1 ${
            isUser ? 'text-primary/52' : 'text-secondary/88'
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
