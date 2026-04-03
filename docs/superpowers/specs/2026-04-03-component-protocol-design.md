# 节点内容组件协议设计

## 1. 背景与目标

当前课程节点内容生成使用 Visualization 系统（`flowchart`, `timeline`, `comparison`, `table` 等类型），作为 LearningCard 的可视化扩展。本设计提出一套新的组件协议，目标是：

- **灵活性**：组件可与正文内容混排，不再局限于标准卡片内的可视化区域
- **简洁性**：后端只需拼接简要结构（插槽式），前端即可渲染
- **流式友好**：支持边接收边渲染，提升用户体验

## 2. 核心决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 协议定位 | 替代现有 Visualization 系统 | 完全重构，数据结构更清晰 |
| 数据格式 | Web Components 风格 HTML 标签 | AI 拼接成本低，与正文混排自然 |
| 组件命名 | 纯命名（无前缀） | 语法简洁，与标准 HTML 标签不冲突 |
| 流式方案 | 前端缓冲解析 | 边收边渲染，实现增量展示 |
| 解析位置 | 客户端（浏览器） | 无需改造现有 SSE 接口 |

## 3. 组件清单

| 组件 | 插槽 | 用途 |
|------|------|------|
| `<card>` | `title`, `content` | 通用信息卡片，将内容封装成独立单元 |
| `<quote-card>` | `content`, `tag` | 金句/名言卡片，突出重要语句 |
| `<flowchart>` | `title`, `content` | 流程图，通过图标强调知识间关系 |
| `<timeline>` | `title`, `content` | 时间线，按时间顺序展示发展 |
| `<table>` | `title`, `content` | 表格，以表格形式展示结构化数据 |

### 3.1 插槽说明

每个插槽使用 `<div slot="插槽名">` 语法：

```html
<card>
  <div slot="title">卡片标题</div>
  <div slot="content">卡片内容</div>
</card>
```

## 4. 内容格式示例

### 4.1 混排示例

```html
这一节我们来学习鸡兔同笼问题。

<card>
  <div slot="title">核心公式</div>
  <div slot="content">总脚数 = 鸡的数量×2 + 兔的数量×4</div>
</card>

常见的解题思路有以下几种：

<flowchart>
  <div slot="title">解题流程</div>
  <div slot="content">
    1. 假设全是鸡 → 计算总脚数
    2. 与实际脚数对比 → 差值
    3. 差值 ÷ (4-2) = 兔的数量
    4. 总数 - 兔的数量 = 鸡的数量
  </div>
</flowchart>

<quote-card>
  <div slot="content">学而不思则罔，思而不学则殆。</div>
  <div slot="tag">孔子</div>
</quote-card>

接下来我们做几道练习题巩固一下。
```

### 4.2 表格示例

```html
<table>
  <div slot="title">三种解法对比</div>
  <div slot="content">
    | 解法 | 适用场景 | 复杂度 |
    |------|----------|--------|
    | 假设法 | 一般情况 | O(1) |
    | 方程法 | 进阶问题 | O(n) |
    | 抬脚法 | 趣味解法 | O(1) |
  </div>
</table>
```

### 4.3 时间线示例

```html
<timeline>
  <div slot="title">数学史上的鸡兔同笼</div>
  <div slot="content">
    - 公元前的《九章算术》首次记载
    - 宋代推广为民间趣味数学
    - 现代成为小学奥数经典题型
  </div>
</timeline>
```

## 5. 架构设计

### 5.1 数据流

```
后端 (AI 生成)
    │
    │ SSE 流式输出 HTML 标签片段
    ▼
前端浏览器
    │
    ├── 缓存当前接收的文本片段
    ├── 检测完整闭合标签（如 </card>）
    ├── 解析标签为组件对象
    └── React 增量渲染已解析组件
```

### 5.2 前端解析器设计

解析器运行在客户端，分以下步骤：

1. **文本缓冲**：将 SSE 接收的文本片段追加到缓冲区
2. **标签检测**：使用正则检测完整的组件标签对
3. **提取解析**：将 `<card>...</card>` 提取并解析插槽内容
4. **状态更新**：将解析结果存入 React state
5. **组件渲染**：已解析的组件立即渲染，剩余缓冲区继续等待

```typescript
interface ParsedComponent {
  id: string;
  type: 'card' | 'quote-card' | 'flowchart' | 'timeline' | 'table';
  slots: Record<string, string>;
  raw: string; // 原始 HTML 用于调试
}

interface ParseResult {
  components: ParsedComponent[];
  remainingBuffer: string;
}
```

### 5.3 正则匹配策略

```typescript
// 检测完整标签对的正则
const componentPattern = /<(card|quote-card|flowchart|timeline|table)>([\s\S]*?)<\/\1>/g;

// 提取插槽的正则
const slotPattern = /<div slot="(\w+)">([\s\S]*?)<\/div>/g;
```

## 6. 组件渲染接口

每个组件对应一个 React 组件：

```tsx
// components/ui/ContentComponents.tsx

interface CardProps {
  title: string;
  content: string;
}

interface QuoteCardProps {
  content: string;
  tag: string;
}

interface FlowchartProps {
  title: string;
  content: string; // 可以是文本列表或 Mermaid 代码
}

interface TimelineProps {
  title: string;
  content: string; // 可以是文本列表
}

interface TableProps {
  title: string;
  content: string; // Markdown 表格格式
}
```

## 7. 替换现有 Visualization 系统

由于本协议替代现有 Visualization 系统，需要：

1. **后端修改**：`lib/prompt.ts` 中的 `buildNodeLessonPrompt()` 等函数，改为生成 HTML 组件格式而非 `LearningCard.visualization`
2. **数据类型修改**：`types/course.ts` 中移除或废弃 `Visualization` 相关类型
3. **前端修改**：
   - `CardVisualization.tsx` 相关组件保留用于其他场景
   - 新增 `ContentComponentParser.tsx` 解析器
   - `LearningCard.tsx` 简化或移除 visualization 渲染逻辑

## 8. 实施步骤

1. 前端：实现 `ContentComponentParser` 解析器
2. 前端：实现 5 个组件的 React 版本
3. 后端：修改 prompt 生成逻辑，输出 HTML 组件格式
4. 集成：SSE 流式内容 → 解析器 → React 组件渲染
5. 废弃：移除旧的 Visualization 相关代码

## 9. 风险与注意事项

1. **HTML 转义**：组件内容如果包含 `</card>` 等字符串，需要转义处理
2. **嵌套限制**：暂不支持组件嵌套组件（如表格内嵌套卡片）
3. **流式完整性**：必须处理边界情况，如收到不完整的标签片段
