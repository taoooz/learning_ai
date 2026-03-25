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

### 1. 图表类型支持

| 类型 | Mermaid 语法 | 交互 |
|------|-------------|------|
| 流程图 | `graph TD/LR` | tap 高亮 |
| 时序图 | `sequenceDiagram` | tap 高亮 |
| 类图 | `classDiagram` | - |
| 状态图 | `stateDiagram-v2` | - |
| 实体关系图 | `erDiagram` | - |
| 甘特图 | `gantt` | - |
| 思维导图 | `mindmap` | tap 展开/折叠 |

### 2. 数据结构

```typescript
// types/course.ts
interface LearningCard {
  id: string;
  title: string;
  content: string;              // Markdown 内容
  chartCode?: string;           // Mermaid 图表代码
  chartComplex?: boolean;       // 是否复杂图表（需放大）
}
```

### 3. 组件结构

```
components/ui/MermaidChart.tsx   # Mermaid 渲染 + 交互封装
```

**MermaidChart 组件接口：**

```typescript
interface MermaidChartProps {
  code: string;           // Mermaid 语法
  complex?: boolean;       // 是否复杂图表（显示放大按钮）
  className?: string;
}
```

### 4. 渲染逻辑

```
LearningCard
    │
    ├─ chartCode 存在
    │       │
    │       ├─ complex === true
    │       │       └─ 显示图表 + 🔍 放大按钮
    │       │
    │       └─ complex === false
    │               └─ 显示图表（无放大按钮）
    │
    └─ chartCode 不存在
            └─ 仅显示文本内容
```

### 5. 移动端交互

| 操作 | 行为 |
|------|------|
| Tap 节点 | 高亮当前节点 |
| Pinch | 缩放图表 |
| 触摸拖拽 | 平移图表 |
| 长按 | 显示节点详情 |
| 放大按钮 | 全屏查看图表 |

### 6. 全屏模式

- 点击放大按钮 → 全屏显示图表
- 点击任意处 / 向下滑动 → 关闭全屏
- 全屏模式支持 pinch 缩放和触摸拖拽

### 7. 实现位置

| 文件 | 改动 |
|------|------|
| `types/course.ts` | 添加 `chartCode`、`chartComplex` 字段 |
| `components/ui/MermaidChart.tsx` | 新增，Mermaid 渲染 + 交互 |
| `components/LearningCard.tsx` | 集成图表渲染区域 |
| `lib/prompt.ts` | 指导 AI 判断何时生成图表 |

### 8. 依赖

```bash
npm install mermaid
```

---

## 测试要点

1. **无图表时** → 正常显示文本内容
2. **简单图表** → 直接显示，无放大按钮
3. **复杂图表** → 显示放大按钮，点击全屏
4. **触摸交互** → tap 高亮、pinch 缩放、拖拽平移正常
5. **全屏关闭** → 点击/滑动关闭正常

---

## 改动范围

```
新增文件:
- components/ui/MermaidChart.tsx    # Mermaid 渲染组件

修改文件:
- types/course.ts                    # 添加图表字段
- components/LearningCard.tsx        # 集成图表区域
- lib/prompt.ts                      # AI 图表生成指导
```
