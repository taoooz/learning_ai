'use client';

import * as React from 'react';

// FlowDiagramView — flow-diagram 组件渲染器（结构总览流程图）
// 设计：纵向节点卡 + CSS 箭头；回边渲染为目标节点下方的虚线循环徽记
// 约束：正向链由服务端校验保证；本组件不做图布局计算

import type { InteractiveBlock } from '@/types/learning-v2/learning-stream';

export function FlowDiagramView({ block }: { block: InteractiveBlock }) {
  const nodes = block.nodes ?? [];
  const loopBacks = block.loopBacks ?? [];

  return (
    <div>
      {block.intro ? <p className="mb-3 text-[14px] leading-relaxed text-secondary">{block.intro}</p> : null}

      <ol className="space-y-0">
        {nodes.map((node, index) => {
          const loopIn = loopBacks.filter((loop) => loop.to === node.id);
          const arrowLabel = loopBacks.find((loop) => loop.from === node.id);
          return (
            <li key={node.id}>
              {loopIn.map((loop) => {
                const source = nodes.find((item) => item.id === loop.from);
                return (
                  <div
                    key={`loop-${loop.from}`}
                    className="mb-2 ml-2 rounded-lg border border-dashed border-border-strong bg-subtle px-2.5 py-1.5 text-[12px] text-tertiary"
                  >
                    <span aria-hidden="true">↺ </span>
                    来自「{source?.text ?? loop.from}」
                    {loop.label ? <span className="text-secondary"> · {loop.label}</span> : null}
                  </div>
                );
              })}
              <div className="rounded-xl border border-border bg-subtle px-3.5 py-2.5">
                <span className="mr-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold tabular-nums text-white align-middle">
                  {index + 1}
                </span>
                <span className="text-[15px] leading-relaxed text-primary">{node.text}</span>
              </div>
              {index < nodes.length - 1 && (
                <div className="flex justify-center py-1" aria-hidden="true">
                  <svg className="h-4 w-4 text-border-strong" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
              )}
              {arrowLabel?.label ? (
                <p className="mt-1 text-right text-[11px] text-tertiary" aria-hidden="true">
                  ↺ {arrowLabel.label}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
