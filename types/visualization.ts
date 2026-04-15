// types/visualization.ts — 可视化相关类型

// 可视化类型
export type VisualizationType =
  // 图表类型（Mermaid）
  | 'flowchart' | 'sequence' | 'class' | 'state' | 'er' | 'gantt' | 'mindmap'
  // 辅助元素类型
  | 'comparison' | 'table' | 'timeline' | 'legend' | 'keyPoints';

// 时间线事件
export interface TimelineEvent {
  time: string;      // 时间点
  title: string;     // 事件标题
  description?: string;
}

// 可视化配置
export interface Visualization {
  type: VisualizationType;
  title?: string;                    // 标题，如"React vs Vue 对比"
  mermaidCode?: string;              // Mermaid 语法（图表类型）
  complex?: boolean;                 // 是否复杂（需放大按钮）
  // 辅助元素专用字段
  items?: string[];                 // 用于 legend、keyPoints
  rows?: string[][];                // 用于 table、comparison
  columns?: string[];               // 用于 table、comparison
  events?: TimelineEvent[];         // 用于 timeline
}
