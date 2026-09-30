# 课程助理 + 用户记忆系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现课程助理（AI 对话）+ 用户记忆系统

**Architecture:**
- 前端：ChatWidget 组件（基于 assistant-ui） + 页面集成
- 后端：/api/chat SSE 流式接口
- 存储：localStorage（chatHistory_{courseId} + userMemory）
- 上下文：buildChatContext 综合课程内容 + 用户记忆 + 对话历史

**Tech Stack:** Next.js App Router, TypeScript, localStorage, MiniMax API (SSE), assistant-ui

---

## 文件结构

```
新建文件:
- types/chat.ts                              # ChatMessage 类型
- hooks/useChatHistory.ts                     # 对话历史 hook
- hooks/useUserMemory.ts                      # 用户记忆 hook
- lib/chat-context.ts                        # 构建对话上下文
- app/api/chat/route.ts                      # 对话 API (SSE)
- components/ui/ChatMessage.tsx              # 消息展示组件
- components/ui/ChatWidget.tsx               # 聊天对话框组件

修改文件:
- types/course.ts                            # 添加 UserMemory 等类型
- lib/minimax.ts                             # 添加 callMiniMaxChatStream
- app/course/[courseId]/page.tsx            # 添加助理按钮
- app/course/[courseId]/learn/[nodeIndex]/page.tsx  # 添加助理按钮
- components/CourseTree.tsx                  # 添加助理按钮
```

---

## Task 1: 创建类型定义

**Files:**
- Create: `types/chat.ts`

- [ ] **Step 1: 创建 types/chat.ts**

```typescript
// types/chat.ts

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}
```

- [ ] **Step 2: 提交**

```bash
git add types/chat.ts
git commit -m "feat(chat): add ChatMessage type

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 扩展 types/course.ts 添加 UserMemory

**Files:**
- Modify: `types/course.ts:133` (末尾添加)

- [ ] **Step 1: 添加 UserMemory 相关类型到 types/course.ts**

在文件末尾添加:

```typescript
// UserMemory 子类型
export interface Interest {
  topic: string;
  weight: number;           // 1-5
  source: 'course' | 'chat';
  courseId?: string;
  lastInteraction: number;
}

export interface KnowledgeGap {
  concept: string;
  topic: string;
  evidence: string[];
  severity: 'high' | 'medium' | 'low';
}

export interface QuestionPattern {
  question: string;
  topic: string;
  timestamp: number;
}

export interface LearningRecord {
  courseId: string;
  topic: string;
  nodesCompleted: number;
  totalNodes: number;
  completedAt?: number;
}

export interface ExtractedInsights {
  interests: Interest[];
  knowledgeGaps: KnowledgeGap[];
  questionPatterns: QuestionPattern[];
}

export interface UserMemory {
  profile: UserProfile;
  learningHistory: LearningRecord[];
  extractedInsights: ExtractedInsights;
  lastUpdated: number;
  version: number;
}
```

- [ ] **Step 2: 提交**

```bash
git add types/course.ts
git commit -m "feat(types): add UserMemory and related types

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 创建 useChatHistory hook

**Files:**
- Create: `hooks/useChatHistory.ts`

- [ ] **Step 1: 创建 hooks/useChatHistory.ts**

```typescript
// hooks/useChatHistory.ts
import { ChatMessage } from '@/types/chat';

const CHAT_HISTORY_PREFIX = 'chatHistory_';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useChatHistory(courseId: string) {
  const getMessages = (): ChatMessage[] => {
    if (typeof window === 'undefined') return [];

    try {
      const raw = localStorage.getItem(`${CHAT_HISTORY_PREFIX}${courseId}`);
      if (!raw) return [];
      return JSON.parse(raw) as ChatMessage[];
    } catch {
      return [];
    }
  };

  const addMessage = (message: Omit<ChatMessage, 'id' | 'timestamp'>): void => {
    if (typeof window === 'undefined') return;

    const messages = getMessages();
    const newMessage: ChatMessage = {
      ...message,
      id: generateId(),
      timestamp: Date.now(),
    };
    messages.push(newMessage);

    try {
      localStorage.setItem(`${CHAT_HISTORY_PREFIX}${courseId}`, JSON.stringify(messages));
    } catch {
      // localStorage 可能已满，忽略
    }
  };

  const clearHistory = (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(`${CHAT_HISTORY_PREFIX}${courseId}`);
  };

  return {
    messages: getMessages(),
    addMessage,
    clearHistory,
  };
}
```

- [ ] **Step 2: 提交**

```bash
git add hooks/useChatHistory.ts
git commit -m "feat(chat): add useChatHistory hook

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 创建 useUserMemory hook

**Files:**
- Create: `hooks/useUserMemory.ts`

- [ ] **Step 1: 创建 hooks/useUserMemory.ts**

```typescript
// hooks/useUserMemory.ts
import { UserMemory, Interest, KnowledgeGap, QuestionPattern, LearningRecord } from '@/types/course';
import { getUserProfile } from '@/lib/storage';

const USER_MEMORY_KEY = 'userMemory';

const defaultMemory: UserMemory = {
  profile: null as any,
  learningHistory: [],
  extractedInsights: {
    interests: [],
    knowledgeGaps: [],
    questionPatterns: [],
  },
  lastUpdated: Date.now(),
  version: 1,
};

function getMemory(): UserMemory {
  if (typeof window === 'undefined') return defaultMemory;

  try {
    const raw = localStorage.getItem(USER_MEMORY_KEY);
    if (!raw) {
      // 首次初始化，合并 userProfile
      const profile = getUserProfile();
      const memory = { ...defaultMemory, profile };
      localStorage.setItem(USER_MEMORY_KEY, JSON.stringify(memory));
      return memory;
    }
    return JSON.parse(raw) as UserMemory;
  } catch {
    return defaultMemory;
  }
}

function saveMemory(memory: UserMemory): void {
  if (typeof window === 'undefined') return;
  memory.lastUpdated = Date.now();
  localStorage.setItem(USER_MEMORY_KEY, JSON.stringify(memory));
}

export function useUserMemory() {
  const memory = getMemory();

  const updateInterests = (topic: string, source: 'course' | 'chat', courseId?: string): void => {
    const interests = memory.extractedInsights.interests;
    const existing = interests.find(i => i.topic === topic);

    if (existing) {
      existing.weight = Math.min(5, existing.weight + (source === 'course' ? 2 : 1));
      existing.lastInteraction = Date.now();
    } else {
      interests.push({
        topic,
        weight: 1,
        source,
        courseId,
        lastInteraction: Date.now(),
      });
    }

    saveMemory(memory);
  };

  const addKnowledgeGap = (concept: string, topic: string, evidence: string): void => {
    const gaps = memory.extractedInsights.knowledgeGaps;
    const existing = gaps.find(g => g.concept === concept && g.topic === topic);

    if (existing) {
      if (!existing.evidence.includes(evidence)) {
        existing.evidence.push(evidence);
      }
      // 多次问到，提高 severity
      if (existing.severity === 'low') existing.severity = 'medium';
    } else {
      gaps.push({
        concept,
        topic,
        evidence: [evidence],
        severity: 'low',
      });
    }

    saveMemory(memory);
  };

  const addQuestionPattern = (question: string, topic: string): void => {
    memory.extractedInsights.questionPatterns.push({
      question,
      topic,
      timestamp: Date.now(),
    });
    saveMemory(memory);
  };

  const addLearningRecord = (record: Omit<LearningRecord, 'completedAt'>): void => {
    const existing = memory.learningHistory.find(h => h.courseId === record.courseId);
    if (existing) {
      existing.nodesCompleted = record.nodesCompleted;
      existing.completedAt = Date.now();
    } else {
      memory.learningHistory.push({
        ...record,
        completedAt: Date.now(),
      });
    }
    saveMemory(memory);
  };

  // 标记节点完成（更新对应 learningRecord 的完成时间）
  const markNodeCompleted = (courseId: string): void => {
    const record = memory.learningHistory.find(h => h.courseId === courseId);
    if (record) {
      record.completedAt = Date.now();
      saveMemory(memory);
    }
  };

  return {
    userMemory: memory,
    updateInterests,
    addKnowledgeGap,
    addQuestionPattern,
    addLearningRecord,
    markNodeCompleted,
  };
}
```

- [ ] **Step 2: 提交**

```bash
git add hooks/useUserMemory.ts
git commit -m "feat(memory): add useUserMemory hook

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 扩展 lib/minimax.ts 添加流式方法

**Files:**
- Modify: `lib/minimax.ts` (末尾添加)

- [ ] **Step 1: 添加 callMiniMaxChatStream 方法**

在 `lib/minimax.ts` 末尾添加:

```typescript
export async function callMiniMaxChatStream(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<Response> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY is not set');

  const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7',
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax API error: ${response.status} - ${errorText}`);
  }

  // 返回 SSE 流
  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

- [ ] **Step 2: 提交**

```bash
git add lib/minimax.ts
git commit -m "feat(api): add callMiniMaxChatStream for SSE

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 创建 lib/chat-context.ts

**Files:**
- Create: `lib/chat-context.ts`

- [ ] **Step 1: 创建 lib/chat-context.ts**

```typescript
// lib/chat-context.ts
import { CourseNode, UserMemory } from '@/types/course';
import { ChatMessage } from '@/types/chat';

export function buildChatContext(
  course: CourseNode,
  userMemory: UserMemory,
  chatHistory: ChatMessage[]
): string {
  // 提取当前课程相关的兴趣和薄弱点
  const relevantGaps = userMemory.extractedInsights.knowledgeGaps
    .filter(g => g.topic === course.topic || g.severity === 'high')
    .slice(0, 3);

  const relevantInterests = userMemory.extractedInsights.interests
    .filter(i => i.topic === course.topic)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  // 构建高权重问题模式
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

- [ ] **Step 2: 提交**

```bash
git add lib/chat-context.ts
git commit -m "feat(chat): add buildChatContext

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 创建 /api/chat route

**Files:**
- Create: `app/api/chat/route.ts`

- [ ] **Step 1: 创建 app/api/chat/route.ts**

```typescript
// app/api/chat/route.ts
import { NextRequest } from 'next/server';
import { buildChatContext } from '@/lib/chat-context';
import { callMiniMaxChatStream } from '@/lib/minimax';

// 注意：由于 Edge Runtime 无法访问 localStorage，课程数据从请求体传入
// 备选方案：如遇问题，可移除 `export const runtime = 'edge'` 改用默认 nodejs runtime

export async function POST(request: NextRequest) {
  try {
    const { course, messages, currentNodeIndex, userMemory } = await request.json();

    // course 对象从客户端传入
    if (!course) {
      return new Response('Course not found', { status: 404 });
    }

    // 获取当前节点
    const nodeIndex = currentNodeIndex ?? course.nodes.findIndex(n => n.status !== 'completed') ?? 0;
    const currentNode = course.nodes[nodeIndex];

    if (!currentNode) {
      return new Response('Node not found', { status: 404 });
    }

    // 构建上下文（使用传入的 userMemory）
    const context = buildChatContext(currentNode, userMemory, messages);

    // 构建 AI 消息
    const aiMessages = [
      { role: 'system' as const, content: context },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    // 流式返回
    return await callMiniMaxChatStream(aiMessages);
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response('Internal error', { status: 500 });
  }
}
```

**注意:** 由于 Edge Runtime 限制，课程数据和 userMemory 从请求体传入。这种方式信任客户端提交的数据，生产环境应添加验证。

- [ ] **Step 2: 提交**

```bash
git add app/api/chat/route.ts
git commit -m "feat(api): add /api/chat SSE endpoint

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: 创建 ChatMessage 组件

**Files:**
- Create: `components/ui/ChatMessage.tsx`

- [ ] **Step 1: 创建 components/ui/ChatMessage.tsx**

```tsx
// components/ui/ChatMessage.tsx
'use client';

import { ChatMessage as ChatMessageType } from '@/types/chat';
import ReactMarkdown from 'react-markdown';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-accent text-white rounded-br-md'
            : 'bg-subtle text-primary rounded-bl-md'
        }`}
      >
        {isUser ? (
          <p className="text-sm">{message.content}</p>
        ) : (
          <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add components/ui/ChatMessage.tsx
git commit -m "feat(chat): add ChatMessage component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: 创建 ChatWidget 组件

**Files:**
- Create: `components/ui/ChatWidget.tsx`

- [ ] **Step 1: 创建 components/ui/ChatWidget.tsx**

```tsx
// components/ui/ChatWidget.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useUserMemory } from '@/hooks/useUserMemory';
import { ChatMessage as ChatMessageType } from '@/types/chat';

// 简化概念提取：取 "X是什么" 中的 X 或前 10 个字符
function extractSimpleConcept(text: string): string {
  const match = text.match(/([^，,？?\s]{2,10})(是什么|为什么|如何|怎么)/);
  return match ? match[1] : text.slice(0, 10);
}

interface ChatWidgetProps {
  courseId: string;
  courseTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ChatWidget({ courseId, courseTitle, isOpen, onClose }: ChatWidgetProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const { messages, addMessage } = useChatHistory(courseId);
  const userMemory = useUserMemory();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);
    setStreamingContent('');

    // 添加用户消息
    addMessage({ role: 'user', content: userMessage });

    try {
      // 从 localStorage 获取完整课程对象（客户端组件可直接访问）
      const { getStoredData } = await import('@/lib/storage');
      const storedData = getStoredData();
      const course = storedData.courses.find(c => c.courseId === courseId);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course,
          messages: [...messages, { role: 'user', content: userMessage }],
          userMemory: userMemory.userMemory,
        }),
      });

      if (!response.ok) throw new Error('Failed to get response');

      // 处理 SSE 流
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let fullContent = '';
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        // MiniMax SSE 格式: data: {"choices":[{"delta":{"content":"..."}}]}\n\n
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                setStreamingContent(fullContent);
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      // 添加完整的 assistant 消息
      addMessage({ role: 'assistant', content: fullContent });
      setStreamingContent('');

      // 对话完成后更新记忆
      const allMessages = [...messages, { role: 'user' as const, content: userMessage }];
      const lastUserMessage = allMessages.filter(m => m.role === 'user').pop();
      if (lastUserMessage) {
        const currentTopic = courseTitle;
        userMemory.addQuestionPattern(lastUserMessage.content, currentTopic);

        // 简单薄弱点检测
        const simplePatterns = ['是什么', '为什么', '如何', '怎么', '区别', '关系'];
        const hasConfusion = simplePatterns.some(p => lastUserMessage.content.includes(p));
        if (hasConfusion) {
          const concept = extractSimpleConcept(lastUserMessage.content);
          userMemory.addKnowledgeGap(concept, currentTopic, lastUserMessage.content);
        }

        userMemory.updateInterests(currentTopic, 'chat', courseId);
      }
    } catch (error) {
      console.error('Chat error:', error);
      addMessage({ role: 'assistant', content: '抱歉，发生了错误。请稍后再试。' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-3xl w-full max-w-md mx-4 h-[600px] max-h-[80vh] flex flex-col shadow-float">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-subtle">
          <h2 className="font-bold text-primary">课程助理</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-subtle flex items-center justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map(msg => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          {streamingContent && (
            <ChatMessage
              message={{
                id: 'streaming',
                role: 'assistant',
                content: streamingContent,
                timestamp: Date.now(),
              }}
            />
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-subtle">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="输入你的问题..."
              className="flex-1 px-4 py-2 rounded-xl bg-subtle text-primary placeholder-secondary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-2 rounded-xl bg-accent text-white font-medium text-sm hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? '...' : '发送'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add components/ui/ChatWidget.tsx
git commit -m "feat(chat): add ChatWidget component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: 安装 react-markdown 依赖

**Files:**
- (None - 依赖安装)

- [ ] **Step 1: 安装 react-markdown**

```bash
npm install react-markdown
```

**说明:** ChatWidget 使用自定义实现（原生 fetch + SSE + react-markdown），暂不使用 assistant-ui。如后续需要更复杂的聊天功能，可再评估。

- [ ] **Step 2: 提交**

```bash
git add package.json package-lock.json
git commit -m "deps: add react-markdown for chat components

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: 页面集成 - 课程页

**Files:**
- Modify: `app/course/[courseId]/page.tsx`

- [ ] **Step 1: 读取现有文件结构**

```bash
head -100 app/course/[courseId]/page.tsx
```
重点关注：已有的 useState 位置、return JSX 的结构、按钮放置的合适位置

- [ ] **Step 2: 添加 ChatWidget 导入和状态**

在文件顶部（其他 import 附近）添加:
```tsx
import { ChatWidget } from '@/components/ui/ChatWidget';
```

在已有的 useState 下方或附近添加:
```tsx
const [chatOpen, setChatOpen] = useState(false);
```

- [ ] **Step 3: 添加唤起按钮**

在 return 的 JSX 中找一个合适位置放置按钮（如页面右下角，在主内容之后）:
```tsx
<button
  onClick={() => setChatOpen(true)}
  className="fixed bottom-24 right-6 w-14 h-14 rounded-full bg-accent text-white shadow-lg hover:scale-105 transition z-40"
>
  <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
</button>
```

- [ ] **Step 4: 添加 ChatWidget**

在 return 的 JSX 末尾（`</div>` 之前）添加:
```tsx
<ChatWidget
  courseId={course?.courseId || ''}
  courseTitle={course?.topic || ''}
  isOpen={chatOpen}
  onClose={() => setChatOpen(false)}
/>
```

- [ ] **Step 5: 提交**

```bash
git add app/course/[courseId]/page.tsx
git commit -m "feat(chat): integrate ChatWidget in course page

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: 页面集成 - 学习页

**Files:**
- Modify: `app/course/[courseId]/learn/[nodeIndex]/page.tsx`

- [ ] **Step 1: 读取现有文件结构**

```bash
head -50 "app/course/[courseId]/learn/[nodeIndex]/page.tsx"
```

- [ ] **Step 2: 添加 ChatWidget 导入和状态**

参考 Task 11 的修改方式

- [ ] **Step 3: 提交**

```bash
git add "app/course/[courseId]/learn/[nodeIndex]/page.tsx"
git commit -m "feat(chat): integrate ChatWidget in learn page

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: 页面集成 - CourseTree 组件

**Files:**
- Modify: `components/CourseTree.tsx`

- [ ] **Step 1: 读取现有文件结构**

```bash
head -50 components/CourseTree.tsx
```

- [ ] **Step 2: 添加 ChatWidget 导入和状态**

参考 Task 11 的修改方式

- [ ] **Step 3: 提交**

```bash
git add components/CourseTree.tsx
git commit -m "feat(chat): integrate ChatWidget in CourseTree

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: 用户记忆更新 - 节点完成时更新

**注意:** Task 9 的 ChatWidget 组件已包含对话后的记忆更新逻辑（useUserMemory hook 在 Task 9 中已导入）。

此 Task 仅处理 LearnFlow 中的节点完成记忆更新。

**Files:**
- Modify: `components/LearnFlow.tsx`

- [ ] **Step 1: 读取 LearnFlow.tsx**

```bash
head -100 components/LearnFlow.tsx
```
重点关注：节点完成的处理函数、course 和 node 变量的可访问性

- [ ] **Step 2: 添加 useUserMemory 导入**

在文件顶部添加:
```tsx
import { useUserMemory } from '@/hooks/useUserMemory';
```

- [ ] **Step 3: 在组件内获取 userMemory hook**

在组件函数内部添加:
```tsx
const userMemory = useUserMemory();
```

- [ ] **Step 4: 在节点完成时调用记忆更新**

找到 `markNodeCompleted` 调用处，在其下方添加:
```tsx
// 更新用户记忆
userMemory.addLearningRecord({
  courseId,
  topic: node.title,
  nodesCompleted: nodeIndex + 1,
  totalNodes: course.totalNodes
});
userMemory.updateInterests(node.title, 'course', courseId);
```

- [ ] **Step 5: 提交**

```bash
git add components/LearnFlow.tsx
git commit -m "feat(memory): update userMemory on node completion

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 15: 本地验证

- [ ] **Step 1: 启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 2: 验证功能**

1. 打开课程页，确认助理按钮显示
2. 点击按钮，确认对话框正常打开
3. 发送消息，确认流式输出正常
4. 刷新页面，确认对话历史持久化
5. 完成课程节点后，检查 localStorage 确认 userMemory 更新

- [ ] **Step 3: 提交验证修改**

```bash
git add -A
git commit -m "docs: add verification notes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 验证清单

- [ ] 对话能基于当前课程内容回答
- [ ] 流式输出正常工作
- [ ] 对话历史按 courseId 隔离存储
- [ ] userMemory 正确初始化（合并 userProfile）
- [ ] 对话后 questionPatterns 更新
- [ ] 对话后 interests 权重 +1
- [ ] 对话后 knowledgeGaps 检测（问"是什么/为什么"时）
- [ ] 节点完成后 learningHistory 更新
- [ ] 节点完成后 interests 权重 +2
- [ ] 刷新后对话历史仍然存在
