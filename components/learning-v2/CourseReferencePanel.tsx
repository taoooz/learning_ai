'use client';

import { useState } from 'react';
import type { CourseGlossaryTerm, CourseReference } from '@/types/learning-v2';
import { TaskBlockView } from './TaskBlocksV2';

export function CourseReferencePanel({
  references,
  glossary,
}: {
  references?: CourseReference[];
  glossary?: CourseGlossaryTerm[];
}) {
  const [openReferenceId, setOpenReferenceId] = useState<string | null>(null);
  const hasReferences = (references?.length ?? 0) > 0;
  const hasGlossary = (glossary?.length ?? 0) > 0;
  if (!hasReferences && !hasGlossary) return null;

  return (
    <section className="mt-5 rounded-3xl border border-black/[0.05] bg-surface/80 p-4 shadow-card backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        <h2 className="text-[15px] font-semibold text-primary">课程参考资料</h2>
      </div>

      <div className="space-y-2.5">
        {references?.map((reference) => {
          const open = openReferenceId === reference.referenceId;
          return (
            <article key={reference.referenceId} className="overflow-hidden rounded-2xl border border-black/[0.06] bg-surface">
              <button
                type="button"
                onClick={() => setOpenReferenceId(open ? null : reference.referenceId)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle/50"
                aria-expanded={open}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-primary">{reference.title}</span>
                <span className="text-[11px] text-tertiary">{open ? '收起' : '查看'}</span>
              </button>
              {open && (
                <div className="space-y-4 border-t border-black/[0.05] px-4 py-4">
                  {reference.blocks.map((block) => (
                    <TaskBlockView key={block.blockId} block={block} />
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {hasGlossary && (
        <div className="mt-4 rounded-2xl border border-black/[0.06] bg-subtle/40 p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">统一术语</p>
          <dl className="space-y-3">
            {glossary?.map((term) => (
              <div key={term.termId} className="space-y-1">
                <dt className="text-[13px] font-semibold text-primary">{term.preferredTerm}</dt>
                <dd className="text-[13px] leading-[1.68] text-secondary">{term.definition}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
