'use client';

// components/learning-v2/TaskBlocksV2.tsx
// V2 任务内容块渲染：5 种块类型（markdown / key_point / example / comparison / diagram）
// 视觉设计原则（对齐 app 现有 Duolingo 风格）：
// - 统一 rounded-2xl 圆角（与全局 border-radius 一致）
// - 每种块用左侧色条 + 图标 + 标签chip 标识类型（视觉差异化，不靠底色堆砌）
// - 块间留出 mb-5 呼吸间距（在 LearningStreamV2 中统一控制）
// - 底色克制：accent/4 只用于类型识别，不大面积铺色

import { useEffect, useRef, useState } from 'react';
import type { LearningContentBlock } from '@/types/learning-v2';
import { MarkdownContent } from '../ui/MarkdownContent';

/** 块类型标签的通用样式：小 chip + 图标 */
function BlockLabel({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
      <span aria-hidden>{icon}</span>
      {label}
    </span>
  );
}

export function TaskBlockView({ block }: { block: LearningContentBlock }) {
  switch (block.type) {
    case 'markdown':
      return <MarkdownContent content={block.markdown} />;
    case 'key_point':
      return <KeyPointBlockView title={block.title} points={block.points} />;
    case 'example':
      return <ExampleBlockView title={block.title} context={block.context} content={block.content} takeaway={block.takeaway} />;
    case 'comparison':
      return <ComparisonBlockView columns={block.columns} rows={block.rows} />;
    case 'diagram':
      return <DiagramBlockView source={block.source} />;
    default:
      return null;
  }
}

/** 关键点定义卡：左侧色条 + 标签 + 要点列表 */
function KeyPointBlockView({ title, points }: { title?: string; points: string[] }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-accent/4 pl-4 pr-4 py-3.5">
      {/* 左侧色条：accent 半透明竖条 */}
      <div className="absolute left-0 top-0 h-full w-1 rounded-l-2xl bg-accent/30" />
      <div className="mb-2.5 flex items-center gap-2">
        <BlockLabel icon="📌" label={title || '关键点'} />
      </div>
      <ul className="space-y-2">
        {points.map((point, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-primary/90">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/50" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 例子卡：轻量高亮，不做重头部；内嵌场景标签 */
export function ExampleBlockView({
  title,
  context,
  content,
  takeaway,
}: {
  title: string;
  context: string;
  content: string;
  takeaway: string;
}) {
  return (
    <div className="rounded-2xl border border-accent/12 bg-surface">
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-baseline gap-2">
          <BlockLabel icon="💡" label="示例" />
          <span className="text-[14px] font-semibold text-primary">{title}</span>
        </div>
        {context && <p className="mt-1 text-[12px] text-tertiary">{context}</p>}
      </div>
      <div className="px-4 py-2">
        <MarkdownContent content={content} />
      </div>
      {takeaway && (
        <p className="border-t border-black/4 px-4 py-2.5 text-[13px] leading-relaxed text-secondary">
          <span className="font-medium text-accent">要点：</span>{takeaway}
        </p>
      )}
    </div>
  );
}

/** 对比表格：卡片包装 + 表头着色 + 行间隔 */
function ComparisonBlockView({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/6">
      {/* 标签行 */}
      <div className="bg-accent/4 px-4 py-2">
        <BlockLabel icon="📊" label="对比" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-subtle">
              {columns.map((column, i) => (
                <th key={i} className="px-3.5 py-2.5 text-left font-semibold text-primary">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex % 2 === 1 ? 'bg-accent/[0.03]' : ''}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={`px-3.5 py-2.5 align-top leading-relaxed ${cellIndex === 0 ? 'font-medium text-primary' : 'text-secondary'}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 流程图卡片：Mermaid 渲染 + 标签；失败降级为代码块 */
function DiagramBlockView({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
        const { svg } = await mermaid.render(`diagram-${Date.now()}-${Math.random().toString(36).slice(2)}`, source);
        if (!cancelled && el) el.innerHTML = svg;
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  return (
    <div className="rounded-2xl border border-black/6 bg-surface overflow-hidden">
      <div className="bg-accent/4 px-4 py-2">
        <BlockLabel icon="🗺️" label="流程图" />
      </div>
      <div className="px-4 py-4">
        {error ? (
          <pre className="overflow-x-auto text-[12px] leading-relaxed text-secondary">
            <code>{source}</code>
          </pre>
        ) : (
          <div ref={containerRef} className="flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" />
        )}
      </div>
    </div>
  );
}
