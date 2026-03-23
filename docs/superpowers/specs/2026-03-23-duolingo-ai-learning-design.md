# 个性化 AI 学习产品 — 设计文档

**日期：** 2026-03-23
**状态：** 设计中
**目标：** Demo — 验证 AI 生成学习内容质量 + Duolingo 式学习体验

---

## 1. 产品概述

打破标准化课程限制，用户输入任意兴趣主题，AI 生成专属学习路径，提供类 Duolingo 的闯关学习体验。

---

## 2. 设计决策汇总

| 维度 | 决策 |
|------|------|
| 视觉风格 | 简约现代（大量留白、柔和配色、Notion/Pinterest 风格） |
| 课程树结构 | 纵向线性路径，按顺序解锁，类似 Duolingo |
| 学习交互 | 先展示学习卡片（1-5 张自适应）→ 再答题闯关 |
| 题型组合 | 单选 + 多选 + 填空 |
| 游戏化 | 极简进度条（X/Y），Demo 阶段不做 XP/等级/连续天数 |
| 主题输入 | 纯自由输入框 + 开始按钮 |
| 数据持久化 | localStorage，暂不涉及账号系统 |

---

## 3. 技术栈

| 项目 | 选择 |
|------|------|
| 框架 | Next.js（App Router） |
| AI | MiniMax API（前端直连，用户提供 key） |
| 状态管理 | React Context（CourseContext + ProgressContext） |
| 持久化 | localStorage |
| 移动端 | 优先移动端响应式设计 |

---

## 4. 页面结构

### 4.1 页面列表

```
/                     → 主题输入页
/generate             → AI 生成中（加载动画）
/course/[courseId]    → 课程详情页（课程树）
/course/[courseId]/learn/[nodeIndex] → 单元学习页
```

### 4.2 页面流程

```
[主题输入] → [加载中] → [课程树] ↔ [单元学习]
                              ↑↓ 完成
                         [返回课程树]
```

---

## 5. 核心组件

### 5.1 CourseTree
- **职责：** 展示纵向线性课程树，显示节点标题和完成状态
- **状态：** 未解锁（灰色）/ 已解锁（可点击）/ 已完成（打勾）
- **交互：** 点击已解锁节点 → 进入单元学习页

### 5.2 LearningCard
- **职责：** 展示 1-5 张递进式学习卡片
- **张数规则：** AI 根据节点复杂度自适应决定（简单 1 张，复杂最多 5 张）
- **交互：** 左右滑动切换卡片，最后一张卡片有"开始答题"按钮

### 5.3 QuizQuestion
- **职责：** 展示题目，支持三种题型
- **题型：**
  - 单选题：4 个选项，1 个正确答案
  - 多选题：4 个选项，2+ 个正确答案
  - 填空题：1 个文本输入框
- **反馈：** 提交后即时显示正误，正确显示绿色，错误显示红色 + 正确答案

### 5.4 ProgressBar
- **职责：** 显示当前单元进度（如 2/3）
- **样式：** 简洁进度条，不做等级/XP/连续天数

### 5.5 RetryModal
- **职责：** AI 生成失败时弹出
- **交互：** 两个按钮"重试"或"跳过"

---

## 6. AI 生成流程

### 6.1 生成策略

1. 用户输入主题 → 立即生成**整体课程树**
2. 同步生成**第一节**的完整内容（卡片 + 题目）
3. 用户进入第一节学习时，**后台自动触发生成第二节**
4. 以此类推，学习第 N 节时预生成第 N+1 节

### 6.2 课程树 JSON 结构

```typescript
interface CourseTree {
  courseId: string;
  topic: string;
  totalNodes: number;
  nodes: CourseNode[];
}

interface CourseNode {
  index: number;           // 0, 1, 2, ...
  title: string;           // 节点标题
  description: string;     // 一句话描述
  cardCount: number;       // 学习卡片数量（1-5）
  status: 'locked' | 'available' | 'completed';
  cards?: LearningCard[];  // 内容预生成后填充
  questions?: Question[]; // 题目预生成后填充
}

interface LearningCard {
  id: string;
  title: string;
  content: string;         // 支持 Markdown
  imageUrl?: string;       // 可选的配图 URL
}

interface Question {
  id: string;
  type: 'single' | 'multiple' | 'fill';
  question: string;
  options?: string[];      // 单选/多选
  answer: string | string[]; // 答案
  explanation: string;     // 答错后显示的解释
}
```

### 6.3 自适应节点数量

- 简单主题：4 个节点
- 中等主题：5-6 个节点
- 复杂主题：7-8 个节点
- AI 根据主题复杂度自行判断

### 6.4 失败处理

1. 首次生成失败 → 自动重试
2. 重试失败 → 再重试一次
3. 第二次重试仍失败 → 弹出 RetryModal，让用户选择"重试"或"跳过该单元"

---

## 7. 数据流

```
用户输入主题
    ↓
POST /api/generate (调用 MiniMax API)
    ↓
获取课程树 JSON + 第一节内容
    ↓
存储到 CourseContext + localStorage
    ↓
跳转到 /course/[courseId]
    ↓
用户点击节点进入单元学习
    ↓
LearningCard 展示 → 用户看完滑动到最后一页
    ↓
QuizQuestion 展示 → 用户答题 → 即时反馈
    ↓
全部完成 → 标记节点 completed → 更新进度
    ↓
触发后台生成下一个单元（如果还没生成）
    ↓
返回课程树
```

---

## 8. localStorage 结构

```typescript
interface StoredData {
  courses: CourseTree[];           // 所有课程
  currentCourseId: string | null;   // 当前课程 ID
  courseProgress: {
    [courseId: string]: {
      [nodeIndex: number]: 'completed' | 'in_progress';
    };
  };
}
```

---

## 9. MiniMax API 集成

- **调用方式：** 前端直接调用 MiniMax API（用户提供 key）
- **Key 管理：** 存储在 .env.local，不提交到 git
- **Prompt 设计：** 后续 implementation plan 阶段细化

---

## 10. 文件结构（建议）

```
/app
  /page.tsx                    # 主题输入页
  /generate/page.tsx           # 加载中页
  /course/[courseId]/page.tsx  # 课程详情页
  /course/[courseId]/learn/[nodeIndex]/page.tsx # 单元学习页
  /api/generate/route.ts       # AI 生成 API 路由

/components
  /CourseTree.tsx
  /CourseNode.tsx
  /LearningCard.tsx
  /LearningCardStack.tsx
  /QuizQuestion.tsx
  /ProgressBar.tsx
  /RetryModal.tsx
  /LoadingSpinner.tsx

/contexts
  /CourseContext.tsx
  /ProgressContext.tsx

/lib
  /minimax.ts                  # MiniMax API 调用
  /storage.ts                  # localStorage 封装
  /prompt.ts                   # AI Prompt 模板

/types
  /course.ts                   # 类型定义
```

---

## 11. Demo 验收标准

1. 用户输入"日本江户时代历史" → 获得 4-8 个节点的自适应课程树
2. 课程树纵向展示，用户按顺序解锁节点
3. 点击节点 → 看到 1-5 张自适应学习卡片
4. 滑动完卡片 → 进入单选/多选/填空答题
5. 答题即时反馈（对/错）
6. 完成单元 → 进度更新，下一节点解锁
7. AI 生成失败 → RetryModal 弹窗
8. 刷新页面 → 进度从 localStorage 恢复

---

## 12. 不在 Demo 范围

- 账号系统 / 社交登录
- XP / 等级 / 连续学习天数
- 语音/口语题型
- 跨课程学习记录
- 后端服务（纯前端 Demo）
