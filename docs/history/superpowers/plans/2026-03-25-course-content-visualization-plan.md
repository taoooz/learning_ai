# 课程内容可视化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在课程卡片中支持图表和辅助学习元素（对比表、时间线、图例、要点列表），AI 自动判断何时生成可视化内容。

**Architecture:** 在 `LearningCard` 中新增可视化渲染区域，根据 `visualization.type` 渲染对应组件。图表使用 Mermaid.js 渲染，辅助元素使用自定义组件。

**Tech Stack:** mermaid, React, Tailwind CSS

---

## 文件结构

```
新增文件:
- components/ui/MermaidChart.tsx    # Mermaid 图表组件
- components/ui/ComparisonTable.tsx  # 对比表组件
- components/ui/Timeline.tsx         # 时间线组件
- components/ui/Legend.tsx         # 图例组件
- components/ui/KeyPointsList.tsx    # 要点列表组件

修改文件:
- types/course.ts                    # 添加 Visualization 类型
- components/LearningCard.tsx        # 集成可视化渲染
- lib/prompt.ts                      # AI 可视化生成指导
```

---

## Task 1: 添加可视化类型定义

**Files:**
- Modify: `types/course.ts`

- [ ] **Step 1: 添加 Visualization 类型定义**

在文件顶部（LearningCard 接口之前）添加：

```typescript
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
```

- [ ] **Step 2: 修改 LearningCard 接口**

将现有的 LearningCard 接口改为：

```typescript
export interface LearningCard {
  id: string;
  title: string;
  content: string;              // Markdown 内容
  visualization?: Visualization; // 可视化配置
}
```

- [ ] **Step 3: Commit**

```bash
git add types/course.ts
git commit -m "feat(types): add Visualization type and TimelineEvent"
```

---

## Task 2: 创建 MermaidChart 组件

**Files:**
- Create: `components/ui/MermaidChart.tsx`

- [ ] **Step 1: 安装 mermaid 依赖**

Run: `npm install mermaid`
Expected: 包安装成功

- [ ] **Step 2: 创建 MermaidChart 组件**

```tsx
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
    } catch (err) {
      console.error('Mermaid render error:', err);
      setError('图表渲染失败');
    }
  };

  // 主图表渲染
  useEffect(() => {
    renderToContainer(containerRef.current, mermaidCode);
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
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/MermaidChart.tsx package.json package-lock.json
git commit -m "feat(ui): add MermaidChart component for diagram rendering"
```

---

## Task 3: 创建辅助学习元素组件

**Files:**
- Create: `components/ui/ComparisonTable.tsx`
- Create: `components/ui/Timeline.tsx`
- Create: `components/ui/Legend.tsx`
- Create: `components/ui/KeyPointsList.tsx`

- [ ] **Step 1: 创建 ComparisonTable 组件**

```tsx
'use client';

interface ComparisonTableProps {
  title?: string;
  columns: string[];      // ['特性', '方案A', '方案B']
  rows: string[][];       // [['性能', '快', '慢'], ['体积', '小', '大']]
}

export function ComparisonTable({ title, columns, rows }: ComparisonTableProps) {
  return (
    <div className="my-4 overflow-x-auto">
      {title && <h3 className="text-lg font-semibold text-primary mb-2">{title}</h3>}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface border-b border-subtle">
            {columns.map((col, i) => (
              <th key={i} className="px-4 py-2 text-left font-medium text-primary">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-subtle/50 hover:bg-surface/50">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-secondary">
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
```

- [ ] **Step 2: 创建 Timeline 组件**

```tsx
'use client';

import { TimelineEvent } from '@/types/course';

interface TimelineProps {
  title?: string;
  events: TimelineEvent[];
}

export function Timeline({ title, events }: TimelineProps) {
  return (
    <div className="my-4">
      {title && <h3 className="text-lg font-semibold text-primary mb-4">{title}</h3>}
      <div className="relative">
        {/* 时间线竖线 */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
        <div className="space-y-4">
          {events.map((event, i) => (
            <div key={i} className="relative pl-10">
              {/* 时间点圆点 */}
              <div className="absolute left-2.5 w-3 h-3 rounded-full bg-accent border-2 border-background" />
              <div>
                <span className="text-xs font-mono text-accent">{event.time}</span>
                <h4 className="font-medium text-primary">{event.title}</h4>
                {event.description && (
                  <p className="text-sm text-secondary mt-1">{event.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 Legend 组件**

```tsx
'use client';

interface LegendProps {
  items: string[];        // ['🔵 蓝色=同步', '🟢 绿色=异步']
}

export function Legend({ items }: LegendProps) {
  return (
    <div className="my-4 flex flex-wrap gap-2">
      {items.map((item, i) => (
        <span
          key={i}
          className="inline-flex items-center px-3 py-1.5 bg-surface rounded-full text-sm text-secondary border border-subtle"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 创建 KeyPointsList 组件**

```tsx
'use client';

interface KeyPointsListProps {
  items: string[];        // ['要点1', '要点2', '要点3']
}

export function KeyPointsList({ items }: KeyPointsListProps) {
  return (
    <div className="my-4 space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent text-sm flex items-center justify-center font-medium">
            {i + 1}
          </span>
          <span className="text-secondary">{item}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add components/ui/ComparisonTable.tsx components/ui/Timeline.tsx components/ui/Legend.tsx components/ui/KeyPointsList.tsx
git commit -m "feat(ui): add auxiliary learning components (ComparisonTable, Timeline, Legend, KeyPointsList)"
```

---

## Task 4: 更新 LearningCard 集成可视化渲染

**Files:**
- Modify: `components/LearningCard.tsx`

- [ ] **Step 1: 修改 LearningCard 组件**

```tsx
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

export function LearningCard({ card }: LearningCardProps) {
  const { visualization } = card;

  // 渲染可视化元素
  const renderVisualization = () => {
    if (!visualization) return null;

    const chartTypes = ['flowchart', 'sequence', 'class', 'state', 'er', 'gantt', 'mindmap'];

    if (chartTypes.includes(visualization.type)) {
      return (
        <MermaidChart
          mermaidCode={visualization.mermaidCode || ''}
          complex={visualization.complex}
          className="my-4"
        />
      );
    }

    switch (visualization.type) {
      case 'comparison':
        return (
          <ComparisonTable
            title={visualization.title}
            columns={visualization.columns || []}
            rows={visualization.rows || []}
          />
        );
      case 'table':
        return (
          <ComparisonTable
            title={visualization.title}
            columns={visualization.columns || []}
            rows={visualization.rows || []}
          />
        );
      case 'timeline':
        return (
          <Timeline
            title={visualization.title}
            events={visualization.events || []}
          />
        );
      case 'legend':
        return <Legend items={visualization.items || []} />;
      case 'keyPoints':
        return <KeyPointsList items={visualization.items || []} />;
      default:
        return null;
    }
  };

  return (
    <div className="w-full h-full flex flex-col p-6 bg-surface rounded-2xl border border-subtle">
      <h2 className="text-xl font-bold text-primary mb-4">{card.title}</h2>
      <div className="flex-1 text-secondary text-sm leading-relaxed">
        <ReactMarkdown>{card.content}</ReactMarkdown>
      </div>
      {renderVisualization()}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/LearningCard.tsx
git commit -m "feat(learning-card): integrate visualization components"
```

---

## Task 5: 更新 prompt 指导 AI 生成可视化

**Files:**
- Modify: `lib/prompt.ts`

- [ ] **Step 1: 在 buildNodeContentPrompt 中添加可视化决策指南**

找到 buildNodeContentPrompt 函数的 return 语句，在适当位置添加可视化指导：

在现有的输出格式说明之后添加：

```markdown
## 可视化决策指南

当内容适合可视化时，选择合适的呈现方式：

**图表类型（Mermaid）：
- 流程/步骤类 → `flowchart`
- 时间/顺序类 → `sequence` 或 `timeline`
- 两种方案对比 → `comparison`
- 概念关系/分类 → `mindmap` 或 `class`
- 状态变化 → `state`
- 项目规划/甘特 → `gantt`

**辅助元素（原生组件）：
- 需要快速参考的参数/特性 → `table`
- 强化记忆的核心要点 → `keyPoints`
- 解释符号/颜色/形状含义 → `legend`

**示例判断：**
| 内容场景 | 选择类型 |
|----------|----------|
| "HTTP 请求流程：请求→处理→响应" | `flowchart` |
| "React vs Vue 对比：优缺点" | `comparison` |
| "HTTP 状态码分类（2xx/4xx/5xx）" | `table` |
| "闭包的 3 个核心用途" | `keyPoints` |
| "Redis 发展历程：2019-2024" | `timeline` |
| "图中颜色说明：蓝色=同步，绿色=异步" | `legend` |

**避免过度可视化：**
- 少于 3 个节点的简单关系
- 内容已经很简单直观时
- 强行拆分会破坏理解时

**输出格式：**
{
  "cards": [...],
  "visualization": {
    "type": "flowchart|sequence|comparison|table|timeline|legend|keyPoints|...",
    "title": "可选标题",
    "mermaidCode": "Mermaid 语法（图表类型时）",
    "complex": true|false,
    "items": ["项1", "项2"],
    "rows": [["A", "B"], ["C", "D"]],
    "columns": ["列1", "列2"],
    "events": [{"time": "2020", "title": "事件"}]
  }
}
```

注意：visualization 字段是可选的，只有在内容确实需要可视化时才添加。

- [ ] **Step 2: Commit**

```bash
git add lib/prompt.ts
git commit -m "feat(prompt): add visualization decision guide for AI"
```

---

## Task 6: 更新 CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 添加可视化功能条目**

在 `## 2026-03-25` 下添加：

```markdown
### 课程内容可视化

- 新增图表组件 MermaidChart，支持 Mermaid 语法渲染
- 新增辅助学习组件：对比表、时间线、图例、要点列表
- LearningCard 支持渲染可视化内容
- AI 生成内容时可自动判断并添加图表或辅助元素
- 复杂图表支持全屏放大查看
- 移动端触摸交互支持
```

如果没有 `## 2026-03-25` 部分，创建它。

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): add course content visualization entry"
```

---

## 测试验证

- [ ] **Test 1: 无可视化时** → 正常显示文本内容
- [ ] **Test 2: 图表类型** → Mermaid 正确渲染
- [ ] **Test 3: 对比表** → 列和行正确显示
- [ ] **Test 4: 时间线** → 事件按时间顺序展示
- [ ] **Test 5: 图例** → 徽章样式正确
- [ ] **Test 6: 要点列表** → 编号和内容正确
- [ ] **Test 7: 复杂图表** → 显示放大按钮，点击全屏
- [ ] **Test 8: 全屏关闭** → 点击/滑动关闭正常
