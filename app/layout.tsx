// app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { CombinedProvider } from '@/contexts';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Learning - Personalized Learning Path',
  description: '输入任何感兴趣的主题，AI 为你生成专属学习路径',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <CombinedProvider>
          {children}
        </CombinedProvider>
      </body>
    </html>
  );
}
