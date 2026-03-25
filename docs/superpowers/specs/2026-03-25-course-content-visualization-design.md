# 课程内容可视化设计

## 背景

当前课程卡片仅支持纯 Markdown 文本，对于流程图、对比图、架构图等内容，用户理解成本较高。需要通过代码渲染图表增强可视化体验。

## 目标

在课程卡片中支持图表展示，AI 自动判断何时生成图表，渲染成可交互的可视化内容。

## 设计原则

1. **移动端优先** - 交互适配触摸操作
2. **渐进增强** - 简单图表直接显示，复杂图表按需放大
3. **代码驱动** - 使用 Mermaid 语法，无需图片

---

## 方案设计

### 1. 可视化元素类型

#### 1.1 图表类型（Mermaid 渲染）

| 类型 | Mermaid 语法 | 交互 |
|------|-------------|------|
| 流程图 | `graph TD/LR` | tap 高亮 |
| 时序图 | `sequenceDiagram` | tap 高亮 |
| 类图 | `classDiagram` | - |
| 状态图 | `stateDiagram-v2` | - |
| 实体关系图 | `erDiagram` | - |
| 甘特图 | `gantt` | - |
| 思维导图 | `mindmap` | tap 展开/折叠 |

#### 1.2 辅助学习元素（Markdown + 样式）

| 元素 | 说明 | 渲染方式 |
|------|------|----------|
| 对比表 | 两种方案/技术的优劣对比 | Markdown 表格 + 高亮样式 |
| 图例 | 颜色/形状/符号的含义说明 | 自定义组件 + 徽章样式 |
| 要点列表 | 核心概念小结 | Markdown list + 图标增强 |
| 时间线 | 发展历史、演进过程 | 自定义时间线组件 |
| 数据表格 | 参数对比、特性矩阵 | Markdown 表格 + 响应式样式 |

### 2. AI 生成指导

```markdown
## 可视化决策指南

当内容适合可视化时，AI 应选择合适的呈现方式：

**图表类型（Mermaid）：**
- 流程/步骤类 → `flowchart`
- 时间/顺序类 → `sequence` 或 `timeline`
- 两种方案对比 → `comparison`
- 概念关系/分类 → `mindmap` 或 `class`
- 状态变化 → `state`
- 项目规划/甘特 → `gantt`

**辅助元素（原生组件）：**
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
- 内容已经很简单直观时（如单一定义）
- 强行拆分会破坏理解时

**输出格式：**
{
  "content": "Markdown 内容",
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

### 3. 数据结构

```typescript
// types/course.ts

// 可视化类型
type VisualizationType =
  // 图表类型（Mermaid）
  | 'flowchart' | 'sequence' | 'class' | 'state' | 'er' | 'gantt' | 'mindmap'
  // 辅助元素类型
  | 'comparison' | 'table' | 'timeline' | 'legend' | 'keyPoints';

// 可视化配置
interface Visualization {
  type: VisualizationType;
  title?: string;                    // 标题，如"React vs Vue 对比"
  mermaidCode?: string;              // Mermaid 语法（图表类型）
  complex?: boolean;                 // 是否复杂（需放大按钮）
  // 辅助元素专用字段
  items?: string[];                  // 用于 legend、keyPoints
  rows?: string[][];                 // 用于 table、comparison
  columns?: string[];                // 用于 table、comparison
  events?: TimelineEvent[];          // 用于 timeline
}

interface TimelineEvent {
  time: string;      // 时间点
  title: string;     // 事件标题
  description?: string;
}

interface LearningCard {
  id: string;
  title: string;
  content: string;              // Markdown 内容
  visualization?: Visualization; // 可视化配置
}
```

**类型选择指南：**
| 类型 | 使用场景 |
|------|----------|
| `comparison` | 两种方案/技术的优劣对比（优点/缺点列） |
| `table` | 数据参数对比、特性矩阵（通用表格） |
| `timeline` | 时间顺序、演进过程 |
| `legend` | 符号/颜色/形状含义说明 |
| `keyPoints` | 核心要点小结 |

### 4. 组件结构

```
components/ui/MermaidChart.tsx   # Mermaid 渲染 + 交互封装
components/ui/ComparisonTable.tsx  # 对比表组件
components/ui/Timeline.tsx         # 时间线组件
components/ui/Legend.tsx           # 图例组件
components/ui/KeyPointsList.tsx    # 要点列表组件
```

**组件接口：**

```typescript
// MermaidChart 组件
interface MermaidChartProps {
  mermaidCode: string;           // Mermaid 语法
  complex?: boolean;             // 是否复杂图表（显示放大按钮）
  className?: string;
}

// ComparisonTable 组件
interface ComparisonTableProps {
  title?: string;
  columns: string[];      // ['特性', '方案A', '方案B']
  rows: string[][];      // [['性能', '快', '慢'], ['体积', '小', '大']]
}

// Timeline 组件
interface TimelineProps {
  title?: string;
  events: TimelineEvent[];
}

// Legend 组件
interface LegendProps {
  items: string[];        // ['🔵 蓝色=同步', '🟢 绿色=异步']
}

// KeyPointsList 组件
interface KeyPointsListProps {
  items: string[];        // ['要点1', '要点2', '要点3']
}
```

### 5. 渲染逻辑

```
LearningCard
    │
    ├─ visualization 存在
    │       │
    │       ├─ 是图表类型（flowchart|sequence|...）
    │       │       ├─ complex === true → 显示图表 + 🔍 放大按钮
    │       │       └─ complex === false → 显示图表
    │       │
    │       ├─ type === 'comparison' → 对比表组件（columns + rows）
    │       ├─ type === 'table' → 数据表格组件（columns + rows）
    │       ├─ type === 'timeline' → 时间线组件（events）
    │       ├─ type === 'legend' → 图例组件（items）
    │       └─ type === 'keyPoints' → 要点列表组件（items）
    │
    └─ visualization 不存在
            └─ 仅显示文本内容
```

### 6. 移动端交互

| 操作 | 行为 |
|------|------|
| Tap 节点 | 高亮当前节点 |
| Pinch | 缩放图表 |
| 触摸拖拽 | 平移图表 |
| 长按 | 显示节点详情 |
| 放大按钮 | 全屏查看图表 |

### 7. 全屏模式

- 点击放大按钮 → 全屏显示图表
- 点击任意处 / 向下滑动 → 关闭全屏
- 全屏模式支持 pinch 缩放和触摸拖拽

### 8. 实现位置

| 文件 | 改动 |
|------|------|
| `types/course.ts` | 添加 `Visualization` 类型和字段 |
| `components/ui/MermaidChart.tsx` | 新增，Mermaid 渲染 + 交互 |
| `components/ui/ComparisonTable.tsx` | 新增，对比表组件 |
| `components/ui/Timeline.tsx` | 新增，时间线组件 |
| `components/ui/Legend.tsx` | 新增，图例组件 |
| `components/ui/KeyPointsList.tsx` | 新增，要点列表组件 |
| `components/LearningCard.tsx` | 集成可视化渲染 |
| `lib/prompt.ts` | 指导 AI 判断可视化类型 |

### 9. 依赖

```bash
npm install mermaid
```

---

## 测试要点

1. **无可视化时** → 正常显示文本内容
2. **图表类型** → Mermaid 正确渲染，tap 高亮正常
3. **辅助元素** → 对比表、时间线、图例等样式正确
4. **复杂图表** → 显示放大按钮，点击全屏
5. **触摸交互** → tap 高亮、pinch 缩放、拖拽平移正常
6. **全屏关闭** → 点击/滑动关闭正常

---

## 改动范围

```
新增文件:
- components/ui/MermaidChart.tsx    # Mermaid 图表组件
- components/ui/ComparisonTable.tsx  # 对比表组件
- components/ui/Timeline.tsx         # 时间线组件
- components/ui/Legend.tsx           # 图例组件
- components/ui/KeyPointsList.tsx    # 要点列表组件

修改文件:
- types/course.ts                    # 添加 Visualization 类型
- components/LearningCard.tsx        # 集成可视化渲染
- lib/prompt.ts                      # AI 可视化生成指导
```
