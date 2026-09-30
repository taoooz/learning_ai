# 个性化 AI 学习产品 — 设计文档

**日期：** 2026-03-23
**更新：** 2026-03-25
**状态：** 实现中
**目标：** Demo — 验证 AI 生成学习内容质量 + Duolingo 式学习体验

---

## 1. 产品概述

打破标准化课程限制，用户输入任意兴趣主题，AI 生成专属学习路径，提供类 Duolingo 的闯关学习体验。

---

## 2. 设计决策汇总

| 维度 | 决策 |
|------|------|
| 视觉风格 | Claymorphism（柔和阴影、渐变背景、圆角卡片） |
| 课程树结构 | 纵向线性路径，按顺序解锁，类似 Duolingo |
| 学习交互 | 先展示学习卡片（1-5 张自适应）→ 再答题闯关 |
| 题型组合 | 单选 + 多选 + 排序（移除填空题） |
| 游戏化 | 极简进度条（X/Y），Demo 阶段不做 XP/等级/连续天数 |
| 主题输入 | 自由输入框 + 示例提示 + 澄清问题流程 |
| 数据持久化 | localStorage，暂不涉及账号系统 |
| 聊天助理 | 课程内 AI 助理，支持流式输出、上下文管理 |

---

## 3. 技术栈

| 项目 | 选择 |
|------|------|
| 框架 | Next.js（App Router）+ Tailwind CSS v4 |
| AI | MiniMax API（前端直连，用户提供 key） |
| 状态管理 | React Context（CourseContext + ProgressContext + UserProfileContext） |
| 持久化 | localStorage |
| 移动端 | 优先移动端响应式设计（min-h-[100svh]、safe-area-inset） |
| 动画 | Framer Motion（150-300ms 缓动） |
| 图标 | Lucide（SVG 矢量图标） |

---

## 4. 设计系统

### 4.1 色彩系统

```css
/* 背景色 */
--color-background: #F7F7F5;  /* 极浅灰白 */
--color-surface: #FFFFFF;      /* 卡片/容器背景 */
--color-subtle: #F5F5F5;      /* 次要背景 */

/* 文字色 */
--color-text-primary: #1F1F1F;    /* 标题/一级文字 */
--color-text-secondary: #8A8A8A; /* 正文/二级文字 */
--color-text-tertiary: #666666;   /* 辅助文字 */
--color-text-disabled: #999999;    /* 禁用状态 */
--color-text-placeholder: #BDBDBD; /* 占位符 */

/* CTA 色 */
--color-cta: #1A1A1A;         /* 主 CTA 背景 */
--color-cta-text: #FFFFFF;    /* CTA 文字 */

/* 点缀色 */
--color-accent: #FF8A00;      /* 橙色点缀（主交互色） */
--color-accent-light: #FFB380;

/* 状态色 */
--color-success: #34C759;      /* 正确/已完成 */
--color-warning: #FF9500;     /* 警告 */
--color-error: #EF476F;       /* 错误 */
--color-info: #007AFF;        /* 信息/可用状态 */

/* 节点状态色 */
--color-available: #FF9500;           /* 可学状态 */
--color-available-light: rgba(...);   /* 可学状态背景 */
--color-completed: #34C759;          /* 已完成 */
--color-completed-border: #DCEFE4;    /* 已完成边框 */
--color-locked: #BDBDBD;             /* 锁定状态 */

/* 标签色 */
--color-tag-bg: #ECEEEC;             /* 标签背景 */
```

### 4.2 字体系统

```css
/* 字体堆栈（儿童友好风格） */
font-family: 'Baloo 2', -apple-system, BlinkMacSystemFont,
  "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;

/* 字号规范 */
--text-xs: 12px;
--text-sm: 14px;
--text-base: 15px;   /* 基准 */
--text-lg: 16px;
--text-xl: 20px;
--text-2xl: 24px;
--text-3xl: 30px;

/* 行高 */
line-height: 1.5;    /* 基准 */
line-height: 1.75;   /* 正文 */
```

### 4.3 间距系统

```css
/* 8dp 基准网格 */
--spacing-1: 4px;
--spacing-2: 8px;
--spacing-3: 12px;
--spacing-4: 16px;
--spacing-5: 20px;
--spacing-6: 24px;
--spacing-8: 32px;

/* 圆角规范 */
--radius-sm: 12px;
--radius-md: 16px;
--radius-lg: 24px;
--radius-xl: 32px;
--radius-pill: 9999px;

/* 阴影规范（极其克制） */
--shadow-card: 0 2px 12px rgba(0, 0, 0, 0.06);
--shadow-nav: 0 4px 20px rgba(0, 0, 0, 0.08);
--shadow-sheet: 0 8px 40px rgba(0, 0, 0, 0.1);
--shadow-float: 0 12px 36px rgba(17, 24, 39, 0.12);

/* 触摸目标最小尺寸 */
--touch-target-min: 44px;
```

### 4.4 动效规范

```css
/* 时长 */
--duration-fast: 150ms;
--duration-normal: 200ms;
--duration-slow: 300ms;
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);

/* 动画原则 */
- 脉动/浮动动画：仅用于当前学习节点
- 退出动画快于进入动画（约 60-70%）
- 支持 prefers-reduced-motion
```

### 4.5 无障碍规范

```css
/* Focus Ring（全局） */
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-background),
              0 0 0 4px var(--color-accent);
}

/* 触摸目标最小 44x44px */
.touch-target {
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
}

/* 颜色对比度 */
- 正文：≥4.5:1
- 大字：≥3:1
```

---

## 5. 页面结构

### 5.1 页面列表

```
/                       → 首页（主题输入 + 历史课程）
/generate              → AI 生成中（加载动画）
/course/[courseId]     → 课程详情页（课程树 + 聊天助理）
/course/[courseId]/learn/[nodeIndex] → 单元学习页
/profile               → 用户画像页
/review/clarification  → 澄清问题页
/review/loading       → 加载页
```

### 5.2 页面流程

```
[主题输入] → [澄清问题] → [加载中] → [课程树] ↔ [单元学习]
                                     ↑↓ 完成
                                [返回课程树]
```

### 5.3 路由参数

| 页面 | 参数 | 说明 |
|------|------|------|
| `/course/[courseId]` | courseId | 课程唯一标识 |
| `/course/[courseId]/learn/[nodeIndex]` | courseId, nodeIndex | 课程 ID + 节点索引（从 0 开始） |

---

## 6. 核心组件

### 6.1 CourseTree
- **职责：** 展示纵向线性课程树，显示节点标题和完成状态
- **状态：** locked（灰色锁）/ available（橙色边框）/ completed（绿色打勾）/ current（脉动动画）
- **交互：** 点击已解锁节点 → 进入单元学习页
- **特性：** 自动滚动到当前学习节点

### 6.2 CourseNode
- **职责：** 单个课程节点展示
- **样式：** 圆形图标 + 卡片组合，脉动动画表示当前节点
- **状态：**
  - `locked`：灰色、禁用态
  - `available`：橙色边框、可点击
  - `current`：脉动动画、橙色高亮
  - `completed`：绿色打勾

### 6.3 LearningCard
- **职责：** 展示学习内容卡片
- **内容：** 标题 + Markdown 正文 + 可选图片 + 可视化（图表/时间线/对比表等）
- **可视化类型：**
  - Mermaid 图表：flowchart, sequence, class, state, er, gantt, mindmap
  - 辅助元素：comparison, table, timeline, legend, keyPoints

### 6.4 QuizQuestion
- **职责：** 展示题目，支持三种题型
- **题型：**
  - **单选题**：4 个选项，1 个正确答案，点击选中
  - **多选题**：4 个选项，2+ 个正确答案，点击切换选中状态
  - **排序题**：4+ 个选项，点击上下箭头调整顺序
- **反馈：** 提交后即时显示正误，显示解析
- **维度标签：** 记忆 / 理解 / 应用 / 分析

### 6.5 ClarificationScreen
- **职责：** 收集用户背景信息的澄清问题
- **交互：** 单问题卡片 → 回答 → 下一题 → 提交

### 6.6 GenerationLoadingScreen
- **职责：** AI 生成课程时展示加载动画
- **特性：** 动态文案轮播、骨架屏动画

### 6.7 ChatWidget / ChatLauncher
- **职责：** 课程内 AI 助理助手
- **功能：**
  - 流式输出（带思考状态指示）
  - 上下文注入（当前课程、节点信息、用户记忆）
  - 7 天过期机制
  - 按问答对截断（最多 5 对）
  - 对话摘要生成

### 6.8 RetryModal
- **职责：** AI 生成失败时弹出
- **交互：** 两个按钮"重试"或"跳过"

### 6.9 ProgressBar
- **职责：** 显示当前单元进度（如 2/3）
- **样式：** 简洁进度条

---

## 7. AI 生成流程

### 7.1 生成策略

1. 用户输入主题 → 立即生成**整体课程树**
2. 同步生成**第一节**的完整内容（卡片 + 题目）
3. 用户进入第一节学习时，**后台自动触发生成第二节**
4. 以此类推，学习第 N 节时预生成第 N+1 节

### 7.2 澄清问题流程

1. 用户提交主题后，AI 可能返回澄清问题
2. 显示 ClarificationScreen，用户逐一回答
3. 回答完成后继续生成课程

### 7.3 课程树 JSON 结构

```typescript
interface CourseTree {
  courseId: string;
  topic: string;
  difficultySummary: string;
  totalNodes: number;
  nodes: CourseNode[];
}

interface CourseNode {
  index: number;           // 0, 1, 2, ...
  title: string;           // 节点标题
  cardCount: number;      // 学习卡片数量（1-5）
  status: 'locked' | 'available' | 'completed';
  cards?: LearningCard[];  // 内容预生成后填充
  questions?: Question[];  // 题目预生成后填充
}

interface LearningCard {
  id: string;
  title: string;
  content: string;         // 支持 Markdown
  imageUrl?: string;       // 可选的配图 URL
  visualization?: Visualization;
}

interface Visualization {
  type: VisualizationType;
  title?: string;
  mermaidCode?: string;
  complex?: boolean;
  items?: string[];       // legend, keyPoints
  rows?: string[][];       // table, comparison
  columns?: string[];      // table, comparison
  events?: TimelineEvent[]; // timeline
}

interface Question {
  id: string;
  type: 'single' | 'multiple' | 'sorting';
  question: string;
  options?: string[];      // 单选/多选/排序题
  answer: string | string[]; // sorting 时为排列后的数组
  explanation: string;
  dimension?: 'memory' | 'understanding' | 'application' | 'analysis';
  difficulty?: 1 | 2 | 3;
  cardId?: string;
}
```

### 7.4 自适应节点数量

- 简单主题：4 个节点
- 中等主题：5-6 个节点
- 复杂主题：7-8 个节点
- AI 根据主题复杂度自行判断

### 7.5 失败处理

1. 首次生成失败 → 自动重试
2. 重试失败 → 再重试一次
3. 第二次重试仍失败 → 弹出 RetryModal，让用户选择"重试"或"跳过该单元"

---

## 8. 用户记忆系统

### 8.1 UserMemory 结构

```typescript
interface UserMemory {
  profile: UserProfile;
  learningHistory: LearningRecord[];
  extractedInsights: ExtractedInsights;
  lastUpdated: number;
  version: number;
  conversationSummaries: ConversationSummary[];
}

interface UserProfile {
  name?: string;
  targetJob: string;
  workExperience: WorkExperience[];
  education: Education[];
  insights?: LearningInsight;
}

interface LearningRecord {
  courseId: string;
  topic: string;
  nodesCompleted: number;
  totalNodes: number;
  completedAt?: number;
}

interface ExtractedInsights {
  interests: Interest[];
  knowledgeGaps: KnowledgeGap[];
  questionPatterns: QuestionPattern[];
}

interface ConversationSummary {
  courseId: string;
  summary: string;
  timestamp: number;
}
```

### 8.2 过期机制

| 数据类型 | 过期策略 |
|----------|----------|
| ChatHistory | 7 天过期，生成摘要后清理 |
| KnowledgeGap | 长期留存，可标记"已掌握"降级 |
| QuestionPattern | 保留最近 50 条 |
| Interests | 30 天无交互权重衰减 50% |

---

## 9. 聊天助理上下文

### 9.1 上下文注入内容

```
## 当前课程
主题：{course.topic}
目录：
1. 变量 [已完成]
2. 数据类型 [进行中]
3. 运算符 [未解锁]
...

## 用户记忆
兴趣：Python、数据结构
问题倾向：什么是闭包？Python 和 JavaScript 区别

## 对话历史
用户：什么是变量？
助理：变量是...

## 当前节点信息
标题：数据类型
内容摘要：...
```

### 9.2 消息截断策略

- 按**问答对**截断（保留完整的一问一答）
- 最多保留 **5 对**
- 总字符数限制 **2000**

---

## 10. 数据流

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

## 11. localStorage 结构

```typescript
interface StoredData {
  courses: CourseTree[];           // 所有课程
  currentCourseId: string | null; // 当前课程 ID
  courseProgress: CourseProgress;
  userProfile: UserProfile | null;
}

interface CourseProgress {
  [courseId: string]: {
    [nodeIndex: number]: 'completed' | 'in_progress';
  };
}

// 独立存储
'chatHistory_' + courseId → ChatMessage[]  // 按课程隔离的聊天历史
'userMemory' → UserMemory                  // 全局用户记忆
```

---

## 12. MiniMax API 集成

- **调用方式：** 前端直接调用 MiniMax API（用户提供 key）
- **Key 管理：** 存储在 .env.local，不提交到 git
- **模型：** MiniMax-M2
- **流式输出：** 支持 SSE，流式返回思考过程和回答
- **思考分离：** `reasoning_split: true` 参数分离思考内容

---

## 13. 文件结构

```
/app
  /page.tsx                    # 首页（主题输入 + 历史课程）
  /generate/page.tsx           # 生成中页
  /profile/page.tsx            # 用户画像页
  /review/clarification/page.tsx
  /review/loading/page.tsx
  /course/[courseId]/
    page.tsx                   # 课程详情页
    /learn/[nodeIndex]/
      page.tsx                # 单元学习页
  /api/
    /chat/route.ts            # 聊天 API
    /generate/
      route.ts                # 课程生成 API
      /node/route.ts          # 节点内容生成 API
    /profile/
      /insights/route.ts      # 用户洞察 API

/components
  /CourseTree.tsx             # 课程树
  /CourseNode.tsx            # 课程节点
  /CourseHeaderBar.tsx       # 页面顶部导航栏
  /LearningCard.tsx          # 学习卡片
  /LearningCardStack.tsx     # 学习卡片堆栈
  /LearnFlow.tsx             # 学习流程
  /QuizQuestion.tsx          # 答题组件
  /ClarificationScreen.tsx   # 澄清问题页
  /GenerationLoadingScreen.tsx # 生成加载页
  /RetryModal.tsx            # 重试弹窗
  /ui/
    /ChatWidget.tsx          # 聊天组件
    /ChatMessage.tsx         # 聊天消息
    /MermaidChart.tsx        # Mermaid 图表
    /ComparisonTable.tsx     # 对比表格
    /Timeline.tsx            # 时间线
    /Legend.tsx              # 图例
    /KeyPointsList.tsx       # 关键点列表
    /LoadingSpinner.tsx      # 加载动画
    /NavHeader.tsx           # 导航栏
    /ProgressBar.tsx         # 进度条
    /CardSkeleton.tsx        # 卡片骨架屏
    /QuizSkeleton.tsx        # 题目骨架屏
    /Toast.tsx               # 轻提示

/contexts
  /CourseContext.tsx         # 课程状态管理
  /ProgressContext.tsx       # 学习进度管理
  /UserProfileContext.tsx    # 用户画像管理

/hooks
  /useChatHistory.ts          # 聊天历史管理
  /useUserMemory.ts           # 用户记忆管理

/lib
  /minimax.ts                # MiniMax API 调用
  /storage.ts                # localStorage 封装
  /prompt.ts                 # AI Prompt 模板
  /chat-context.ts           # 聊天上下文构建
  /course-tree-layout.ts     # 课程树布局计算

/types
  /course.ts                 # 课程相关类型
  /chat.ts                   # 聊天相关类型

/docs/superpowers/
  /specs/
    2026-03-23-duolingo-ai-learning-design.md  # 本文档
    2026-03-25-chat-context-design.md            # 聊天上下文设计
  /plans/
    2026-03-23-duolingo-ai-learning-implementation.md
    2026-03-25-chat-context-implementation.md
```

---

## 14. Demo 验收标准

1. 用户输入"日本江户时代历史" → 获得 4-8 个节点的自适应课程树
2. 课程树纵向展示，用户按顺序解锁节点
3. 点击节点 → 看到 1-5 张自适应学习卡片
4. 滑动完卡片 → 进入单选/多选/排序答题
5. 答题即时反馈（对/错）
6. 完成单元 → 进度更新，下一节点解锁
7. AI 生成失败 → RetryModal 弹窗
8. 刷新页面 → 进度从 localStorage 恢复
9. 聊天助理能基于当前课程内容回答问题
10. 关闭聊天窗口再打开，历史消息保留

---

## 15. 不在 Demo 范围

- 账号系统 / 社交登录
- XP / 等级 / 连续学习天数
- 语音/口语题型
- 跨课程学习记录
- 后端服务（纯前端 Demo）
