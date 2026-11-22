'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        components={{
          table({ children }) {
            return (
              <div className="my-4 overflow-x-auto rounded-xl border border-black/[0.06]">
                <table className="w-full border-collapse text-sm">{children}</table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-black/[0.035]">{children}</thead>;
          },
          th({ children }) {
            return <th className="border-b border-black/[0.06] px-3 py-2 text-left font-semibold">{children}</th>;
          },
          td({ children }) {
            return <td className="border-b border-black/[0.04] px-3 py-2 align-top">{children}</td>;
          },
        code({ inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          return !inline && match ? (
            <SyntaxHighlighter
              style={oneLight}
              language={match[1]}
              PreTag="div"
              customStyle={{
                margin: '1rem 0',
                borderRadius: '12px',
                fontSize: '0.875rem',
                backgroundColor: 'var(--color-subtle)',
              }}
              {...props}
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
        {content}
      </ReactMarkdown>
    </div>
  );
}
