'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidChartProps {
  mermaidCode: string;
  complex?: boolean;
  className?: string;
}

// 初始化 mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

export function MermaidChart({ mermaidCode, complex, className = '' }: MermaidChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 渲染图表到指定容器
  const renderToContainer = async (container: HTMLDivElement | null, code: string) => {
    if (!container) return;
    try {
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const { svg } = await mermaid.render(id, code);
      container.innerHTML = svg;
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error('Mermaid render error:', err);
        setError('图表渲染失败');
      }
    }
  };

  // 主图表渲染
  useEffect(() => {
    renderToContainer(containerRef.current, mermaidCode);
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [mermaidCode]);

  // 全屏图表渲染
  useEffect(() => {
    if (isFullscreen) {
      renderToContainer(fullscreenRef.current, mermaidCode);
    }
  }, [isFullscreen, mermaidCode]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="mermaid-container overflow-x-auto"
      />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {complex && !isFullscreen && (
        <button
          onClick={() => setIsFullscreen(true)}
          className="absolute top-2 right-2 p-2 bg-surface/80 rounded-lg hover:bg-surface"
          aria-label="放大查看"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
          </svg>
        </button>
      )}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-background/95 flex items-center justify-center p-4"
          onClick={() => setIsFullscreen(false)}
        >
          <div
            className="max-w-full max-h-full overflow-auto bg-surface rounded-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div ref={fullscreenRef} />
          </div>
        </div>
      )}
    </div>
  );
}