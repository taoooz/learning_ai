'use client';

import { useEffect, useRef, useState } from 'react';
import { Visualization } from '@/types/course';

interface CardVisualizationProps {
  visualization: Visualization;
}

export function CardVisualization({ visualization }: CardVisualizationProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const mermaidRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 处理所有 Mermaid 图表类型
    const mermaidTypes = ['flowchart', 'sequence', 'class', 'state', 'er', 'gantt', 'mindmap'];
    if (mermaidTypes.includes(visualization.type) && visualization.mermaidCode && mermaidRef.current) {
      const renderMermaid = async () => {
        try {
          const mermaid = (await import('mermaid')).default;
          mermaid.initialize({
            startOnLoad: false,
            theme: 'neutral',
            fontFamily: 'inherit',
          });
          const id = `mermaid-${Date.now()}`;
          const { svg } = await mermaid.render(id, visualization.mermaidCode || '');
          if (mermaidRef.current) {
            mermaidRef.current.innerHTML = svg;
            setIsRendered(true);
          }
        } catch (error) {
          console.error('Mermaid render error:', error);
        }
      };
      renderMermaid();
    }
  }, [visualization.type, visualization.mermaidCode]);

  // 检查是否是需要渲染 Mermaid 的类型
  const mermaidTypes = ['flowchart', 'sequence', 'class', 'state', 'er', 'gantt', 'mindmap'];
  const isMermaidType = mermaidTypes.includes(visualization.type);

  if (isMermaidType) {
    return (
      <div className="mt-4 -mx-5 sm:mx-0">
        {visualization.title && (
          <p className="text-sm font-medium text-secondary mb-3 px-5 sm:px-0">{visualization.title}</p>
        )}
        <div className="relative rounded-2xl border border-black/[0.06] bg-white shadow-sm overflow-hidden">
          <div
            ref={mermaidRef}
            className={`p-4 overflow-x-auto ${isRendered ? '' : 'animate-pulse min-h-[120px]'}`}
            style={{ maxHeight: '320px', overflowY: 'auto' }}
          />
          {visualization.complex && (
            <button
              onClick={() => setIsFullscreen(true)}
              className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm shadow-md flex items-center justify-center text-secondary hover:text-primary hover:scale-105 transition-all duration-150"
              aria-label="放大查看"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          )}
        </div>

        {isFullscreen && (
          <div
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setIsFullscreen(false)}
          >
            <div
              className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center" dangerouslySetInnerHTML={{ __html: mermaidRef.current?.innerHTML || '' }} />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (visualization.type === 'timeline' && visualization.events) {
    return (
      <div className="mt-4 -mx-5 sm:mx-0 px-5 sm:px-0">
        {visualization.title && (
          <p className="text-sm font-medium text-secondary mb-4">{visualization.title}</p>
        )}
        <div className="relative">
          <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-gradient-to-b from-accent via-accent/60 to-accent/20 rounded-full" />
          <div className="space-y-4">
            {visualization.events.map((event, index) => (
              <div key={index} className="relative pl-12">
                <div className="absolute left-2.5 top-1.5 w-4 h-4 rounded-full bg-accent border-4 border-background shadow-md" />
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-black/[0.06] shadow-sm">
                  <p className="text-xs font-semibold text-accent mb-1.5 uppercase tracking-wide">{event.time}</p>
                  <p className="text-[15px] font-medium text-primary leading-snug">{event.title}</p>
                  {event.description && (
                    <p className="text-sm text-secondary mt-1.5 leading-relaxed">{event.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (visualization.type === 'comparison' && visualization.columns && visualization.rows) {
    return (
      <div className="mt-4 -mx-5 sm:mx-0 px-5 sm:px-0">
        {visualization.title && (
          <p className="text-sm font-medium text-secondary mb-3">{visualization.title}</p>
        )}
        <div className="rounded-2xl border border-black/[0.06] bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[200%]">
              <thead>
                <tr className="bg-gradient-to-r from-accent/8 to-transparent">
                  {visualization.columns.map((col, index) => (
                    <th key={index} className="px-5 py-3.5 text-left font-semibold text-primary whitespace-nowrap border-b border-black/[0.06]">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visualization.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex % 2 === 0 ? '' : 'bg-black/[0.02]'}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-5 py-3.5 text-primary whitespace-nowrap border-b border-black/[0.04] last:border-b-0">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2 bg-accent/5 text-xs text-accent flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            左右滑动查看更多
          </div>
        </div>
      </div>
    );
  }

  // keyPoints 类型：支持多种格式
  if (visualization.type === 'keyPoints') {
    const points = (visualization as any).data?.points || visualization.items;
    const title = (visualization as any).data?.title || visualization.title;
    if (points && points.length > 0) {
      return (
        <div className="mt-4 -mx-5 sm:mx-0 px-5 sm:px-0">
          {title && (
            <p className="text-sm font-medium text-secondary mb-3">{title}</p>
          )}
          <div className="grid gap-3">
            {points.map((item: string | { title?: string; description?: string }, index: number) => {
              const text = typeof item === 'string' ? item : item.title || item.description || '';
              const subtext = typeof item === 'object' ? item.description : undefined;
              return (
                <div
                  key={index}
                  className="flex items-start gap-4 bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-black/[0.06] shadow-sm"
                >
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-accent">{index + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-medium text-primary leading-snug">{text}</p>
                    {subtext && (
                      <p className="text-sm text-secondary mt-1 leading-relaxed">{subtext}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
  }

  if (visualization.type === 'legend' && visualization.items) {
    return (
      <div className="mt-4 -mx-5 sm:mx-0 px-5 sm:px-0">
        {visualization.title && (
          <p className="text-sm font-medium text-secondary mb-3">{visualization.title}</p>
        )}
        <div className="flex flex-wrap gap-2.5">
          {visualization.items.map((item, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-white/80 backdrop-blur-sm border border-black/[0.06] shadow-sm text-sm text-primary"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-accent to-accent/60 shadow-sm" />
              {item}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // table 类型
  if (visualization.type === 'table' && visualization.columns && visualization.rows) {
    return (
      <div className="mt-4 -mx-5 sm:mx-0 px-5 sm:px-0">
        {visualization.title && (
          <p className="text-sm font-medium text-secondary mb-3">{visualization.title}</p>
        )}
        <div className="rounded-2xl border border-black/[0.06] bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[150%]">
              <thead>
                <tr className="bg-subtle/80">
                  {visualization.columns.map((col, index) => (
                    <th key={index} className="px-4 py-3 text-left font-semibold text-primary whitespace-nowrap border-b border-black/[0.06]">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visualization.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex % 2 === 0 ? '' : 'bg-black/[0.02]'}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-4 py-3 text-primary whitespace-nowrap border-b border-black/[0.04] last:border-b-0">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // 不支持的类型，显示调试信息
  return (
    <div className="mt-4 p-4 bg-warning/10 rounded-xl border border-warning/20">
      <p className="text-sm text-warning">暂不支持的可视化类型: {visualization.type}</p>
    </div>
  );
}