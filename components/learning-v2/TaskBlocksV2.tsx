'use client';

// components/learning-v2/TaskBlocksV2.tsx
// V2 任务内容块渲染：4 种块类型（markdown / key_point / example / comparison）
// markdown 复用 V1 MarkdownContent；其余块类型按学习场景做轻量卡片化呈现

import type { LearningContentBlock } from '@/types/learning-v2';
import { MarkdownContent } from '../ui/MarkdownContent';

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
    default:
      return null;
  }
}

function KeyPointBlockView({ title, points }: { title?: string; points: string[] }) {
  return (
    <div className="rounded-2xl bg-accent/6 px-4 py-3.5">
      {title && <p className="mb-2 text-[14px] font-semibold text-primary">{title}</p>}
      <ul className="space-y-1.5">
        {points.map((point, i) => (
          <li key={i} className="flex gap-2 text-[14px] leading-relaxed text-primary/90">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 例子块：场景 + 正文 + 一句话收获 */
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
    <div className="overflow-hidden rounded-2xl border border-accent/15 bg-surface">
      <div className="border-b border-accent/10 bg-accent/6 px-4 py-2.5">
        <p className="text-[13px] font-semibold text-accent">💡 {title}</p>
        {context && <p className="mt-0.5 text-[12px] text-tertiary">{context}</p>}
      </div>
      <div className="px-4 py-3">
        <MarkdownContent content={content} />
      </div>
      {takeaway && (
        <p className="border-t border-accent/10 px-4 py-2.5 text-[13px] text-secondary">
          要点：{takeaway}
        </p>
      )}
    </div>
  );
}

function ComparisonBlockView({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-black/6">
      <table className="w-full min-w-[320px] border-collapse text-[13px]">
        <thead>
          <tr className="bg-subtle">
            {columns.map((column, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-primary">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-black/5">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top leading-relaxed text-secondary">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
