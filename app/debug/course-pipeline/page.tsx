import Link from 'next/link';
import { CoursePromptLab } from '@/components/prompt-lab/CoursePromptLab';
import { isPromptLabEnabled } from '@/lib/prompt-lab/config';

export const dynamic = 'force-dynamic';

export default function CoursePromptLabPage() {
  if (!isPromptLabEnabled()) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-lg rounded-2xl border border-black/[0.08] bg-white p-6 text-center shadow-card">
          <h1 className="text-[20px] font-bold text-primary">Prompt Lab 未开放</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-secondary">
            该工具默认只在本地开发环境开放。生产环境如需启用，请显式设置
            <code className="mx-1 rounded bg-subtle px-1.5 py-0.5 font-mono text-[12px]">ENABLE_PROMPT_DEBUGGER=1</code>。
          </p>
          <Link href="/" className="mt-5 inline-flex min-h-10 items-center rounded-full bg-primary px-5 text-[13px] font-semibold text-white">
            返回首页
          </Link>
        </div>
      </main>
    );
  }

  return <CoursePromptLab />;
}
