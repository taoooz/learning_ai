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

  // Debug: log visualization data
  useEffect(() => {
    console.log('[CardVisualization] Received visualization:', JSON.stringify(visualization, null, 2));
  }, [visualization]);

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
      <div className="mt-4">
        {visualization.title && (
          <p className="text-sm font-medium text-secondary mb-2">{visualization.title}</p>
        )}
        <div className="relative rounded-xl border border-black/6 bg-white p-4 overflow-auto">
          <div
            ref={mermaidRef}
            className={`flex justify-center ${isRendered ? '' : 'animate-pulse min-h-[100px]'}`}
          />
          {visualization.complex && (
            <button
              onClick={() => setIsFullscreen(true)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-subtle flex items-center justify-center text-secondary hover:bg-subtle/80 transition-colors"
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
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
            onClick={() => setIsFullscreen(false)}
          >
            <div
              className="bg-white rounded-2xl p-6 max-w-4xl w-full max-h-full overflow-auto"
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
      <div className="mt-4">
        {visualization.title && (
          <p className="text-sm font-medium text-secondary mb-3">{visualization.title}</p>
        )}
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gradient-to-b from-accent to-accent/30" />
          <div className="space-y-4">
            {visualization.events.map((event, index) => (
              <div key={index} className="flex items-start gap-4 pl-10 relative">
                <div className="absolute left-2.5 w-3 h-3 rounded-full bg-accent border-2 border-white shadow-sm" />
                <div className="flex-1 bg-subtle/50 rounded-xl p-3">
                  <p className="text-xs font-medium text-accent mb-1">{event.time}</p>
                  <p className="text-sm font-medium text-primary">{event.title}</p>
                  {event.description && (
                    <p className="text-xs text-secondary mt-1">{event.description}</p>
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
      <div className="mt-4">
        {visualization.title && (
          <p className="text-sm font-medium text-secondary mb-3">{visualization.title}</p>
        )}
        <div className="overflow-x-auto rounded-xl border border-black/6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-subtle">
                {visualization.columns.map((col, index) => (
                  <th key={index} className="px-4 py-3 text-left font-semibold text-primary border-b border-black/6">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visualization.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex % 2 === 1 ? 'bg-subtle/30' : ''}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-3 text-primary border-b border-black/3">
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

  // keyPoints 类型：支持两种格式
  // 1. AI 返回 { type: "keyPoints", data: { title: "...", points: [...] } }
  // 2. 标准格式 { type: "keyPoints", title: "...", items: [...] }
  if (visualization.type === 'keyPoints') {
    const points = (visualization as any).data?.points || visualization.items;
    const title = (visualization as any).data?.title || visualization.title;
    if (points && points.length > 0) {
      return (
        <div className="mt-4">
          {title && (
            <p className="text-sm font-medium text-secondary mb-3">{title}</p>
          )}
          <div className="space-y-2">
            {points.map((item: string, index: number) => (
              <div key={index} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-medium mt-0.5">
                  {index + 1}
                </span>
                <span className="text-sm text-primary">{item}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
  }

  if (visualization.type === 'legend' && visualization.items) {
    return (
      <div className="mt-4">
        {visualization.title && (
          <p className="text-sm font-medium text-secondary mb-3">{visualization.title}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {visualization.items.map((item, index) => (
            <span key={index} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-subtle text-sm text-primary">
              <span className="w-2 h-2 rounded-full bg-accent" />
              {item}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // table 类型（与 comparison 类似但格式略有不同）
  if (visualization.type === 'table' && visualization.columns && visualization.rows) {
    return (
      <div className="mt-4">
        {visualization.title && (
          <p className="text-sm font-medium text-secondary mb-3">{visualization.title}</p>
        )}
        <div className="overflow-x-auto rounded-xl border border-black/6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-subtle">
                {visualization.columns.map((col, index) => (
                  <th key={index} className="px-4 py-3 text-left font-semibold text-primary border-b border-black/6">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visualization.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex % 2 === 1 ? 'bg-subtle/30' : ''}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-3 text-primary border-b border-black/3">
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

  // 不支持的类型，显示调试信息
  console.warn('[CardVisualization] Unsupported visualization type:', visualization.type);
  return (
    <div className="mt-4 p-4 bg-warning/10 rounded-xl border border-warning/20">
      <p className="text-sm text-warning">暂不支持的可视化类型: {visualization.type}</p>
    </div>
  );
}
