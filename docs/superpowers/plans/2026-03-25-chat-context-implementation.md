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

- [ ] **Step 2: 添加 isFollowUp 追问识别函数**

```typescript
function isFollowUp(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length <= 15 && /[？?]$/.test(trimmed);
}
```

- [ ] **Step 3: 添加 groupMessagesIntoPairs 函数（按问答对分组）**

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

- [ ] **Step 4: 添加 truncateByPairs 函数（按问答对截断）**

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

- [ ] **Step 5: 添加 checkAndHandleExpiration 函数**

```typescript
async function checkAndHandleExpiration(
  courseId: string,
  messages: ChatMessage[],
  onGenerateSummary: (courseId: string, messages: ChatMessage[]) => Promise<void>
): Promise<ChatMessage[]> {
  if (messages.length === 0) return messages;

  const lastMessage = messages[messages.length - 1];
  const daysSinceLastMessage = (Date.now() - lastMessage.timestamp) / (1000 * 60 * 60 * 24);

  if (daysSinceLastMessage > EXPIRATION_DAYS) {
    // 异步生成摘要，不阻塞
    onGenerateSummary(courseId, messages).catch(console.error);

    // 标记所有消息为已过期
    return messages.map(m => ({ ...m, isExpired: true }));
  }

  return messages;
}
```

- [ ] **Step 6: 修改 addMessage 函数**

```typescript
const addMessage = useCallback((
  message: Omit<ChatMessage, 'id' | 'timestamp' | 'isExpired'>,
  onExpire?: (courseId: string, messages: ChatMessage[]) => Promise<void>
): void => {
  // ... 现有逻辑 ...

  // 添加后检查是否需要截断
  let updatedMessages = [...messages, newMessage];

  // 按问答对截断
  const pairs = groupMessagesIntoPairs(updatedMessages);
  if (pairs.length > MAX_MESSAGE_PAIRS || calculateTotalChars(pairs) > MAX_TOTAL_CHARS) {
    updatedMessages = truncateByPairs(updatedMessages, MAX_MESSAGE_PAIRS, MAX_TOTAL_CHARS);
  }

  // 检查过期（异步）
  if (onExpire) {
    checkAndHandleExpiration(courseId, updatedMessages, onExpire).then(expiredMsgs => {
      if (expiredMsgs.some(m => m.isExpired)) {
        localStorage.setItem(`${CHAT_HISTORY_PREFIX}${courseId}`, JSON.stringify(expiredMsgs));
      }
    });
  }

  localStorage.setItem(`${CHAT_HISTORY_PREFIX}${courseId}`, JSON.stringify(updatedMessages));
}, [courseId, getMessages]);
```

- [ ] **Step 7: Commit**

```bash
git add hooks/useChatHistory.ts
git commit -m "feat(chat): add Q&A pair truncation and expiration check

- Add isFollowUp() for follow-up detection
- Add groupMessagesIntoPairs() to group messages into Q&A pairs
- Add truncateByPairs() for intelligent truncation
- Add checkAndHandleExpiration() for 7-day expiration
- Update addMessage() to use new truncation logic

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

  // 限制数量，超出则删除最旧的
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

- [ ] **Step 1: 修改 handleSubmit 中的 addMessage 调用**

```typescript
// 生成摘要的异步函数
const generateSummary = async (courseId: string, messages: ChatMessage[]) => {
  // 构建摘要 prompt
  const summaryPrompt = `请用一句话概括以下对话的主要内容，不超过50字：\n\n${
    messages.map(m => `${m.role === 'user' ? '用户' : '助理'}：${m.content}`).join('\n')
  }`;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course: { courseId, topic: courseTitle, nodes: [], difficultySummary: '' },
        messages: [{ role: 'user', content: summaryPrompt }],
        userMemory: { extractedInsights: { interests: [], knowledgeGaps: [], questionPatterns: [] } },
      }),
    });

    if (!response.ok) return;

    // 简单处理：取响应文本作为摘要
    const text = await response.text();
    // 从 SSE 响应中提取内容
    const contentMatch = text.match(/data:\s*(\{.*?\})/);
    if (contentMatch) {
      try {
        const data = JSON.parse(contentMatch[1]);
        const summary = data.choices?.[0]?.delta?.content || '对话摘要';
        userMemory.addConversationSummary(courseId, summary.slice(0, 100));
      } catch {
        // 解析失败，使用默认摘要
        userMemory.addConversationSummary(courseId, '用户询问了课程相关问题');
      }
    }
  } catch (error) {
    console.error('Failed to generate summary:', error);
  }
};
```

- [ ] **Step 2: 修改 addMessage 调用**

```typescript
addMessage(
  { role: 'user', content: userMessage },
  generateSummary  // 传入过期处理回调
);
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/ChatWidget.tsx
git commit -m "feat(chat): integrate expiration and summary generation

- Add generateSummary function for expired conversations
- Pass expiration handler to addMessage
- Update API call to use new context building

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
