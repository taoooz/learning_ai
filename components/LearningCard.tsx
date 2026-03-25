'use client';

import ReactMarkdown from 'react-markdown';
import { LearningCard as LearningCardType } from '@/types/course';
import { MermaidChart } from './ui/MermaidChart';
import { ComparisonTable } from './ui/ComparisonTable';
import { Timeline } from './ui/Timeline';
import { Legend } from './ui/Legend';
import { KeyPointsList } from './ui/KeyPointsList';

interface LearningCardProps {
  card: LearningCardType;
}

// 图表类型（Mermaid）
const CHART_TYPES = ['flowchart', 'sequence', 'class', 'state', 'er', 'gantt', 'mindmap'] as const;

export function LearningCard({ card }: LearningCardProps) {
  const renderVisualization = () => {
    if (!card.visualization) return null;

    const { visualization } = card;

    // Mermaid 图表类型
    if (CHART_TYPES.includes(visualization.type as typeof CHART_TYPES[number])) {
      return (
        <MermaidChart
          mermaidCode={visualization.mermaidCode || ''}
          complex={visualization.complex}
        />
      );
    }

    // 对比表格
    if (visualization.type === 'comparison' || visualization.type === 'table') {
      return (
        <ComparisonTable
          title={visualization.title}
          columns={visualization.columns || []}
          rows={visualization.rows || []}
        />
      );
    }

    // 时间线
    if (visualization.type === 'timeline') {
      return (
        <Timeline
          title={visualization.title}
          events={visualization.events || []}
        />
      );
    }

    // 图例
    if (visualization.type === 'legend') {
      return (
        <Legend
          items={visualization.items || []}
        />
      );
    }

    // 关键点列表
    if (visualization.type === 'keyPoints') {
      return (
        <KeyPointsList
          items={visualization.items || []}
        />
      );
    }

    return null;
  };

  return (
    <div className="w-full h-full flex flex-col p-6 bg-surface rounded-2xl border border-subtle">
      <h2 className="text-xl font-bold text-primary mb-4">{card.title}</h2>
      <div className="flex-1 text-secondary text-sm leading-relaxed">
        <ReactMarkdown>{card.content}</ReactMarkdown>
      </div>
      {renderVisualization()}
      {card.imageUrl && (
        <div className="mt-4">
          <img src={card.imageUrl} alt="" className="rounded-lg max-h-40 object-cover" />
        </div>
      )}
    </div>
  );
}