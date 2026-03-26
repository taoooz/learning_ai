// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { CombinedProvider } from '@/contexts';

export const metadata: Metadata = {
  title: 'AI Learning',
  description: '输入任何感兴趣的主题，AI 为你生成专属学习路径。',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <CombinedProvider>
          {children}
        </CombinedProvider>
      </body>
    </html>
  );
}
