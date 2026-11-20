'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemoryStoreV4, ReviewQueueItemV4 } from '@/types/course';

export function ReviewQueueCard() {
  const router = useRouter();
  const [queue, setQueue] = useState<ReviewQueueItemV4[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/user/memory', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json() as { store?: MemoryStoreV4 };
        const items = data.store?.projections?.reviewQueue ?? [];
        if (!cancelled) setQueue(items.slice(0, 4));
      } catch {
        // 复习入口失败时静默隐藏，不影响首页主流程
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (queue.length === 0) return null;

  const preview = queue.slice(0, 3).map((item) => item.conceptName).join('、');
  const topic = `复习：${queue.map((item) => item.conceptName).slice(0, 4).join('、')}`;

  return (
    <section aria-labelledby="review-queue-title" className="rounded-lg border border-black/6 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(255,248,242,0.92))] px-5 py-5 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-secondary/78">复习提醒</p>
          <h2 id="review-queue-title" className="mt-2 text-[20px] font-semibold text-primary">
            {queue.length} 个概念值得再确认
          </h2>
          <p className="mt-2 text-sm leading-6 text-secondary">{preview}</p>
        </div>
        <span className="flex h-12 min-w-12 items-center justify-center rounded-full bg-warning/10 text-lg font-semibold text-warning">
          {queue.length}
        </span>
      </div>
      <button
        type="button"
        onClick={() => router.push(`/generate/chat?topic=${encodeURIComponent(topic)}`)}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-cta px-5 text-sm font-semibold text-white transition-transform active:scale-[0.985]"
      >
        生成短复习课
      </button>
    </section>
  );
}
