# 课程助理 + 用户记忆系统设计

## 背景

当前课程学习流程缺少 AI 辅助交互能力，用户在学习过程中遇到问题无法即时获得帮助，也无法基于历史学习沉淀个性化的理解洞见。需要：

1. **课程助理**：用户在课程页可唤起对话窗口，与 AI 助理实时沟通
2. **用户记忆**：综合用户信息、学习记录、对话记录，沉淀个性化记忆用于未来生成和回答

## 目标

- 用户可在课程学习任意时刻唤起 AI 助理，获得即时帮助
- AI 助理能基于当前课程内容和用户历史记忆提供个性化回答
- 用户记忆能在对话和课程完成后自动更新，服务于未来更好的生成和回答

---

## 设计原则

1. **轻量优先**：使用 localStorage + 现有 MiniMax API，不引入额外后端依赖
2. **渐进增强**：先实现核心对话和记忆读写，再迭代智能化更新
3. **流式体验**：AI 回复使用流式输出，提升交互体验
4. **结构化记忆**：记忆按主题/来源组织，支持精确提取和上下文构建

---

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│                     UI Layer                        │
│  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ ChatWidget   │  │ CoursePage / CourseTree    │  │
│  │ (对话框)      │  │ (唤起按钮)                  │  │
│  └──────┬───────┘  └────────────────────────────┘  │
└─────────┼───────────────────────────────────────────┘
          │ POST /api/chat (SSE)
┌─────────▼───────────────────────────────────────────┐
│                   API Layer                          │
│  ┌──────────────┐  ┌────────────────────────────┐   │
│  │ /api/chat    │  │ /api/profile/insights      │   │
│  │ (对话接口)    │  │ (提取用户洞察)              │   │
│  └──────┬───────┘  └────────────────────────────┘   │
└─────────┼───────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────┐
│                 Storage Layer (localStorage)          │
│  ┌──────────────┐  ┌────────────────────────────┐   │
│  │ chatHistory  │  │ userMemory                 │   │
│  │ _{courseId}   │  │ (全局记忆)                  │   │
│  └──────────────┘  └────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 数据结构

### 1. ChatMessage（对话消息）

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}
```

### 2. UserMemory（用户记忆）

```typescript
interface UserMemory {
  // 用户画像（已有）
  profile: UserProfile;

  // 学习历史
  learningHistory: Array<{
    courseId: string;
    topic: string;
    nodesCompleted: number;
    totalNodes: number;
    completedAt?: number;
  }>;

  // 提取的洞察
  extractedInsights: {
    // 兴趣：按主题组织，有权重
    interests: Array<{
      topic: string;
      weight: number;           // 1-5，基于交互频率
      source: 'course' | 'chat';
      courseId?: string;
      lastInteraction: number;
    }>;

    // 知识薄弱点：关联具体主题和证据
    knowledgeGaps: Array<{
      concept: string;           // 薄弱概念
      topic: string;            // 所属主题
      evidence: string[];       // 证据：问过的问题片段
      severity: 'high' | 'medium' | 'low';
    }>;

    // 问题记录：关联主题，用于判断"用户常问什么"
    questionPatterns: Array<{
      question: string;
      topic: string;
      timestamp: number;
    }>;
  };

  // 元数据
  lastUpdated: number;
  version: number;              // 用于判断是否需要压缩合并
}
```

### 3. localStorage Key 设计

| Key | 内容 | 说明 |
|-----|------|------|
| `ai-learning-data` | 现有 StoredData | 课程、进度、用户画像 |
| `userMemory` | UserMemory JSON | 全局用户记忆 |
| `chatHistory_{courseId}` | ChatMessage[] | 按课程隔离的对话历史 |

---

## 实现步骤

### Phase 1: 类型和 Hooks 基础

#### Task 1: `types/chat.ts`
- 定义 `ChatMessage` 类型
- 定义 `ChatSession` 类型（可选，用于多会话管理）

#### Task 2: `types/course.ts` 扩展
- 添加 `UserMemory` 类型定义
- 添加 `Interest`, `KnowledgeGap`, `QuestionPattern` 等子类型

#### Task 3: `hooks/useChatHistory.ts`
```typescript
interface UseChatHistoryReturn {
  messages: ChatMessage[];
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  clearHistory: () => void;
}

// 功能：
// - 从 localStorage 读取指定 courseId 的对话历史
// - 添加消息时自动生成 id 和 timestamp
// - SSR 保护
```

#### Task 4: `hooks/useUserMemory.ts`
```typescript
interface UseUserMemoryReturn {
  userMemory: UserMemory;
  updateInterests: (topic: string, source: 'course' | 'chat', courseId?: string) => void;
  addKnowledgeGap: (concept: string, topic: string, evidence: string) => void;
  addQuestionPattern: (question: string, topic: string) => void;
  addLearningRecord: (record: Omit<LearningHistory[0], 'completedAt'>) => void;
  markNodeCompleted: (courseId: string) => void;
}

// 功能：
// - 从 localStorage 读取/初始化 userMemory
// - 提供结构化的更新方法
// - 自动更新 lastUpdated 和 version
```

---

### Phase 2: 后端 API

#### Task 5: `lib/minimax.ts` 扩展
添加流式对话方法：
```typescript
export async function* callMiniMaxChat(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): AsyncGenerator<string> {
  // 实现 SSE 流式调用
  // yield 每个 chunk 的 content
}
```

#### Task 6: `lib/chat-context.ts`
```typescript
function buildChatContext(
  course: CourseNode,        // 当前课程节点
  userMemory: UserMemory,     // 用户记忆
  chatHistory: ChatMessage[]  // 当前对话历史
): string {
  // 1. 提取当前课程相关的兴趣和薄弱点
  const relevantGaps = userMemory.extractedInsights.knowledgeGaps
    .filter(g => g.topic === course.topic || g.severity === 'high')
    .slice(0, 3);

  const relevantInterests = userMemory.extractedInsights.interests
    .filter(i => i.topic === course.topic)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  // 2. 构建高权重问题模式
  const topQuestions = userMemory.extractedInsights.questionPatterns
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5);

  return `
## 当前课程
主题：${course.title}
内容：${course.cards?.map(c => `${c.title}: ${c.content}`).join('\n')}

## 用户兴趣（相关）
${relevantInterests.map(i => `- ${i.topic} (权重: ${i.weight})`).join('\n') || '暂无'}

## 知识薄弱点
${relevantGaps.map(g => `- ${g.concept}: ${g.evidence.join(', ')}`).join('\n') || '暂无'}

## 近期问题模式
${topQuestions.map(q => `- [${q.topic}] ${q.question}`).join('\n') || '暂无'}

## 对话历史
${chatHistory.map(m => `${m.role}: ${m.content}`).join('\n')}
`.trim();
}
```

#### Task 7: `app/api/chat/route.ts`
```typescript
// POST /api/chat
// Request: { courseId: string, messages: ChatMessage[] }
// Response: SSE stream of { content: string, done: boolean }

export async function POST(request: NextRequest) {
  const { courseId, messages } = await request.json();

  // 1. 获取用户记忆
  const userMemory = getUserMemory();

  // 2. 获取当前课程内容
  const course = getCourseNode(courseId);

  // 3. 构建上下文
  const context = buildChatContext(course, userMemory, messages);

  // 4. 构建 AI 消息
  const aiMessages = [
    { role: 'system' as const, content: context },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  // 5. 流式返回
  return new Response(
    stream AI response,
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
}
```

---

### Phase 3: 前端 UI

#### Task 8: `components/ui/ChatMessage.tsx`
```tsx
interface ChatMessageProps {
  message: ChatMessage;
}

// 功能：
// - 根据 role 区分用户/助理消息
// - 助理消息支持 markdown 渲染
// - 代码高亮（使用 react-markdown）
// - 打字机动画效果（流式输出时）
```

#### Task 9: `components/ui/ChatWidget.tsx`
```tsx
interface ChatWidgetProps {
  courseId: string;
  isOpen: boolean;
  onClose: () => void;
}

// 功能：
// - 居中/底部弹出对话框
// - 消息列表（滚动、自动滚动到底部）
// - 输入框（支持 Enter 发送）
// - 发送按钮 + loading 状态
// - 使用 assistant-ui 库处理流式消息
// - 样式匹配现有项目（RetryModal 风格）
```

#### Task 10: 页面集成

**修改文件：**

| 文件 | 添加内容 |
|------|----------|
| `app/course/[courseId]/page.tsx` | 课程页添加助理唤起按钮 |
| `app/course/[courseId]/learn/[nodeIndex]/page.tsx` | 学习页添加助理唤起按钮 |
| `components/CourseTree.tsx` | 节点旁边添加助理唤起按钮 |

**唤起按钮样式：**
```tsx
<button
  onClick={() => setChatOpen(true)}
  className="fixed bottom-24 right-6 w-14 h-14 rounded-full bg-accent text-white shadow-lg hover:scale-105 transition"
>
  <MessageCircleIcon />
</button>
```

---

### Phase 4: 用户记忆更新

#### Task 11: 对话后更新记忆

对话结束后（在流式输出完成时）：

```typescript
async function handleChatComplete(messages: ChatMessage[]) {
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();

  if (lastUserMessage) {
    // 1. 记录问题模式
    addQuestionPattern(lastUserMessage.content, currentTopic);

    // 2. 分析是否涉及薄弱概念（简单关键词匹配）
    const gaps = extractPotentialGaps(lastUserMessage.content, currentTopic);
    gaps.forEach(gap => addKnowledgeGap(gap, currentTopic, lastUserMessage.content));
  }
}
```

#### Task 12: 节点完成时更新记忆

课程节点完成时：

```typescript
function handleNodeComplete(courseId: string, nodeIndex: number) {
  const course = getCourse(courseId);
  const node = course.nodes[nodeIndex];

  // 1. 更新学习历史
  addLearningRecord({
    courseId,
    topic: node.title,
    nodesCompleted: nodeIndex + 1,
    totalNodes: course.totalNodes
  });

  // 2. 增加相关兴趣权重
  updateInterests(node.title, 'course', courseId);
}
```

---

## 关键设计决策

### 1. 为什么用 assistant-ui？

| 考虑 | 说明 |
|------|------|
| 流式输出 | 内置支持，无需自己实现 SSE 处理 |
| Markdown 渲染 | 内置 react-markdown + 代码高亮 |
| 可定制 | Composable primitives 可精确控制 UI |
| 风格匹配 | 基于 Radix UI / shadcn/ui，与 Tailwind 配合好 |

### 2. 对话上下文范围

综合三类信息：
- **当前课程节点**：卡片内容 + 标题
- **用户全局记忆**：兴趣、薄弱点、问题模式
- **当前对话历史**：最近 10 条消息

### 3. 记忆更新策略

| 时机 | 更新内容 | 权重变化 |
|------|----------|----------|
| 对话结束后 | `questionPatterns` + 相关 `interests` | +1 |
| 节点完成时 | `learningHistory` + `interests` | +2 |
| 每满 50 条旧记录 | 压缩合并，保留高权重/高 severity | - |

### 4. SSR 保护

所有 localStorage 访问都添加 SSR 保护：
```typescript
if (typeof window === 'undefined') return defaultValue;
```

---

## 迁移到 Vercel 的注意事项

- localStorage API 保持不变
- 后续替换为 Vercel KV/Postgres 只需改 hook 内部实现
- userMemory 结构保持兼容

---

## 验证方式

1. **本地测试：**
   ```bash
   npm run dev
   ```
   - 打开课程页，点击助理按钮
   - 对话，观察流式输出
   - 刷新页面验证历史是否持久化
   - 完成课程节点后检查用户记忆是否更新

2. **功能验证清单：**
   - [ ] 对话能基于当前课程内容回答
   - [ ] 用户记忆能正确沉淀（interests、knowledgeGaps、questionPatterns）
   - [ ] 多页面能唤起同一个助理
   - [ ] 刷新后对话历史仍然存在

---

## 后续扩展

- 用户体系完成后：userMemory 迁移到 DB
- 上下文过长时：使用摘要而非原始内容
- 主动推荐：基于 userMemory 在首页推荐课程
- 智能化更新：使用 AI 分析对话自动提取洞察
