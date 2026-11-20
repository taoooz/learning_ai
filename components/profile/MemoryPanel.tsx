'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  MemoryDimensionViewV4,
  MemoryRecordV4,
  MemoryStoreV4,
} from '@/types/course';

const KIND_LABELS: Record<MemoryRecordV4['kind'], string> = {
  fact: '背景事实',
  goal: '学习目标',
  constraint: '学习约束',
  preference: '学习偏好',
  episode: '课程经验',
  teaching_strategy: '教学策略',
};

const SOURCE_LABELS: Partial<Record<MemoryRecordV4['sourceType'], string>> = {
  explicit_user_statement: '你的明确表达',
  learning_evidence: '学习证据',
  repeated_behavior: '重复行为',
  user_profile_input: '你填写的画像',
  user_profile_inference: '系统推断',
  system_rule: '系统生成',
};

function formatDate(timestamp: number): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function MemoryRecordCard({
  record,
  editing,
  draft,
  busy,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  record: MemoryRecordV4;
  editing: boolean;
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const inferred = record.sourceType === 'user_profile_inference';
  const sourceRefCount = record.sourceRefs.length;
  const hasRepeatedBehavior = record.tags.includes('repeated_behavior');
  const provenanceNote = [
    inferred ? '这是系统根据画像整理的内容，你可以直接修正原始事实。' : '',
    hasRepeatedBehavior ? '包含重复行为证据' : '',
    sourceRefCount > 1 ? `共 ${sourceRefCount} 个来源片段` : '',
  ].filter(Boolean).join('；');

  return (
    <article className="rounded-lg border border-black/6 bg-white/88 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-tag px-3 py-1 text-xs font-medium text-secondary">
          {KIND_LABELS[record.kind]}
        </span>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${inferred ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
          {SOURCE_LABELS[record.sourceType] ?? '其他来源'}
        </span>
        <span className="ml-auto text-xs text-tertiary">{formatDate(record.updatedAt)}</span>
      </div>

      <h4 className="mt-3 text-[15px] font-semibold text-primary">{record.title}</h4>

      {editing ? (
        <div className="mt-3">
          <label htmlFor={`memory-edit-${record.memoryId}`} className="mb-2 block text-sm font-medium text-primary">
            修改原始事实
          </label>
          <textarea
            id={`memory-edit-${record.memoryId}`}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={4}
            className="w-full resize-none rounded-md border border-black/8 bg-white px-4 py-3 text-[15px] leading-7 text-primary outline-none focus:border-accent/25"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={onSave}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-cta px-5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? '保存中…' : '保存修改'}
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-black/8 px-5 text-sm font-medium text-secondary"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-secondary">{record.content}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs leading-5 text-tertiary">
              {inferred
                ? provenanceNote
                : `来源：${SOURCE_LABELS[record.sourceType] ?? '学习系统'}${provenanceNote ? `；${provenanceNote}` : ''}`}
            </p>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={onStartEdit}
                className="inline-flex min-h-11 items-center justify-center rounded-full px-3 text-sm font-medium text-secondary transition-colors hover:bg-black/[0.04] hover:text-primary"
              >
                编辑
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="inline-flex min-h-11 items-center justify-center rounded-full px-3 text-sm font-medium text-secondary transition-colors hover:bg-error/[0.05] hover:text-error disabled:opacity-50"
              >
                删除
              </button>
            </div>
          </div>
        </>
      )}
    </article>
  );
}

export function MemoryPanel() {
  const router = useRouter();
  const [store, setStore] = useState<MemoryStoreV4 | null>(null);
  const [dimensions, setDimensions] = useState<MemoryDimensionViewV4[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDimensionId, setExpandedDimensionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadMemory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/user/memory', { cache: 'no-store' });
      if (!response.ok) throw new Error('记忆加载失败');
      const data = await response.json() as {
        ok?: boolean;
        store?: MemoryStoreV4;
        dimensions?: MemoryDimensionViewV4[];
      };
      if (!data.store || !Array.isArray(data.dimensions)) throw new Error('记忆数据为空');
      setStore(data.store);
      setDimensions(data.dimensions);
    } catch {
      setError('暂时无法读取学习记忆，请稍后重试。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  const records = (store?.records ?? []).filter((record) => record.status === 'active');
  const recordById = new Map(records.map((record) => [record.memoryId, record]));
  const activeDimensions = dimensions.filter((dimension) => dimension.sourceCount > 0);
  const summary = store?.learningSummary;

  const startEdit = (record: MemoryRecordV4) => {
    setEditingId(record.memoryId);
    setDraft(record.content);
  };

  const saveEdit = async (memoryId: string) => {
    const content = draft.trim();
    if (!content) return;
    setBusyId(memoryId);
    try {
      const response = await fetch(`/api/user/memory/records/${encodeURIComponent(memoryId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { content } }),
      });
      if (!response.ok) throw new Error('update failed');
      setEditingId(null);
      setDraft('');
      await loadMemory();
    } catch {
      setError('记忆更新失败，请重试。');
    } finally {
      setBusyId(null);
    }
  };

  const removeRecord = async (record: MemoryRecordV4) => {
    if (!window.confirm(`确定删除「${record.title}」吗？删除后后续课程不会再使用这条记忆。`)) return;
    setBusyId(record.memoryId);
    try {
      const response = await fetch(`/api/user/memory/records/${encodeURIComponent(record.memoryId)}?reason=user_forget`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('delete failed');
      await loadMemory();
    } catch {
      setError('记忆删除失败，请重试。');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="memory-panel-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-secondary/78">记忆</p>
          <h2 id="memory-panel-title" className="mt-2 text-[22px] font-semibold tracking-tight text-primary">
            系统记住了什么
          </h2>
          <p className="mt-2 text-sm leading-6 text-secondary">
            按固定维度汇总长期记忆；展开后可以查看、修正或删除对应的原始事实。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMemory()}
          disabled={isLoading}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-black/6 bg-white/80 px-4 text-sm font-medium text-secondary transition-colors hover:text-primary disabled:opacity-50"
        >
          刷新
        </button>
      </div>

      {isLoading && !store ? (
        <div className="mt-5 rounded-lg border border-black/6 bg-white/72 px-5 py-6 text-sm text-secondary" role="status">
          正在读取学习记忆…
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-lg border border-error/20 bg-error/[0.04] px-5 py-4 text-sm text-error" role="alert">
          {error}
          <button type="button" onClick={() => void loadMemory()} className="ml-2 min-h-11 font-medium underline underline-offset-4">
            重试
          </button>
        </div>
      ) : null}

      {!isLoading && records.length === 0 ? (
        <div className="mt-5 rounded-lg border border-black/6 bg-white/78 px-5 py-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-tag text-secondary" aria-hidden="true">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 4.5h9.5A3.5 3.5 0 0 1 19 8v11.5H7a2 2 0 0 1-2-2V5.5A1 1 0 0 1 6 4.5Z" />
              <path d="M7 16.5h12M8.5 8h6M8.5 11.5h4" />
            </svg>
          </div>
          <p className="mt-4 text-base font-semibold text-primary">还没有可管理的长期记忆</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">
            完善画像或完成章节检查后，学习方向、背景、偏好、教学策略和学习轨迹会逐步形成。
          </p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-cta px-5 text-sm font-semibold text-white transition-transform active:scale-[0.985]"
          >
            去学习
          </button>
        </div>
      ) : null}

      {summary ? (
        <div className="mt-5 rounded-lg border border-sky-200/60 bg-[linear-gradient(135deg,rgba(240,249,255,0.92),rgba(255,255,255,0.92))] px-5 py-5">
          <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-secondary/78">学习旅程</p>
          <h3 className="mt-2 text-lg font-semibold text-primary">{summary.currentFocus}</h3>
          <p className="mt-2 text-sm leading-6 text-secondary">{summary.journey}</p>
          {summary.learnerInsights.length > 0 ? (
            <p className="mt-3 text-xs leading-5 text-tertiary">学习者特点：{summary.learnerInsights.join('、')}</p>
          ) : null}
          {summary.areasToWatch.length > 0 ? (
            <p className="mt-1 text-xs leading-5 text-tertiary">需关注：{summary.areasToWatch.join('、')}</p>
          ) : null}
        </div>
      ) : null}

      {activeDimensions.length > 0 ? (
        <div className="mt-5 space-y-3">
          {activeDimensions.map((dimension) => {
            const expanded = expandedDimensionId === dimension.id;
            const dimensionRecords = dimension.recordIds
              .map((id) => recordById.get(id))
              .filter((record): record is MemoryRecordV4 => Boolean(record));

            return (
              <section key={dimension.id} data-memory-dimension={dimension.id} className="rounded-lg border border-black/6 bg-white/84 px-5 py-4 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                      {dimension.title}
                    </p>
                    <h3 className="mt-1.5 text-base font-semibold text-primary">{dimension.summary}</h3>
                  </div>
                  <span className="shrink-0 rounded-full bg-tag px-2.5 py-1 text-xs text-secondary">
                    {dimension.sourceCount} 条事实
                  </span>
                </div>

                {dimension.highlights.length > 0 ? (
                  <ul className="mt-3 space-y-1.5">
                    {dimension.highlights.slice(0, expanded ? undefined : 2).map((highlight, index) => (
                      <li key={`${dimension.id}-${index}`} className="flex gap-2 text-sm leading-6 text-secondary">
                        <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" aria-hidden />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {dimension.sourceCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpandedDimensionId(expanded ? null : dimension.id)}
                    className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-secondary transition-colors hover:text-primary"
                  >
                    {expanded ? '收起原始事实' : `查看 ${dimension.sourceCount} 条原始事实`}
                    <span aria-hidden>{expanded ? '↑' : '↓'}</span>
                  </button>
                ) : null}

                {expanded ? (
                  <div className="mt-3 space-y-2 border-t border-black/6 pt-3">
                    {dimensionRecords.map((record) => (
                      <MemoryRecordCard
                        key={record.memoryId}
                        record={record}
                        editing={editingId === record.memoryId}
                        draft={draft}
                        busy={busyId === record.memoryId}
                        onDraftChange={setDraft}
                        onStartEdit={() => startEdit(record)}
                        onCancelEdit={() => {
                          setEditingId(null);
                          setDraft('');
                        }}
                        onSave={() => void saveEdit(record.memoryId)}
                        onDelete={() => void removeRecord(record)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
