# 课程创建体验优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化课程创建体验，实现课程纲要确认环节（聊天形式）、目录分离生成、cards/questions 分离生成

**Architecture:** 新增 outline/toc API，cards/questions 分离生成，确认页改为聊天页面

**Tech Stack:** Next.js 15, TypeScript, localStorage, MiniMax API

---

## 既有代码分析

### 废弃（替换）

| 文件 | 当前功能 | 处置 |
|------|---------|------|
| `app/api/generate/route.ts` | 直接生成 blueprint + treeView | 废弃 |
| `app/api/generate/node/route.ts` | 节点内容（cards + questions 一起） | 废弃 |

### 改造

| 文件 | 当前功能 | 改造内容 |
|------|---------|---------|
| `components/ClarificationScreen.tsx` | 选择题形式澄清页 | 改造为聊天确认页（支持聊天 + 确认卡片） |
| `components/GenerationLoadingScreen.tsx` | 生成中加载页 | 保留，改造用于目录生成加载 |
| `app/generate/page.tsx` | 显示 ClarificationScreen 或 GenerationLoadingScreen | 改为 topic 输入页 |
| `app/generate/confirm/page.tsx` | 新页面 | 聊天确认页（显示确认卡片、选择题、消息输入） |
| `app/course/[courseId]/page.tsx` | 显示 CourseTree | 增加课程名称/描述、第一节加载状态 |
| `app/course/[courseId]/learn/[nodeIndex]/page.tsx` | 节点学习页 | 适配新的 cards/questions 分离结构 |
| `contexts/CourseContext.tsx` | generateCourse、submitClarification 等 | 改为 submitOutlineMessage、generateToc、generateNodeCards、generateNodeQuestions |

### 复用

| 文件 | 用途 |
|------|-----|
| `components/CourseTree.tsx` | 课程目录树形展示 |
| `components/CourseNode.tsx` | 课程节点组件 |
| `components/ui/ChatWidget.tsx` | 参考 UI 样式 |
| `components/ui/ChatMessage.tsx` | 消息组件 |

---

## 新文件结构

```
app/
├── api/generate/
│   ├── outline/route.ts      # 新增：课程纲要生成
│   ├── toc/route.ts          # 新增：课程目录生成
│   └── node/
│       ├── cards/route.ts    # 新增：cards 生成
│       └── questions/route.ts # 新增：questions 生成
├── generate/
│   ├── page.tsx              # 改造：topic 输入页
│   └── confirm/page.tsx      # 改造自 ClarificationScreen：聊天确认页
├── course/[courseId]/
│   ├── page.tsx              # 改造：目录页（增加课程名称/描述）
│   └── learn/
│       └── [nodeIndex]/page.tsx # 改造：节点学习页
components/
├── ClarificationScreen.tsx    # 改造：聊天确认组件
├── ConfirmationCard.tsx      # 新增：确认卡片组件
lib/
├── prompt.ts                 # 改造：新增 outline/toc/cards/questions prompts
contexts/
├── CourseContext.tsx         # 改造：状态管理更新
```

---

## Task 1: 创建课程纲要生成 API（新增）

**Files:**
- Create: `app/api/generate/outline/route.ts`
- Modify: `lib/prompt.ts`

- [ ] **Step 1: 创建 outline API 路由**

```typescript
// app/api/generate/outline/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createMemoryRepository } from '@/lib/memory/repository';
import { buildOutlinePrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';

export async function POST(request: NextRequest) {
  const { topic, userProfile, userMemory, clarificationAnswers, userMessage } = await request.json();

  const memoryRepository = createMemoryRepository({
    initialMemory: userMemory,
    getProfile: () => userProfile || null,
  });

  const planningPayload = memoryRepository.getPlanningPayload(topic);

  const prompt = buildOutlinePrompt(topic, userProfile, planningPayload, {
    clarificationAnswers,
    userMessage,
  });

  const content = await callMiniMax(prompt);
  const result = parseJSONResponse(content);

  return NextResponse.json(result);
}
```

- [ ] **Step 2: 新增 buildOutlinePrompt 函数**

Blueprint 输出结构（课程纲要）：
```typescript
interface CourseBlueprint {
  learningDirection: string;      // 学习方向
  learningGoal: string;           // 学习目标
  learnerPositioning: {
    estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
    backgroundSummary: string;    // 个人基础总结
    skipBasics: string[];         // 已跳过的基础
  };
  nodes: Array<{
    index: number;
    title: string;
    teachingGoal: string;
  }>;
}
```

```typescript
// lib/prompt.ts 新增
export function buildOutlinePrompt(
  topic: string,
  userProfile: UserProfile | null,
  planningPayload: PlanningMemoryPayload,
  options?: { clarificationAnswers?: ClarificationAnswer[]; userMessage?: string }
): string {
  const memorySection = buildPlanningMemorySection(planningPayload);
  const profileSection = buildProfileSection(userProfile);

  let clarificationSection = '';
  if (options?.clarificationAnswers?.length) {
    clarificationSection = `## 用户回答\n${options.clarificationAnswers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n')}\n`;
  }

  let messageSection = '';
  if (options?.userMessage) {
    messageSection = `## 用户补充信息\n${options.userMessage}\n`;
  }

  return `你是 AI 导师，请基于用户背景生成课程纲要。

${profileSection}
${memorySection}
${clarificationSection}
${messageSection}
主题：${topic}

## 课程纲要结构

1. **学习方向**：这门课要讲什么，定调
2. **学习目标**：服务用户的什么目标
3. **个人基础**：根据用户背景，用熟悉的术语、例子创建，跳过已掌握内容
4. **节点结构**：课程章节安排

## 决策规则
- 信息足够 → 输出确认卡片 type: "confirmation"
- 有不确定信息 → 输出选择题 type: "questions"
- 用户发消息 → type: "reconsider"

## 输出格式
{
  "type": "confirmation"|"questions"|"reconsider",
  "blueprint": {
    "learningDirection": "学习方向描述",
    "learningGoal": "学习目标描述",
    "learnerPositioning": {
      "estimatedLevel": "novice|beginner|intermediate|advanced",
      "backgroundSummary": "个人基础总结",
      "skipBasics": ["已跳过的基础1", "已跳过的基础2"]
    },
    "nodes": [{ "index": 0, "title": "节点标题", "teachingGoal": "节点目标" }]
  },
  "questions": [{ "id": "q1", "question": "问题", "options": ["A", "B"] }]
}

只返回 JSON。`;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/generate/outline/route.ts lib/prompt.ts
git commit -m "feat: add outline generation API"
```

---

## Task 2: 创建课程目录生成 API（新增）

**Files:**
- Create: `app/api/generate/toc/route.ts`
- Modify: `lib/prompt.ts`

- [ ] **Step 1: 创建 toc API 路由**

```typescript
// app/api/generate/toc/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { buildTocPrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';

export async function POST(request: NextRequest) {
  const { blueprint } = await request.json();

  const prompt = buildTocPrompt(blueprint);
  const content = await callMiniMax(prompt);

  const result = parseJSONResponse(content);

  return NextResponse.json(result);
}
```

- [ ] **Step 2: 新增 buildTocPrompt 函数**

```typescript
// lib/prompt.ts 新增
export function buildTocPrompt(blueprint: CourseBlueprint): string {
  return `你是 AI 导师，请基于课程纲要生成课程目录。

课程纲要：
- 学习方向：${blueprint.learningDirection}
- 学习目标：${blueprint.learningGoal}
- 个人基础：${blueprint.learnerPositioning.backgroundSummary}
- 跳过的基础：${blueprint.learnerPositioning.skipBasics.join('、') || '无'}

节点列表：
${blueprint.nodes.map((n, i) => `${i + 1}. ${n.title}：${n.teachingGoal}`).join('\n')}

## 任务
1. 生成课程名称（简洁有吸引力，10-20字）
2. 生成课程描述（一句话，20-40字）
3. 为每个节点生成详细描述（1-2句话，说明这节要学什么）

## 输出格式
{
  "courseName": "课程名称",
  "courseDescription": "课程描述",
  "nodes": [{ "index": 0, "title": "节点标题", "description": "节点描述" }]
}

只返回 JSON。`;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/generate/toc/route.ts lib/prompt.ts
git commit -m "feat: add toc generation API"
```

---

## Task 3: 创建 cards/questions 分离生成 API（新增）

**Files:**
- Create: `app/api/generate/node/cards/route.ts`
- Create: `app/api/generate/node/questions/route.ts`
- Modify: `lib/prompt.ts`

- [ ] **Step 1: 创建 cards API 路由**

```typescript
// app/api/generate/node/cards/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { buildCardsPrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import type { LearningCard } from '@/types/course';

export async function POST(request: NextRequest) {
  const { topic, nodeInfo, learnerBackground, prevNodeSummary, nextNodeSummary } = await request.json();

  const prompt = buildCardsPrompt(topic, nodeInfo, learnerBackground, prevNodeSummary, nextNodeSummary);
  const content = await callMiniMax(prompt);

  const result = parseJSONResponse<{ cards: LearningCard[] }>(content);

  return NextResponse.json(result);
}
```

- [ ] **Step 2: 创建 questions API 路由**

```typescript
// app/api/generate/node/questions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { buildQuestionsPrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import type { Question } from '@/types/course';

export async function POST(request: NextRequest) {
  const { topic, nodeInfo, cards } = await request.json();

  const prompt = buildQuestionsPrompt(topic, nodeInfo, cards);
  const content = await callMiniMax(prompt);

  const result = parseJSONResponse<{ questions: Question[] }>(content);

  return NextResponse.json(result);
}
```

- [ ] **Step 3: 新增 buildCardsPrompt 函数**

```typescript
// lib/prompt.ts 新增
export function buildCardsPrompt(
  topic: string,
  nodeInfo: {
    teachingGoal: string;
    teachConceptIds: string[];
    prerequisiteConceptIds: string[];
  },
  learnerBackground: {
    backgroundSummary: string;
    skipBasics: string[];
  },
  prevNodeSummary?: { title: string; concepts: string[] };
  nextNodeSummary?: { title: string; concepts: string[] };
): string {
  let prevSection = '';
  if (prevNodeSummary) {
    prevSection = `## 前一节点（避免重复）\n${prevNodeSummary.title}：${prevNodeSummary.concepts.join('、')}\n`;
  }

  let nextSection = '';
  if (nextNodeSummary) {
    nextSection = `## 后一节点（衔接顺畅）\n${nextNodeSummary.title}：${nextNodeSummary.concepts.join('、')}\n`;
  }

  return `你是 AI 导师，请生成学习内容。

主题：${topic}
节点目标：${nodeInfo.teachingGoal}
前置概念：${nodeInfo.prerequisiteConceptIds.join('、') || '无'}

## 个人基础（用熟悉的术语和例子）
${learnerBackground.backgroundSummary}
跳过的内容：${learnerBackground.skipBasics.join('、') || '无'}
${prevSection}${nextSection}
## 内容要求
- 生成 5-8 张学习卡片
- 每张卡片包含 title、content（Markdown，150-400字）
- 可添加 visualization 字段辅助理解
- 内容循序渐进，避免与前后节点重复
- 使用用户熟悉的术语和例子

## 可视化类型
- flowchart: 流程图
- timeline: 时间线
- comparison: 对比表
- keyPoints: 核心要点

## 输出格式
{
  "cards": [{ "id": "card-1", "title": "标题", "content": "内容", "visualization": {...} }]
}

只返回 JSON。`;
}
```

- [ ] **Step 4: 新增 buildQuestionsPrompt 函数**

```typescript
// lib/prompt.ts 新增
export function buildQuestionsPrompt(
  topic: string,
  nodeInfo: {
    teachingGoal: string;
    teachConceptIds: string[];
    prerequisiteConceptIds: string[];
  },
  cards: LearningCard[]
): string {
  const cardsSection = `## 学习内容\n${cards.map(c => `【${c.title}】\n${c.content}`).join('\n\n')}`;

  return `你是 AI 导师，请基于学习内容生成问题。

主题：${topic}
节点目标：${nodeInfo.teachingGoal}
${cardsSection}

## 问题要求
- 基于上述学习内容出题
- 问题必须与知识强相关
- 3-5 道题，覆盖核心知识点
- 问题类型：single（单选）、multiple（多选）、sorting（排序）

## 输出格式
{
  "questions": [{
    "id": "q-1",
    "type": "single|multiple|sorting",
    "question": "题干",
    "options": ["A", "B", "C", "D"],
    "answer": "答案",
    "explanation": "解析"
  }]
}

只返回 JSON。`;
}
```

- [ ] **Step 5: Commit**

```bash
git add app/api/generate/node/cards/route.ts app/api/generate/node/questions/route.ts lib/prompt.ts
git commit -m "feat: add cards and questions generation APIs"
```

---

## Task 4: 改造 ClarificationScreen 为聊天确认页（改造）

**Files:**
- Modify: `components/ClarificationScreen.tsx`
- Create: `components/ConfirmationCard.tsx`
- Create: `app/generate/confirm/page.tsx`

- [ ] **Step 1: 改造 ClarificationScreen 为聊天确认组件**

```typescript
// components/ClarificationScreen.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import type { CourseBlueprint, ClarificationQuestion } from '@/types/course';
import { ChatMessage } from './ui/ChatMessage';

interface ClarificationScreenProps {
  topic: string;
  initialMessages: ChatMessage[];
  questions?: ClarificationQuestion[];
  blueprint?: CourseBlueprint;
  onConfirm: (blueprint: CourseBlueprint) => void;
  onSendMessage: (message: string) => Promise<void>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function ClarificationScreen({ topic, initialMessages, questions, blueprint, onConfirm, onSendMessage }: ClarificationScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user' as const, content: input, timestamp: Date.now() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      await onSendMessage(input);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    onConfirm(blueprint);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} />
        ))}
        {isLoading && <div className="animate-pulse">AI 思考中...</div>}
        <div ref={messagesEndRef} />
      </div>

      {!questions?.length && blueprint && (
        <ConfirmationCard blueprint={blueprint} onConfirm={handleConfirm} onEdit={() => {}} />
      )}

      <div className="border-t p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="补充信息或回答问题..."
            className="flex-1 rounded-lg border px-4 py-2"
          />
          <button onClick={handleSend} disabled={isLoading}>发送</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 ConfirmationCard 组件**

```typescript
// components/ConfirmationCard.tsx
'use client';

import type { CourseBlueprint } from '@/types/course';

interface ConfirmationCardProps {
  blueprint: CourseBlueprint;
  onConfirm: () => void;
  onEdit: () => void;
}

export function ConfirmationCard({ blueprint, onConfirm, onEdit }: ConfirmationCardProps) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-lg">
      <h3 className="font-semibold text-lg mb-3">课程纲要确认</h3>

      <div className="space-y-3 text-sm">
        <div>
          <span className="text-muted">学习方向：</span>
          <span>{blueprint.learningDirection}</span>
        </div>
        <div>
          <span className="text-muted">学习目标：</span>
          <span>{blueprint.learningGoal}</span>
        </div>
        <div>
          <span className="text-muted">你的基础：</span>
          <span>{blueprint.learnerPositioning.backgroundSummary}</span>
        </div>
        <div>
          <span className="text-muted">跳过内容：</span>
          <span>{blueprint.learnerPositioning.skipBasics.join('、') || '无'}</span>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={onConfirm} className="flex-1 bg-primary text-white rounded-lg py-2">
          确认开始生成
        </button>
        <button onClick={onEdit} className="px-4 py-2 border rounded-lg">
          修改
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建确认页面**

```typescript
// app/generate/confirm/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClarificationScreen } from '@/components/ClarificationScreen';
import { useCourse } from '@/contexts/CourseContext';

export default function ConfirmPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic') || '';
  const { submitOutlineMessage } = useCourse();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [blueprint, setBlueprint] = useState<CourseBlueprint | null>(null);

  useEffect(() => {
    fetchOutline();
  }, [topic]);

  const fetchOutline = async () => {
    const response = await fetch('/api/generate/outline', {
      method: 'POST',
      body: JSON.stringify({ topic, userProfile, userMemory }),
    });
    const data = await response.json();

    if (data.type === 'confirmation') {
      setBlueprint(data.blueprint);
      setMessages([{ role: 'assistant', content: '这是为你生成的课程纲要，请确认：', timestamp: Date.now() }]);
    } else if (data.type === 'questions') {
      setMessages([{ role: 'assistant', content: data.message || '请回答以下问题：', timestamp: Date.now() }]);
    }
  };

  const handleSendMessage = async (message: string) => {
    const response = await fetch('/api/generate/outline', {
      method: 'POST',
      body: JSON.stringify({ topic, userProfile, userMemory, userMessage: message }),
    });
    const data = await response.json();

    setMessages(prev => [...prev, { role: 'assistant', content: data.message || '', timestamp: Date.now() }]);

    if (data.type === 'confirmation') {
      setBlueprint(data.blueprint);
    }
  };

  const handleConfirm = (bp: CourseBlueprint) => {
    router.push(`/generate/toc?blueprint=${encodeURIComponent(JSON.stringify(bp))}`);
  };

  return (
    <ClarificationScreen
      topic={topic}
      initialMessages={messages}
      questions={questions}
      blueprint={blueprint}
      onConfirm={handleConfirm}
      onSendMessage={handleSendMessage}
    />
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/generate/confirm/page.tsx components/ClarificationScreen.tsx components/ConfirmationCard.tsx
git commit -m "feat: add chat confirmation page"
```

---

## Task 5: 改造 generate/page.tsx（改造）

**Files:**
- Modify: `app/generate/page.tsx`

改造为简单的 topic 输入页，用户输入后跳转到确认页。

- [ ] **Step 1: 改造 generate page**

```typescript
// app/generate/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GeneratePage() {
  const router = useRouter();
  const [topic, setTopic] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (topic.trim()) {
      router.push(`/generate/confirm?topic=${encodeURIComponent(topic)}`);
    }
  };

  return (
    <main className="min-h-[100svh] flex items-center justify-center bg-background p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">你想学习什么？</h1>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="例如：React Hooks 深入理解"
          className="w-full rounded-xl border p-4 min-h-[120px] resize-none"
        />
        <button
          type="submit"
          disabled={!topic.trim()}
          className="w-full mt-4 bg-primary text-white rounded-xl py-3 font-medium disabled:opacity-50"
        >
          开始
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/generate/page.tsx
git commit -m "refactor: simplify generate page to topic input"
```

---

## Task 6: 改造 CourseContext（改造）

**Files:**
- Modify: `contexts/CourseContext.tsx`

- [ ] **Step 1: 移除旧函数，添加新函数**

移除：
- generateCourse
- submitClarification

新增：
- submitOutlineMessage
- generateToc
- generateNodeCards
- generateNodeQuestions

```typescript
// CourseContext.tsx
interface CourseContextType {
  // 移除：generateCourse, submitClarification, clarification, setClarification, retryCourseGeneration

  // 新增：
  submitOutlineMessage: (topic: string, message: string) => Promise<OutlineResponse>;
  generateToc: (blueprint: CourseBlueprint) => Promise<TocResponse>;
  generateNodeCards: (courseId: string, nodeIndex: number, options: CardGenOptions) => Promise<{ cards: LearningCard[] }>;
  generateNodeQuestions: (courseId: string, nodeIndex: number) => Promise<{ questions: Question[] }>;
}
```

- [ ] **Step 2: 实现新函数**

```typescript
const submitOutlineMessage = useCallback(async (topic: string, message: string) => {
  const response = await fetch('/api/generate/outline', {
    method: 'POST',
    body: JSON.stringify({
      topic,
      userProfile: getUserProfile(),
      userMemory: getUserMemoryStoreSnapshot(),
      userMessage: message,
    }),
  });
  return response.json();
}, []);

const generateToc = useCallback(async (blueprint: CourseBlueprint) => {
  const response = await fetch('/api/generate/toc', {
    method: 'POST',
    body: JSON.stringify({ blueprint }),
  });
  return response.json();
}, []);

const generateNodeCards = useCallback(async (
  courseId: string,
  nodeIndex: number,
  options: {
    learnerBackground: { backgroundSummary: string; skipBasics: string[] };
    prevNodeSummary?: { title: string; concepts: string[] };
    nextNodeSummary?: { title: string; concepts: string[] };
  }
) => {
  const bundle = getStoredCourseBundle(courseId);
  if (!bundle) throw new Error('Course bundle not found');

  const node = bundle.blueprint.nodes[nodeIndex];

  const response = await fetch('/api/generate/node/cards', {
    method: 'POST',
    body: JSON.stringify({
      topic: bundle.blueprint.topic,
      nodeInfo: {
        teachingGoal: node.teachingGoal,
        teachConceptIds: node.teachConceptIds,
        prerequisiteConceptIds: node.prerequisiteConceptIds,
      },
      learnerBackground: options.learnerBackground,
      prevNodeSummary: options.prevNodeSummary,
      nextNodeSummary: options.nextNodeSummary,
    }),
  });

  return response.json();
}, []);

const generateNodeQuestions = useCallback(async (courseId: string, nodeIndex: number) => {
  const bundle = getStoredCourseBundle(courseId);
  if (!bundle) throw new Error('Course bundle not found');

  const node = bundle.blueprint.nodes[nodeIndex];
  const lesson = bundle.lessons[nodeIndex];

  const response = await fetch('/api/generate/node/questions', {
    method: 'POST',
    body: JSON.stringify({
      topic: bundle.blueprint.topic,
      nodeInfo: {
        teachingGoal: node.teachingGoal,
        teachConceptIds: node.teachConceptIds,
        prerequisiteConceptIds: node.prerequisiteConceptIds,
      },
      cards: lesson.cards,
    }),
  });

  return response.json();
}, []);
```

- [ ] **Step 3: Commit**

```bash
git add contexts/CourseContext.tsx
git commit -m "refactor: update CourseContext for new course creation flow"
```

---

## Task 7: 改造课程目录页（改造）

**Files:**
- Modify: `app/course/[courseId]/page.tsx`

显示：
- 课程名称
- 课程描述
- 节点列表
- 第一节加载状态

```typescript
// app/course/[courseId]/page.tsx
export default function CoursePage({ params }: { params: { courseId: string } }) {
  const { currentCourse, generateNodeCards, generateNodeQuestions } = useCourse();
  const [firstNodeLoading, setFirstNodeLoading] = useState(true);

  useEffect(() => {
    if (currentCourse && !currentCourse.nodes[0].cards) {
      generateFirstNode();
    }
  }, [currentCourse]);

  const generateFirstNode = async () => {
    const courseId = currentCourse.courseId;
    const nodeIndex = 0;
    const blueprint = currentCourse.blueprint;

    const prevNode = nodeIndex > 0 ? { title: blueprint.nodes[nodeIndex-1].title, concepts: blueprint.nodes[nodeIndex-1].teachConceptIds } : undefined;
    const nextNode = nodeIndex < blueprint.nodes.length - 1 ? { title: blueprint.nodes[nodeIndex+1].title, concepts: blueprint.nodes[nodeIndex+1].teachConceptIds } : undefined;

    const { cards } = await generateNodeCards(courseId, nodeIndex, {
      learnerBackground: blueprint.learnerPositioning,
      prevNodeSummary: prevNode,
      nextNodeSummary: nextNode,
    });

    const { questions } = await generateNodeQuestions(courseId, nodeIndex);

    updateNodeLesson(courseId, nodeIndex, { cards, questions });
    setFirstNodeLoading(false);
  };

  // 渲染目录...
}
```

- [ ] **Step 2: Commit**

```bash
git add app/course/[courseId]/page.tsx
git commit -m "feat: integrate course creation flow in course page"
```

---

## Task 8: 清理废弃代码（改造）

**Files:**
- Modify: `app/api/generate/route.ts`（内容替换为 404）
- Modify: `app/api/generate/node/route.ts`（内容替换为 404）

- [ ] **Step 1: 替换废弃 API 为 404**

```typescript
// app/api/generate/route.ts
// 废弃，返回 404
export async function POST() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
```

```typescript
// app/api/generate/node/route.ts
// 废弃，返回 404
export async function POST() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/generate/route.ts app/api/generate/node/route.ts
git commit -m "chore: replace deprecated APIs with 404"
```

---

## Task 9: 改造节点学习页（改造）

**Files:**
- Modify: `app/course/[courseId]/learn/[nodeIndex]/page.tsx`

适配新的 cards/questions 分离结构。

- [ ] **Step 1: 查看当前节点学习页**

```typescript
// app/course/[courseId]/learn/[nodeIndex]/page.tsx
// 当前结构：cards 和 questions 在 NodeLesson 中一起存在
// 新结构：cards 和 questions 分开存储
```

- [ ] **Step 2: Commit**

```bash
git add app/course/[courseId]/learn/[nodeIndex]/page.tsx
git commit -m "feat: adapt node learning page for separated cards/questions"
```

---

## 测试要点

1. **API 测试**
   - outline API 返回正确的 blueprint 结构
   - toc API 生成有意义的目录
   - cards 使用 learnerBackground + 前后节点信息
   - questions 基于 cards 内容生成

2. **组件测试**
   - ClarificationScreen 聊天交互正常
   - ConfirmationCard 正确显示 blueprint 信息
   - generate/page.tsx 正确跳转

3. **集成测试**
   - 完整流程：输入 topic → 聊天确认 → 目录 → 内容生成

---

## 依赖关系

```
Task 1 (outline API)
    ↓
Task 2 (toc API)
    ↓
Task 3 (cards/questions APIs)
    ↓
Task 6 (CourseContext)  ← 依赖 Task 1，因为定义 submitOutlineMessage
    ↓
Task 4 (ClarificationScreen)  ← 依赖 Task 6，使用 submitOutlineMessage
    ↓
Task 5 (generate/page.tsx)
    ↓
Task 7 (目录页)
    ↓
Task 8 (清理废弃代码)
    ↓
Task 9 (节点学习页)
    ↓
Task 10 (错误重答中间页)  ← 新增
    ↓
Task 11 (结束庆祝页)  ← 新增
```

---

## Task 10: 错误重答中间页（新增）

**Files:**
- Create: `components/RetryQuizScreen.tsx`

用户答完所有题后，如果有错误题，通过中间页让用户重新作答。

```typescript
// components/RetryQuizScreen.tsx
interface RetryQuizScreenProps {
  wrongQuestions: Question[];
  onRetry: () => void;
  onSkip: () => void;
}

export function RetryQuizScreen({ wrongQuestions, onRetry, onSkip }: RetryQuizScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <h2 className="text-2xl font-bold mb-4">还有 {wrongQuestions.length} 道题需要再练习</h2>
      <p className="text-secondary mb-8">别担心，再试一次你会做得更好！</p>
      <button onClick={onRetry} className="bg-primary text-white rounded-xl px-8 py-3">
        重新作答
      </button>
      <button onClick={onSkip} className="mt-4 text-secondary">
        先跳过
      </button>
    </div>
  );
}
```

---

## Task 11: 结束庆祝页（新增）

**Files:**
- Create: `app/course/[courseId]/complete/page.tsx`

全部完成后给正反馈，有主按钮"进入下一节"和次按钮"返回目录"。

```typescript
// app/course/[courseId]/complete/page.tsx
interface CompletePageProps {
  courseId: string;
  nextNodeIndex: number;
  onNext: () => void;
  onBackToToc: () => void;
}

export function CompletePage({ courseId, nextNodeIndex, onNext, onBackToToc }: CompletePageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="text-6xl mb-6">🎉</div>
      <h1 className="text-3xl font-bold mb-4">太棒了！</h1>
      <p className="text-secondary mb-8 text-center">你已经完成了这一节的学习</p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button onClick={onNext} className="bg-primary text-white rounded-xl py-3 font-medium">
          进入下一节
        </button>
        <button onClick={onBackToToc} className="border rounded-xl py-3 text-secondary">
          返回课程目录
        </button>
      </div>
    </div>
  );
}
```

---

## Task 12: 每节生成后自动生成后续问题（改造）

当前 Task 7 只在第一节实现了自动生成。需要在目录页/节点学习页中确保：
- 每节内容生成完成后，自动触发该节的问题生成
- 后续节点也遵循同样的模式

此任务应与 Task 7（目录页）和 Task 9（节点学习页）结合实现。
