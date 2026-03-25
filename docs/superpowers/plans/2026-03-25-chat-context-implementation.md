# AI 助理上下文逻辑优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 AI 助理的上下文管理，实现按问答对截断、7天过期机制和对话摘要功能。

**Architecture:** 通过修改 hooks 层（useChatHistory、useUserMemory）和上下文构建层（lib/chat-context.ts），实现过期检测、摘要生成和智能截断。

**Tech Stack:** Next.js, localStorage, MiniMax API

---

## 文件清单

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `types/course.ts` | 添加 `ConversationSummary` 类型，扩展 `UserMemory` |
| `types/chat.ts` | 扩展 `ChatMessage` 添加 `isExpired` 字段 |
| `hooks/useChatHistory.ts` | 添加过期检测、按问答对截断、摘要生成调用 |
| `hooks/useUserMemory.ts` | 添加摘要存储、权重衰减、questionPatterns 限制 |
| `lib/chat-context.ts` | 过滤过期对话，注入摘要 |
| `components/ui/ChatWidget.tsx` | 适配新的截断逻辑 |

---

## 任务列表

### Task 1: 扩展类型定义

**Files:**
- Modify: `types/course.ts:164-176`
- Modify: `types/chat.ts:1-9`

- [ ] **Step 1: 在 types/course.ts 添加 ConversationSummary 类型**

在 `ExtractedInsights` 后添加：

```typescript
// 对话摘要（过期对话生成）
export interface ConversationSummary {
  courseId: string;
  summary: string;
  timestamp: number;
}
```

- [ ] **Step 2: 在 UserMemory 中添加 conversationSummaries 字段**

修改 `UserMemory` 接口：

```typescript
export interface UserMemory {
  profile: UserProfile;
  learningHistory: LearningRecord[];
  extractedInsights: ExtractedInsights;
  lastUpdated: number;
  version: number;
  conversationSummaries: ConversationSummary[];  // 新增
}
```

- [ ] **Step 3: 在 types/chat.ts 的 ChatMessage 添加 isExpired 字段**

```typescript
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isExpired?: boolean;  // 新增：标记对话是否已过期
}
```

- [ ] **Step 4: Commit**

```bash
git add types/course.ts types/chat.ts
git commit -m "feat(chat): add ConversationSummary type and expire field

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 实现 useChatHistory 增强

**Files:**
- Modify: `hooks/useChatHistory.ts:1-52`

- [ ] **Step 1: 添加常量定义**

```typescript
const CHAT_HISTORY_PREFIX = 'chatHistory_';
const EXPIRATION_DAYS = 7;
const MAX_MESSAGE_PAIRS = 5;  // 最多保留5对问答
const MAX_TOTAL_CHARS = 2000;  // 总字符数限制
```

- [ ] **Step 2: 添加 groupMessagesIntoPairs 函数（按问答对分组）**

```typescript
function groupMessagesIntoPairs(messages: ChatMessage[]): Array<{ q: ChatMessage; a: ChatMessage }> {
  const pairs: Array<{ q: ChatMessage; a: ChatMessage }> = [];
  let i = 0;
  while (i < messages.length - 1) {
    if (messages[i].role === 'user') {
      const nextMsg = messages[i + 1];
      if (nextMsg && nextMsg.role === 'assistant') {
        pairs.push({ q: messages[i], a: nextMsg });
        i += 2;
        continue;
      }
    }
    i++;
  }
  return pairs;
}
```

- [ ] **Step 3: 添加 truncateByPairs 函数（按问答对截断）**

```typescript
function truncateByPairs(messages: ChatMessage[], maxPairs: number, maxChars: number): ChatMessage[] {
  const pairs = groupMessagesIntoPairs(messages);

  // 从最旧的开始删除，直到满足限制
  let validPairs = pairs;
  while (validPairs.length > maxPairs || calculateTotalChars(validPairs) > maxChars) {
    if (validPairs.length === 0) break;
    validPairs = validPairs.slice(1);
  }

  // 展平为消息数组
  return validPairs.flatMap(pair => [pair.q, pair.a]);
}

function calculateTotalChars(pairs: Array<{ q: ChatMessage; a: ChatMessage }>): number {
  return pairs.reduce((sum, pair) => sum + pair.q.content.length + pair.a.content.length, 0);
}
```

- [ ] **Step 4: 添加 checkExpiration 函数（同步检查，返回是否过期）**

```typescript
function checkExpiration(messages: ChatMessage[]): boolean {
  if (messages.length === 0) return false;

  const lastMessage = messages[messages.length - 1];
  const daysSinceLastMessage = (Date.now() - lastMessage.timestamp) / (1000 * 60 * 60 * 24);

  return daysSinceLastMessage > EXPIRATION_DAYS;
}
```

- [ ] **Step 5: 添加 generateSimpleSummary 函数（简单摘要生成）**

```typescript
function generateSimpleSummary(messages: ChatMessage[]): string {
  // 提取所有用户问题，生成简单摘要
  const userQuestions = messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .slice(-3);  // 取最近3个问题

  if (userQuestions.length === 0) return '用户询问了课程相关问题';

  // 取第一个问题的主题词作为摘要
  const firstQuestion = userQuestions[0];
  // 提取前10个字作为摘要
  return `用户问了：${firstQuestion.slice(0, 15)}${firstQuestion.length > 15 ? '...' : ''}`;
}
```

- [ ] **Step 6: 修改 addMessage 函数**

```typescript
const addMessage = useCallback((
  message: Omit<ChatMessage, 'id' | 'timestamp'>,
  options?: {
    onExpire?: (courseId: string, summary: string) => void;
  }
): void => {
  // ... 现有逻辑 ...

  let updatedMessages = [...messages, newMessage];

  // 先检查是否过期
  const isExpired = checkExpiration(updatedMessages);

  if (isExpired) {
    // 生成简单摘要
    const summary = generateSimpleSummary(updatedMessages);
    // 标记所有消息为已过期
    updatedMessages = updatedMessages.map(m => ({ ...m, isExpired: true }));
    // 通知外部保存摘要（异步，不阻塞）
    options?.onExpire?.(courseId, summary);
  }

  // 按问答对截断（只对未过期的消息）
  if (!isExpired) {
    const pairs = groupMessagesIntoPairs(updatedMessages);
    if (pairs.length > MAX_MESSAGE_PAIRS || calculateTotalChars(pairs) > MAX_TOTAL_CHARS) {
      updatedMessages = truncateByPairs(updatedMessages, MAX_MESSAGE_PAIRS, MAX_TOTAL_CHARS);
    }
  }

  localStorage.setItem(`${CHAT_HISTORY_PREFIX}${courseId}`, JSON.stringify(updatedMessages));
}, [courseId, getMessages]);
```

- [ ] **Step 7: Commit**

```bash
git add hooks/useChatHistory.ts
git commit -m "feat(chat): add Q&A pair truncation and expiration check

- Add groupMessagesIntoPairs() to group messages into Q&A pairs
- Add truncateByPairs() for intelligent truncation
- Add checkExpiration() for 7-day expiration check
- Add generateSimpleSummary() for heuristic-based summary
- Update addMessage() to use new truncation and expiration logic
- Fix race condition: single localStorage write

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 扩展 useUserMemory

**Files:**
- Modify: `hooks/useUserMemory.ts:1-134`

- [ ] **Step 1: 添加常量**

```typescript
const MAX_QUESTION_PATTERNS = 50;
const INTEREST_DECAY_DAYS = 30;
const INTEREST_DECAY_FACTOR = 0.5;
```

- [ ] **Step 2: 添加 ConversationSummary 到类型**

```typescript
import { UserMemory, Interest, KnowledgeGap, QuestionPattern, LearningRecord, ConversationSummary } from '@/types/course';
```

- [ ] **Step 3: 修改 saveMemory 函数（添加 version 递增）**

```typescript
// saveMemory 已有 version += 1，保持不变
```

- [ ] **Step 4: 修改 addQuestionPattern 添加限制**

```typescript
const addQuestionPattern = useCallback((question: string, topic: string): void => {
  // 添加新模式
  memory.extractedInsights.questionPatterns.push({
    question,
    topic,
    timestamp: Date.now(),
  });

  // 限制数量，超出则删除最旧的（保留最新的50条）
  if (memory.extractedInsights.questionPatterns.length > MAX_QUESTION_PATTERNS) {
    memory.extractedInsights.questionPatterns.sort((a, b) => b.timestamp - a.timestamp);
    memory.extractedInsights.questionPatterns = memory.extractedInsights.questionPatterns.slice(0, MAX_QUESTION_PATTERNS);
  }

  saveMemory(memory);
}, [memory]);
```

- [ ] **Step 5: 修改 updateInterests 添加权重衰减**

```typescript
const updateInterests = useCallback((topic: string, source: 'course' | 'chat', courseId?: string): void => {
  // 先应用权重衰减
  const now = Date.now();
  memory.extractedInsights.interests.forEach(interest => {
    const daysSinceInteraction = (now - interest.lastInteraction) / (1000 * 60 * 60 * 24);
    if (daysSinceInteraction > INTEREST_DECAY_DAYS) {
      interest.weight = Math.max(1, interest.weight * INTEREST_DECAY_FACTOR);
    }
  });

  // 更新当前 interest
  const interests = memory.extractedInsights.interests;
  const existing = interests.find(i => i.topic === topic);

  if (existing) {
    existing.weight = Math.min(5, existing.weight + (source === 'course' ? 2 : 1));
    existing.lastInteraction = now;
  } else {
    interests.push({
      topic,
      weight: 1,
      source,
      courseId,
      lastInteraction: now,
    });
  }

  saveMemory(memory);
}, [memory]);
```

- [ ] **Step 6: 添加 addConversationSummary 方法**

```typescript
const addConversationSummary = useCallback((courseId: string, summary: string): void => {
  // 检查是否已存在该课程的摘要，有则更新
  const existing = memory.conversationSummaries?.find(s => s.courseId === courseId);
  if (existing) {
    existing.summary = summary;
    existing.timestamp = Date.now();
  } else {
    if (!memory.conversationSummaries) {
      memory.conversationSummaries = [];
    }
    memory.conversationSummaries.push({
      courseId,
      summary,
      timestamp: Date.now(),
    });
  }
  saveMemory(memory);
}, [memory]);

const getConversationSummary = useCallback((courseId: string): ConversationSummary | undefined => {
  return memory.conversationSummaries?.find(s => s.courseId === courseId);
}, [memory]);
```

- [ ] **Step 7: 修改 return 语句导出新方法**

```typescript
return {
  userMemory: memory,
  updateInterests,
  addKnowledgeGap,
  addQuestionPattern,
  addLearningRecord,
  markNodeCompleted,
  addConversationSummary,    // 新增
  getConversationSummary,    // 新增
};
```

- [ ] **Step 8: Commit**

```bash
git add hooks/useUserMemory.ts
git commit -m "feat(memory): add conversation summary and decay logic

- Add addConversationSummary() and getConversationSummary()
- Limit questionPatterns to 50 items
- Add weight decay for interests after 30 days

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 修改 chat-context.ts

**Files:**
- Modify: `lib/chat-context.ts:1-63`

- [ ] **Step 1: 添加 ConversationSummary 参数**

```typescript
import { CourseTree, UserMemory, ConversationSummary } from '@/types/course';
import { ChatMessage } from '@/types/chat';

interface ContextInfo {
  currentNodeTitle?: string;
  currentNodeCards?: string[];
  currentQuestion?: string;
}
```

- [ ] **Step 2: 修改 buildChatContext 函数签名**

```typescript
export function buildChatContext(
  course: CourseTree,
  userMemory: UserMemory,
  chatHistory: ChatMessage[],
  contextInfo?: ContextInfo,
  conversationSummary?: ConversationSummary  // 新增参数
): string {
```

- [ ] **Step 3: 过滤过期消息**

```typescript
export function buildChatContext(
  course: CourseTree,
  userMemory: UserMemory,
  chatHistory: ChatMessage[],
  contextInfo?: ContextInfo,
  conversationSummary?: ConversationSummary
): string {
  // 过滤未过期的消息
  const activeMessages = chatHistory.filter(m => !m.isExpired);
  const expiredSummary = conversationSummary?.summary;
```

- [ ] **Step 4: 在对话历史部分添加摘要**

```typescript
  // 对话历史
  const historySection = activeMessages.length > 0
    ? activeMessages.map(m => `${m.role === 'user' ? '用户' : '助理'}：${m.content}`).join('\n')
    : '暂无';

  // 如果有过期摘要，添加到历史中
  const summarySection = expiredSummary
    ? `【之前对话摘要】${expiredSummary}\n\n${historySection}`
    : historySection;
```

- [ ] **Step 5: 修改返回值使用 summarySection**

```typescript
  return `你是课程学习助理，基于以下信息帮助用户解答问题。
...
## 对话历史
${summarySection}

请基于以上信息，简洁回答用户当前问题。
回答完毕后，用一句简短的引导性问题结束，启发用户继续探索。`.trim();
```

- [ ] **Step 6: Commit**

```bash
git add lib/chat-context.ts
git commit -m "feat(context): filter expired messages and inject summary

- Add conversationSummary parameter to buildChatContext
- Filter out expired messages from chatHistory
- Inject expired conversation summary when available

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 修改 ChatWidget 集成新逻辑

**Files:**
- Modify: `components/ui/ChatWidget.tsx:100-178`

- [ ] **Step 1: 添加 onExpire 回调到 addMessage**

摘要生成已在 useChatHistory 中完成（通过 `generateSimpleSummary`），ChatWidget 只需要传入回调即可。

```typescript
// 在 handleSubmit 中调用 addMessage 时传入过期回调
const handleSubmit = async (e: React.FormEvent) => {
  // ... 现有代码 ...

  addMessage(
    { role: 'user', content: userMessage },
    {
      onExpire: (courseId: string, summary: string) => {
        // 过期时保存摘要到 userMemory
        userMemory.addConversationSummary(courseId, summary);
      }
    }
  );

  // ... 其余代码 ...
};
```

- [ ] **Step 2: Commit**

```bash
git add components/ui/ChatWidget.tsx
git commit -m "feat(chat): integrate expiration callback

- Pass onExpire callback to addMessage for summary generation
- Summary is generated by useChatHistory, saved here

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 修改 API route 传递 conversationSummary

**Files:**
- Modify: `app/api/chat/route.ts:1-42`

- [ ] **Step 1: 传递 conversationSummary 给 buildChatContext**

```typescript
export async function POST(request: NextRequest) {
  try {
    const { course, messages, userMemory, contextInfo, conversationSummary } = await request.json();

    // 构建上下文时传入摘要
    const context = buildChatContext(course, userMemory, messages, contextInfo, conversationSummary);
```

- [ ] **Step 2: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(api): pass conversationSummary to buildChatContext

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 验证构建

- [ ] **Step 1: 运行构建验证**

```bash
npm run build
```

Expected: 成功编译，无 TypeScript 错误

- [ ] **Step 2: 如有问题，修复并重新提交**

---

## 执行顺序

1. Task 1: 扩展类型定义
2. Task 2: 实现 useChatHistory 增强
3. Task 3: 扩展 useUserMemory
4. Task 4: 修改 chat-context.ts
5. Task 5: 修改 ChatWidget
6. Task 6: 修改 API route
7. Task 7: 验证构建
