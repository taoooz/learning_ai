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
import { InteractiveBlockV2 } from './InteractiveBlockV2';
import { MarkdownContent } from '../ui/MarkdownContent';
import { StreamingMarkdown } from '../ui/StreamingMarkdown';

/** 块类型标签的通用样式：小 chip + 图标 */
function BlockLabel({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'neutral' | 'blue' }) {
  const toneStyles = {
    accent: 'bg-[rgba(255,138,0,0.10)] text-accent',
    neutral: 'bg-black/[0.04] text-secondary',
    blue: 'bg-[rgba(255,138,0,0.10)] text-accent',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${toneStyles[tone]}`}>
      <span className="h-1 w-1 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </span>
  );
}

export function TaskBlockView({ block, courseId, streaming = false }: { block: LearningContentBlock; courseId?: string; streaming?: boolean }) {
  switch (block.type) {
    case 'markdown':
      return streaming ? <StreamingMarkdown content={block.markdown} streaming={streaming} /> : <MarkdownContent content={block.markdown} />;
    case 'key_point':
      return <KeyPointBlockView title={block.title} points={block.points} />;
    case 'example':
      return <ExampleBlockView title={block.title} context={block.context} content={block.content} takeaway={block.takeaway} />;
    case 'comparison':
      return <ComparisonBlockView columns={block.columns} rows={block.rows} />;
    case 'diagram':
      return <DiagramBlockView source={block.source} />;
    case 'interactive':
      return <InteractiveBlockV2 block={block} courseId={courseId} />;
    default:
      return null;
  }
}

/** 关键点定义卡：左侧色条 + 标签 + 要点列表 */
function KeyPointBlockView({ title, points }: { title?: string; points: string[] }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[rgba(255,138,0,0.18)] bg-[rgba(255,138,0,0.045)] pl-4 pr-4 py-4 shadow-sm">
      <div className="absolute left-0 top-0 h-full w-1 rounded-l-2xl bg-[rgba(255,138,0,0.45)]" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <BlockLabel label={title || '关键点'} />
      </div>
      <ul className="space-y-3">
        {points.map((point, i) => (
          <li key={i} className="relative pl-4 text-[14px] leading-[1.72] text-primary/90">
            <span className="absolute left-0 top-[9px] h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            <div className="key-point-prose">
              <MarkdownContent content={point} />
            </div>
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
    <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-surface shadow-sm">
      <div className="border-b border-black/[0.045] bg-[rgba(0,0,0,0.02)] px-4 pt-3.5 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <BlockLabel label="示例" tone="blue" />
          <span className="text-[14px] font-semibold leading-snug text-primary">{title}</span>
        </div>
        {context && <p className="mt-1.5 text-[12px] leading-relaxed text-tertiary">{context}</p>}
      </div>
      <div className="px-4 py-3.5">
        <MarkdownContent content={content} />
      </div>
      {takeaway && (
        <p className="border-t border-black/[0.05] bg-subtle/40 px-4 py-3 text-[13px] leading-relaxed text-secondary">
          <span className="font-semibold text-accent">要点：</span>{takeaway}
        </p>
      )}
    </div>
  );
}

/** 对比表格：卡片包装 + 表头着色 + 行间隔 */
function ComparisonBlockView({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.045] bg-subtle px-4 py-3">
        <BlockLabel label="对比" />
        <span className="text-[11px] text-tertiary">左右滑动查看</span>
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
              <tr key={rowIndex} className={rowIndex % 2 === 1 ? 'bg-subtle/50' : ''}>
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
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          securityLevel: 'strict',
          themeVariables: {
            background: '#FFFFFF',
            fontFamily: "'Baloo 2', -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
            fontSize: '14px',
            primaryColor: '#FFF4E6',
            primaryTextColor: '#1F1F1F',
            primaryBorderColor: '#FFD8A8',
            lineColor: '#D9D9D9',
            secondaryColor: '#F5F5F5',
            tertiaryColor: '#F5F5F5',
            edgeLabelBackground: '#FFFFFF',
            clusterBkg: '#F7F7F5',
            clusterBorder: '#E5E5E0',
          },
          flowchart: { curve: 'basis', padding: 18, nodeSpacing: 44, rankSpacing: 52, useMaxWidth: true },
        });
        const { svg } = await mermaid.render(`diagram-${Date.now()}-${Math.random().toString(36).slice(2)}`, source);
        if (!cancelled && el) el.innerHTML = svg;
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-surface shadow-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.045] bg-subtle px-4 py-3">
        <BlockLabel label="流程图" />
        <span className="text-[11px] text-tertiary">示意图</span>
      </div>
      <div className="px-4 py-4">
        {error ? (
          <pre className="overflow-x-auto rounded-xl bg-subtle p-3 text-[12px] leading-relaxed text-secondary">
            <code>{source}</code>
          </pre>
        ) : (
          <div
            ref={containerRef}
            className="flex min-h-[180px] justify-center [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full [&_svg]:overflow-visible [&_.nodeLabel]:font-medium [&_.nodeLabel]:text-[#1F1F1F] [&_.edgeLabel]:bg-white [&_.flowchart-link]:stroke-[#D9D9D9]"
          />
        )}
      </div>
    </div>
  );
}
