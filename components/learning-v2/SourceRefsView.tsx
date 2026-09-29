'use client';

import type { SourceRef } from '@/types/learning-v2';
import {
  getDisplaySourceRefs,
  getSourceDisplayTitle,
  getSourceDomain,
  isSafeHttpUrl,
} from '@/lib/learning-v2/source-refs';

/** 来源引用卡片：任务内容与 Checkpoint 共用 */
export function SourceRefsView({
  sources,
  label = '参考来源',
}: {
  sources?: SourceRef[];
  label?: string;
}) {
  const refs = getDisplaySourceRefs(sources);
  if (refs.length === 0) return null;

  return (
    <section aria-label={label} className="rounded-2xl border border-black/[0.05] bg-subtle/60 px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[12px]">📚</span>
        <span className="text-[12px] font-semibold text-primary">{label}</span>
      </div>
      <ol className="space-y-1.5">
        {refs.map((source, index) => {
          const title = getSourceDisplayTitle(source);
          const domain = getSourceDomain(source.url);
          const safe = isSafeHttpUrl(source.url);
          return (
            <li key={`${source.url}-${index}`} className="flex min-w-0 items-baseline gap-2 text-[13px]">
              <span className="shrink-0 text-[12px] text-tertiary">{index + 1}</span>
              {safe ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex min-w-0 flex-1 items-baseline gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-black/[0.03]"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-primary transition-colors group-hover:text-accent">
                    {title}
                  </span>
                  {domain && <span className="shrink-0 text-[12px] text-tertiary">{domain}</span>}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-secondary">{title}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
