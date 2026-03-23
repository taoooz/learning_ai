# 个性化 AI 学习产品 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个完整的 Demo，用户输入兴趣主题 → AI 生成学习路径 → Duolingo 式闯关学习

**Architecture:** Next.js App Router，前端直连 MiniMax API，React Context 状态管理，localStorage 持久化

**Tech Stack:** Next.js, TypeScript, React Context, localStorage, MiniMax API

---

## 文件结构

```
/app
  /page.tsx                        # 主题输入页
  /generate/page.tsx                # AI 生成中
  /course/[courseId]/page.tsx      # 课程详情页
  /course/[courseId]/learn/[nodeIndex]/page.tsx # 单元学习页
  /api/generate/route.ts          # AI 生成 API

/components
  /ui
    /ProgressBar.tsx               # 进度条
    /LoadingSpinner.tsx            # 加载动画
  /CourseTree.tsx                  # 课程树容器
  /CourseNode.tsx                  # 单个节点
  /LearningCardStack.tsx           # 学习卡片栈（支持滑动）
  /QuizQuestion.tsx                # 题目组件
  /RetryModal.tsx                  # 重试弹窗

/contexts
  /CourseContext.tsx               # 课程数据管理
  /ProgressContext.tsx             # 进度管理

/lib
  /storage.ts                      # localStorage 封装
  /minimax.ts                      # MiniMax API 调用
  /prompt.ts                       # Prompt 模板

/types
  /course.ts                       # 类型定义

.env.local                        # MiniMax API Key
```

---

## Phase 1: 项目初始化

### Task 1: 初始化 Next.js 项目

**Files:**
- Create: 所有 Next.js 初始文件

- [ ] **Step 1: 创建 Next.js 项目**

```bash
cd "/Users/admin/Documents/OpenCode/duolingo for anything"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --use-npm --yes
```

Expected: Next.js 项目创建完成，package.json 包含 next, react, react-dom

- [ ] **Step 2: 安装额外依赖**

```bash
npm install framer-motion
```

Expected: framer-motion 安装成功（用于卡片滑动动画）

- [ ] **Step 3: 配置环境变量**

创建 `.env.local`:
```bash
touch .env.local
```

添加内容:
```
MINIMAX_API_KEY=your_api_key_here
```

- [ ] **Step 4: 提交**

```bash
git init && git add .gitignore package.json package-lock.json next.config.ts tsconfig.json .env.local
git commit -m "chore: init Next.js project with TypeScript and Tailwind"
```

---

### Task 2: 创建类型定义

**Files:**
- Create: `types/course.ts`

- [ ] **Step 1: 创建 types/course.ts**

```typescript
// types/course.ts

export interface LearningCard {
  id: string;
  title: string;
  content: string;       // 支持 Markdown
  imageUrl?: string;
}

export interface Question {
  id: string;
  type: 'single' | 'multiple' | 'fill';
  question: string;
  options?: string[];      // 单选/多选
  answer: string | string[];
  explanation: string;
}

export interface CourseNode {
  index: number;
  title: string;
  description: string;
  cardCount: number;
  status: 'locked' | 'available' | 'completed';
  cards?: LearningCard[];
  questions?: Question[];
}

export interface CourseTree {
  courseId: string;
  topic: string;
  totalNodes: number;
  nodes: CourseNode[];
}

export interface CourseProgress {
  [courseId: string]: {
    [nodeIndex: number]: 'completed' | 'in_progress';
  };
}

export interface StoredData {
  courses: CourseTree[];
  currentCourseId: string | null;
  courseProgress: CourseProgress;
}

export type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';
```

- [ ] **Step 2: 提交**

```bash
git add types/course.ts
git commit -m "feat: add course type definitions"
```

---

## Phase 2: 基础设施

### Task 3: localStorage 封装

**Files:**
- Create: `lib/storage.ts`

- [ ] **Step 1: 创建 lib/storage.ts**

```typescript
// lib/storage.ts
import { StoredData, CourseTree, CourseProgress } from '@/types/course';

const STORAGE_KEY = 'ai-learning-data';

const defaultData: StoredData = {
  courses: [],
  currentCourseId: null,
  courseProgress: {},
};

export function getStoredData(): StoredData {
  if (typeof window === 'undefined') return defaultData;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData;
    return JSON.parse(raw) as StoredData;
  } catch {
    return defaultData;
  }
}

export function saveStoredData(data: StoredData): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function addCourse(course: CourseTree): void {
  const data = getStoredData();
  data.courses.push(course);
  data.currentCourseId = course.courseId;
  saveStoredData(data);
}

export function getCurrentCourse(): CourseTree | null {
  const data = getStoredData();
  if (!data.currentCourseId) return null;
  return data.courses.find(c => c.courseId === data.currentCourseId) || null;
}

export function updateNodeContent(
  courseId: string,
  nodeIndex: number,
  cards: CourseTree['nodes'][0]['cards'],
  questions: CourseTree['nodes'][0]['questions']
): void {
  const data = getStoredData();
  const course = data.courses.find(c => c.courseId === courseId);
  if (course && course.nodes[nodeIndex]) {
    course.nodes[nodeIndex].cards = cards;
    course.nodes[nodeIndex].questions = questions;
    saveStoredData(data);
  }
}

export function markNodeCompleted(courseId: string, nodeIndex: number): void {
  const data = getStoredData();
  if (!data.courseProgress[courseId]) {
    data.courseProgress[courseId] = {};
  }
  data.courseProgress[courseId][nodeIndex] = 'completed';

  // 解锁下一个节点
  const course = data.courses.find(c => c.courseId === courseId);
  if (course && nodeIndex + 1 < course.nodes.length) {
    course.nodes[nodeIndex + 1].status = 'available';
  }

  saveStoredData(data);
}

export function getNodeProgress(courseId: string, nodeIndex: number): 'completed' | 'in_progress' | null {
  const data = getStoredData();
  return data.courseProgress[courseId]?.[nodeIndex] || null;
}
```

- [ ] **Step 2: 提交**

```bash
git add lib/storage.ts
git commit -m "feat: add localStorage abstraction layer"
```

---

### Task 4: Contexts

**Files:**
- Create: `contexts/CourseContext.tsx`
- Create: `contexts/ProgressContext.tsx`

- [ ] **Step 1: 创建 CourseContext**

```typescript
// contexts/CourseContext.tsx
'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CourseTree, CourseNode, GenerationStatus } from '@/types/course';
import { getStoredData, addCourse as saveCourse, updateNodeContent as saveNodeContent } from '@/lib/storage';

interface CourseContextType {
  courses: CourseTree[];
  currentCourse: CourseTree | null;
  generationStatus: GenerationStatus;
  generateCourse: (topic: string) => Promise<void>;
  generateNodeContent: (courseId: string, nodeIndex: number) => Promise<void>;
  updateNodeContent: (courseId: string, nodeIndex: number, cards: CourseNode['cards'], questions: CourseNode['questions']) => void;
}

const CourseContext = createContext<CourseContextType | null>(null);

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [courses, setCourses] = useState<CourseTree[]>([]);
  const [currentCourse, setCurrentCourse] = useState<CourseTree | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');

  // 从 localStorage 恢复
  useEffect(() => {
    const data = getStoredData();
    setCourses(data.courses);
    if (data.currentCourseId) {
      setCurrentCourse(data.courses.find(c => c.courseId === data.currentCourseId) || null);
    }
  }, []);

  const generateCourse = useCallback(async (topic: string) => {
    setGenerationStatus('generating');
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });

      if (!response.ok) throw new Error('Generation failed');

      const course: CourseTree = await response.json();

      // 第一个节点设为 available
      if (course.nodes.length > 0) {
        course.nodes[0].status = 'available';
      }

      saveCourse(course);
      setCourses(prev => [...prev, course]);
      setCurrentCourse(course);
      setGenerationStatus('success');
    } catch {
      setGenerationStatus('error');
      throw new Error('Failed to generate course');
    }
  }, []);

  const generateNodeContent = useCallback(async (courseId: string, nodeIndex: number) => {
    const course = courses.find(c => c.courseId === courseId);
    if (!course || course.nodes[nodeIndex].cards) return;

    try {
      const response = await fetch('/api/generate/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, nodeIndex, topic: course.topic, title: course.nodes[nodeIndex].title }),
      });

      if (!response.ok) throw new Error('Node generation failed');

      const { cards, questions } = await response.json();
      updateNodeContent(courseId, nodeIndex, cards, questions);
    } catch {
      throw new Error('Failed to generate node content');
    }
  }, [courses]);

  const updateNodeContent = useCallback((
    courseId: string,
    nodeIndex: number,
    cards: CourseNode['cards'],
    questions: CourseNode['questions']
  ) => {
    saveNodeContent(courseId, nodeIndex, cards, questions);
    setCurrentCourse(prev => {
      if (!prev || prev.courseId !== courseId) return prev;
      const newNodes = [...prev.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], cards, questions };
      return { ...prev, nodes: newNodes };
    });
    setCourses(prev => prev.map(c => {
      if (c.courseId !== courseId) return c;
      const newNodes = [...c.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], cards, questions };
      return { ...c, nodes: newNodes };
    }));
  }, []);

  return (
    <CourseContext.Provider value={{
      courses,
      currentCourse,
      generationStatus,
      generateCourse,
      generateNodeContent,
      updateNodeContent,
    }}>
      {children}
    </CourseContext.Provider>
  );
}

export function useCourse() {
  const context = useContext(CourseContext);
  if (!context) throw new Error('useCourse must be used within CourseProvider');
  return context;
}
```

- [ ] **Step 2: 创建 ProgressContext**

```typescript
// contexts/ProgressContext.tsx
'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { markNodeCompleted, getStoredData } from '@/lib/storage';

interface ProgressContextType {
  completedNodes: Set<string>; // "courseId-nodeIndex" 格式
  markCompleted: (courseId: string, nodeIndex: number) => void;
  isCompleted: (courseId: string, nodeIndex: number) => boolean;
}

const ProgressContext = createContext<ProgressContextType | null>(null);

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [completedNodes, setCompletedNodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    const data = getStoredData();
    const set = new Set<string>();
    Object.entries(data.courseProgress).forEach(([courseId, progress]) => {
      Object.entries(progress).forEach(([nodeIndex, status]) => {
        if (status === 'completed') {
          set.add(`${courseId}-${nodeIndex}`);
        }
      });
    });
    setCompletedNodes(set);
  }, []);

  const markCompleted = useCallback((courseId: string, nodeIndex: number) => {
    markNodeCompleted(courseId, nodeIndex);
    setCompletedNodes(prev => new Set(prev).add(`${courseId}-${nodeIndex}`));
  }, []);

  const isCompleted = useCallback((courseId: string, nodeIndex: number) => {
    return completedNodes.has(`${courseId}-${nodeIndex}`);
  }, [completedNodes]);

  return (
    <ProgressContext.Provider value={{ completedNodes, markCompleted, isCompleted }}>
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgress() {
  const context = useContext(ProgressContext);
  if (!context) throw new Error('useProgress must be used within ProgressProvider');
  return context;
}
```

- [ ] **Step 3: 创建 CombinedProvider**

```typescript
// contexts/index.tsx
'use client';

import { CourseProvider } from './CourseContext';
import { ProgressProvider } from './ProgressContext';

export function CombinedProvider({ children }: { children: React.ReactNode }) {
  return (
    <CourseProvider>
      <ProgressProvider>
        {children}
      </ProgressProvider>
    </CourseProvider>
  );
}
```

- [ ] **Step 4: 更新 app/layout.tsx 引入 Provider**

```typescript
// app/layout.tsx 头部添加
import { CombinedProvider } from '@/contexts';

// 把 layout 里的 children 用 CombinedProvider 包裹
```

- [ ] **Step 5: 提交**

```bash
git add contexts/CourseContext.tsx contexts/ProgressContext.tsx contexts/index.tsx app/layout.tsx
git commit -m "feat: add CourseContext and ProgressContext"
```

---

## Phase 3: 组件

### Task 5: 基础 UI 组件

**Files:**
- Create: `components/ui/ProgressBar.tsx`
- Create: `components/ui/LoadingSpinner.tsx`

- [ ] **Step 1: 创建 ProgressBar**

```typescript
// components/ui/ProgressBar.tsx
'use client';

interface ProgressBarProps {
  current: number;
  total: number;
}

export function ProgressBar({ current, total }: ProgressBarProps) {
  const percentage = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="w-full">
      <div className="flex justify-between text-sm text-gray-500 mb-1">
        <span>Progress</span>
        <span>{current}/{total}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 LoadingSpinner**

```typescript
// components/ui/LoadingSpinner.tsx
'use client';

export function LoadingSpinner({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh]">
      <div className="relative w-16 h-16">
        <div className="absolute top-0 left-0 w-full h-full border-4 border-gray-200 rounded-full" />
        <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-500 rounded-full animate-spin" />
      </div>
      <p className="mt-4 text-gray-600">{message}</p>
    </div>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add components/ui/ProgressBar.tsx components/ui/LoadingSpinner.tsx
git commit -m "feat: add ProgressBar and LoadingSpinner components"
```

---

### Task 6: CourseNode 组件

**Files:**
- Create: `components/CourseNode.tsx`

- [ ] **Step 1: 创建 CourseNode**

```typescript
// components/CourseNode.tsx
'use client';

import { CourseNode as CourseNodeType } from '@/types/course';

interface CourseNodeProps {
  node: CourseNodeType;
  isActive: boolean;
  onClick: () => void;
}

export function CourseNode({ node, isActive, onClick }: CourseNodeProps) {
  const isLocked = node.status === 'locked';
  const isCompleted = node.status === 'completed';

  return (
    <button
      onClick={onClick}
      disabled={isLocked}
      className={`
        w-full text-left p-4 rounded-lg border-2 transition-all
        ${isLocked ? 'bg-gray-100 border-gray-200 cursor-not-allowed opacity-60' : ''}
        ${isActive && !isCompleted ? 'border-blue-500 bg-blue-50' : ''}
        ${isCompleted ? 'bg-green-50 border-green-200' : ''}
        ${node.status === 'available' ? 'bg-white border-gray-200 hover:border-blue-400 cursor-pointer' : ''}
      `}
    >
      <div className="flex items-center gap-3">
        {/* 状态图标 */}
        <div className={`
          w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
          ${isLocked ? 'bg-gray-200 text-gray-400' : ''}
          ${isCompleted ? 'bg-green-500 text-white' : ''}
          ${node.status === 'available' ? 'bg-blue-500 text-white' : ''}
        `}>
          {isCompleted ? '✓' : isLocked ? '🔒' : node.index + 1}
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <h3 className={`font-medium truncate ${isLocked ? 'text-gray-400' : 'text-gray-900'}`}>
            {node.title}
          </h3>
          <p className={`text-sm truncate ${isLocked ? 'text-gray-300' : 'text-gray-500'}`}>
            {node.description}
          </p>
        </div>

        {/* 箭头 */}
        {!isLocked && !isCompleted && (
          <span className="text-gray-400">→</span>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add components/CourseNode.tsx
git commit -m "feat: add CourseNode component"
```

---

### Task 7: CourseTree 组件

**Files:**
- Create: `components/CourseTree.tsx`

- [ ] **Step 1: 创建 CourseTree**

```typescript
// components/CourseTree.tsx
'use client';

import { useRouter } from 'next/navigation';
import { CourseTree as CourseTreeType } from '@/types/course';
import { CourseNode } from './CourseNode';
import { ProgressBar } from './ui/ProgressBar';

interface CourseTreeProps {
  course: CourseTreeType;
}

export function CourseTree({ course }: CourseTreeProps) {
  const router = useRouter();

  const completedCount = course.nodes.filter(n => n.status === 'completed').length;

  const handleNodeClick = (nodeIndex: number) => {
    const node = course.nodes[nodeIndex];
    if (node.status === 'locked') return;
    router.push(`/course/${course.courseId}/learn/${nodeIndex}`);
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* 课程标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{course.topic}</h1>
        <p className="text-gray-500 mt-1">{course.totalNodes} lessons</p>
      </div>

      {/* 进度条 */}
      <div className="mb-6">
        <ProgressBar current={completedCount} total={course.totalNodes} />
      </div>

      {/* 节点列表 */}
      <div className="space-y-3">
        {course.nodes.map((node) => (
          <CourseNode
            key={node.index}
            node={node}
            isActive={false}
            onClick={() => handleNodeClick(node.index)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add components/CourseTree.tsx
git commit -m "feat: add CourseTree component"
```

---

### Task 8: LearningCardStack 组件

**Files:**
- Create: `components/LearningCardStack.tsx`
- Create: `components/LearningCard.tsx`

- [ ] **Step 1: 创建 LearningCard**

```typescript
// components/LearningCard.tsx
'use client';

import { LearningCard as LearningCardType } from '@/types/course';

interface LearningCardProps {
  card: LearningCardType;
}

export function LearningCard({ card }: LearningCardProps) {
  return (
    <div className="w-full h-full flex flex-col p-6 bg-white rounded-2xl shadow-lg">
      <h2 className="text-xl font-bold text-gray-900 mb-4">{card.title}</h2>
      <div className="flex-1 overflow-auto">
        <div className="prose prose-sm max-w-none text-gray-700">
          {card.content}
        </div>
      </div>
      {card.imageUrl && (
        <div className="mt-4">
          <img src={card.imageUrl} alt="" className="rounded-lg max-h-40 object-cover" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 创建 LearningCardStack**

```typescript
// components/LearningCardStack.tsx
'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LearningCard } from './LearningCard';
import { LearningCard as LearningCardType } from '@/types/course';
import { ProgressBar } from './ui/ProgressBar';

interface LearningCardStackProps {
  cards: LearningCardType[];
  onComplete: () => void;
}

export function LearningCardStack({ cards, onComplete }: LearningCardStackProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  const currentCard = cards[currentIndex];
  const isLastCard = currentIndex === cards.length - 1;

  const handleNext = () => {
    if (isLastCard) {
      onComplete();
    } else {
      setDirection(1);
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex(prev => prev - 1);
    }
  };

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir < 0 ? 300 : -300,
      opacity: 0,
    }),
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* 进度 */}
      <div className="mb-4">
        <ProgressBar current={currentIndex + 1} total={cards.length} />
      </div>

      {/* 卡片区域 */}
      <div className="relative h-[400px] mb-4">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="absolute inset-0"
          >
            <LearningCard card={currentCard} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 导航按钮 */}
      <div className="flex justify-between">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="px-6 py-2 rounded-full border border-gray-300 disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          onClick={handleNext}
          className="px-6 py-2 rounded-full bg-blue-500 text-white disabled:opacity-40"
        >
          {isLastCard ? 'Start Quiz →' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add components/LearningCard.tsx components/LearningCardStack.tsx
git commit -m "feat: add LearningCard and LearningCardStack components"
```

---

### Task 9: QuizQuestion 组件

**Files:**
- Create: `components/QuizQuestion.tsx`

- [ ] **Step 1: 创建 QuizQuestion**

```typescript
// components/QuizQuestion.tsx
'use client';

import { useState } from 'react';
import { Question } from '@/types/course';
import { ProgressBar } from './ui/ProgressBar';

interface QuizQuestionProps {
  questions: Question[];
  onComplete: () => void;
}

export function QuizQuestion({ questions, onComplete }: QuizQuestionProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string[]>([]);
  const [fillAnswer, setFillAnswer] = useState('');
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;

  const handleSingleSelect = (option: string) => {
    if (isAnswered) return;
    setSelectedAnswer([option]);
  };

  const handleMultiSelect = (option: string) => {
    if (isAnswered) return;
    setSelectedAnswer(prev =>
      prev.includes(option) ? prev.filter(o => o !== option) : [...prev, option]
    );
  };

  const handleFillChange = (value: string) => {
    if (isAnswered) return;
    setFillAnswer(value);
  };

  const checkAnswer = () => {
    const answer = currentQuestion.answer;
    let correct = false;

    if (currentQuestion.type === 'fill') {
      correct = fillAnswer.trim().toLowerCase() === String(answer).toLowerCase();
    } else if (Array.isArray(answer)) {
      const selected = new Set(selectedAnswer);
      const correctSet = new Set(answer);
      correct = selected.size === correctSet.size && [...selected].every(a => correctSet.has(a));
    } else {
      correct = selectedAnswer.length === 1 && selectedAnswer[0] === answer;
    }

    setIsCorrect(correct);
    setIsAnswered(true);
  };

  const handleNext = () => {
    if (isLastQuestion) {
      onComplete();
    } else {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswer([]);
      setFillAnswer('');
      setIsAnswered(false);
      setIsCorrect(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* 进度 */}
      <div className="mb-6">
        <ProgressBar current={currentIndex + 1} total={questions.length} />
      </div>

      {/* 题目 */}
      <div className="bg-white rounded-2xl p-6 shadow-lg mb-4">
        <div className="text-sm text-gray-500 mb-2">
          {currentQuestion.type === 'single' && 'Single Choice'}
          {currentQuestion.type === 'multiple' && 'Multiple Choice'}
          {currentQuestion.type === 'fill' && 'Fill in the Blank'}
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-6">
          {currentQuestion.question}
        </h2>

        {/* 选项 */}
        {currentQuestion.type !== 'fill' && currentQuestion.options && (
          <div className="space-y-3">
            {currentQuestion.options.map((option, i) => {
              const isSelected = selectedAnswer.includes(option);
              const showCorrect = isAnswered && (Array.isArray(currentQuestion.answer)
                ? currentQuestion.answer.includes(option)
                : currentQuestion.answer === option);
              const showIncorrect = isAnswered && isSelected && !showCorrect;

              return (
                <button
                  key={i}
                  onClick={() => currentQuestion.type === 'single' ? handleSingleSelect(option) : handleMultiSelect(option)}
                  disabled={isAnswered}
                  className={`
                    w-full p-4 rounded-lg border-2 text-left transition-all
                    ${isSelected && !isAnswered ? 'border-blue-500 bg-blue-50' : ''}
                    ${showCorrect ? 'border-green-500 bg-green-50' : ''}
                    ${showIncorrect ? 'border-red-500 bg-red-50' : ''}
                    ${!isAnswered && !isSelected ? 'border-gray-200 hover:border-blue-300' : ''}
                  `}
                >
                  {option}
                </button>
              );
            })}
          </div>
        )}

        {/* 填空题 */}
        {currentQuestion.type === 'fill' && (
          <div>
            <input
              type="text"
              value={fillAnswer}
              onChange={(e) => handleFillChange(e.target.value)}
              disabled={isAnswered}
              className={`
                w-full p-4 rounded-lg border-2
                ${isAnswered && isCorrect ? 'border-green-500 bg-green-50' : ''}
                ${isAnswered && !isCorrect ? 'border-red-500 bg-red-50' : ''}
                ${!isAnswered ? 'border-gray-200 focus:border-blue-500' : ''}
              `}
              placeholder="Type your answer..."
            />
          </div>
        )}

        {/* 解释（答错后显示） */}
        {isAnswered && !isCorrect && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-red-500">Incorrect. </span>
              {currentQuestion.explanation}
            </p>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end">
        {!isAnswered ? (
          <button
            onClick={checkAnswer}
            disabled={
              currentQuestion.type === 'fill'
                ? !fillAnswer.trim()
                : selectedAnswer.length === 0
            }
            className="px-6 py-2 rounded-full bg-blue-500 text-white disabled:opacity-40"
          >
            Check
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="px-6 py-2 rounded-full bg-blue-500 text-white"
          >
            {isLastQuestion ? 'Complete →' : 'Next →'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add components/QuizQuestion.tsx
git commit -m "feat: add QuizQuestion component"
```

---

### Task 10: RetryModal 组件

**Files:**
- Create: `components/RetryModal.tsx`

- [ ] **Step 1: 创建 RetryModal**

```typescript
// components/RetryModal.tsx
'use client';

interface RetryModalProps {
  isOpen: boolean;
  onRetry: () => void;
  onSkip: () => void;
  message?: string;
}

export function RetryModal({ isOpen, onRetry, onSkip, message = 'Failed to generate content' }: RetryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Generation Failed</h2>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onRetry}
            className="flex-1 px-4 py-2 rounded-full border border-gray-300 hover:bg-gray-50"
          >
            Retry
          </button>
          <button
            onClick={onSkip}
            className="flex-1 px-4 py-2 rounded-full bg-gray-900 text-white hover:bg-gray-800"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add components/RetryModal.tsx
git commit -m "feat: add RetryModal component"
```

---

## Phase 4: 页面

### Task 11: 主题输入页

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: 更新 app/page.tsx**

```typescript
// app/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';

export default function HomePage() {
  const [topic, setTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { generateCourse } = useCourse();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setIsGenerating(true);
    setError('');

    try {
      await generateCourse(topic.trim());
      router.push('/generate');
    } catch {
      setError('Failed to generate course. Please try again.');
      setIsGenerating(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Learning</h1>
          <p className="text-gray-600">输入任何感兴趣的主题，开始你的学习之旅</p>
        </div>

        {/* 输入表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：日本江户时代历史"
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
              disabled={isGenerating}
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={!topic.trim() || isGenerating}
            className="w-full py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isGenerating ? 'Generating...' : 'Start Learning →'}
          </button>
        </form>

        {/* 示例主题 */}
        <div className="mt-6">
          <p className="text-sm text-gray-500 mb-3">Try these topics:</p>
          <div className="flex flex-wrap gap-2">
            {['量子力学入门', '印象派绘画', '古罗马历史'].map((t) => (
              <button
                key={t}
                onClick={() => setTopic(t)}
                className="px-3 py-1 rounded-full bg-white border border-gray-200 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-500"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add app/page.tsx
git commit -m "feat: add topic input page"
```

---

### Task 12: 生成中页面

**Files:**
- Create: `app/generate/page.tsx`

- [ ] **Step 1: 创建 app/generate/page.tsx**

```typescript
// app/generate/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function GeneratePage() {
  const router = useRouter();
  const { currentCourse, generationStatus } = useCourse();

  useEffect(() => {
    if (generationStatus === 'success' && currentCourse) {
      router.replace(`/course/${currentCourse.courseId}`);
    } else if (generationStatus === 'error') {
      router.replace('/');
    }
  }, [generationStatus, currentCourse, router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-gray-50">
      <LoadingSpinner message="AI is creating your personalized course..." />
    </main>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add app/generate/page.tsx
git commit -m "feat: add generation loading page"
```

---

### Task 13: 课程详情页

**Files:**
- Create: `app/course/[courseId]/page.tsx`

- [ ] **Step 1: 创建 app/course/[courseId]/page.tsx**

```typescript
// app/course/[courseId]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { CourseTree } from '@/components/CourseTree';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function CoursePage() {
  const params = useParams();
  const router = useRouter();
  const { courses, currentCourse } = useCourse();
  const [isLoading, setIsLoading] = useState(true);

  const courseId = params.courseId as string;

  useEffect(() => {
    if (courses.length > 0 || currentCourse) {
      setIsLoading(false);
    }
  }, [courses, currentCourse]);

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <LoadingSpinner message="Loading course..." />
      </main>
    );
  }

  const course = courses.find(c => c.courseId === courseId) || currentCourse;

  if (!course) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6">
        <p className="text-gray-600 mb-4">Course not found</p>
        <button
          onClick={() => router.push('/')}
          className="px-6 py-2 rounded-full bg-blue-500 text-white"
        >
          Go Home
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <CourseTree course={course} />
    </main>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add app/course/[courseId]/page.tsx
git commit -m "feat: add course detail page"
```

---

### Task 14: 单元学习页

**Files:**
- Create: `app/course/[courseId]/learn/[nodeIndex]/page.tsx`

- [ ] **Step 1: 创建 app/course/[courseId]/learn/[nodeIndex]/page.tsx**

```typescript
// app/course/[courseId]/learn/[nodeIndex]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCourse } from '@/contexts/CourseContext';
import { useProgress } from '@/contexts/ProgressContext';
import { LearningCardStack } from '@/components/LearningCardStack';
import { QuizQuestion } from '@/components/QuizQuestion';
import { RetryModal } from '@/components/RetryModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { markNodeCompleted } from '@/lib/storage';

type LearningPhase = 'loading' | 'cards' | 'quiz' | 'complete';

export default function LearnPage() {
  const params = useParams();
  const router = useRouter();
  const { courses, generateNodeContent, updateNodeContent } = useCourse();
  const { markCompleted } = useProgress();

  const courseId = params.courseId as string;
  const nodeIndex = parseInt(params.nodeIndex as string);

  const [phase, setPhase] = useState<LearningPhase>('loading');
  const [showRetry, setShowRetry] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const course = courses.find(c => c.courseId === courseId);
  const node = course?.nodes[nodeIndex];

  useEffect(() => {
    if (!course || !node) return;

    // 如果节点内容还没生成，触发生成
    if (!node.cards || !node.questions) {
      loadNodeContent();
    } else {
      setPhase('cards');
    }
  }, [course, node]);

  const loadNodeContent = async () => {
    if (!course) return;

    try {
      await generateNodeContent(courseId, nodeIndex);
      setPhase('cards');
      setRetryCount(0);
    } catch {
      if (retryCount < 2) {
        setRetryCount(prev => prev + 1);
        // 自动重试
        await loadNodeContent();
      } else {
        setShowRetry(true);
      }
    }
  };

  const handleCardsComplete = () => {
    setPhase('quiz');
  };

  const handleQuizComplete = () => {
    markCompleted(courseId, nodeIndex);
    setPhase('complete');
  };

  const handleRetry = async () => {
    setShowRetry(false);
    setRetryCount(0);
    await loadNodeContent();
  };

  const handleSkip = () => {
    setShowRetry(false);
    if (course && nodeIndex + 1 < course.nodes.length) {
      router.push(`/course/${courseId}/learn/${nodeIndex + 1}`);
    } else {
      router.push(`/course/${courseId}`);
    }
  };

  if (!course || !node) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <LoadingSpinner message="Loading..." />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      {/* 返回按钮 */}
      <button
        onClick={() => router.push(`/course/${courseId}`)}
        className="mb-4 text-gray-500 hover:text-gray-700"
      >
        ← Back to Course
      </button>

      {/* 节点标题 */}
      <h1 className="text-xl font-bold text-gray-900 mb-6">{node.title}</h1>

      {/* 内容 */}
      {phase === 'loading' && (
        <LoadingSpinner message="Generating content..." />
      )}

      {phase === 'cards' && node.cards && (
        <LearningCardStack cards={node.cards} onComplete={handleCardsComplete} />
      )}

      {phase === 'quiz' && node.questions && (
        <QuizQuestion questions={node.questions} onComplete={handleQuizComplete} />
      )}

      {phase === 'complete' && (
        <div className="flex flex-col items-center justify-center min-h-[50vh]">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Lesson Complete!</h2>
          <p className="text-gray-600 mb-6">Great job learning {node.title}</p>
          <button
            onClick={() => router.push(`/course/${courseId}`)}
            className="px-6 py-3 rounded-full bg-blue-500 text-white"
          >
            Continue →
          </button>
        </div>
      )}

      {/* 重试弹窗 */}
      <RetryModal
        isOpen={showRetry}
        onRetry={handleRetry}
        onSkip={handleSkip}
      />
    </main>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add "app/course/[courseId]/learn/[nodeIndex]/page.tsx"
git commit -m "feat: add unit learning page"
```

---

## Phase 5: API 路由

### Task 15: AI 生成 API

**Files:**
- Create: `app/api/generate/route.ts`
- Create: `app/api/generate/node/route.ts`
- Create: `lib/minimax.ts`
- Create: `lib/prompt.ts`

- [ ] **Step 1: 创建 lib/prompt.ts**

```typescript
// lib/prompt.ts

export function buildCourseTreePrompt(topic: string): string {
  return `You are an AI tutor creating a personalized learning path for the topic: "${topic}"

Create a learning course tree with the following structure:
- Minimum 4 nodes, Maximum 8 nodes (decide based on topic complexity)
- Each node represents a learning concept in the topic
- Nodes should be ordered from basic to advanced
- Each node has: title, one-sentence description, cardCount (1-5 based on complexity)

Output a JSON object with this exact structure:
{
  "courseId": "a unique ID",
  "topic": "${topic}",
  "totalNodes": number,
  "nodes": [
    {
      "index": 0,
      "title": "node title",
      "description": "one sentence description",
      "cardCount": number (1-5),
      "status": "locked"
    }
  ]
}

Return ONLY the JSON object, no additional text.`;
}

export function buildNodeContentPrompt(topic: string, nodeTitle: string, cardCount: number): string {
  return `You are an AI tutor creating learning content for the topic: "${topic}"
The current learning node is: "${nodeTitle}"

Generate exactly ${cardCount} learning cards and quiz questions for this node.

Each card should have:
- title: short title for the card
- content: Markdown formatted explanation (2-3 paragraphs)
- imageUrl: (optional) leave as null

Quiz questions should include:
- Single choice questions (1-2)
- Multiple choice questions (1-2)
- Fill in the blank questions (1-2)

Each question has:
- type: "single" | "multiple" | "fill"
- question: the question text
- options: array of 4 choices (for single/multiple)
- answer: correct answer(s)
- explanation: explanation shown when wrong

Output a JSON object with this exact structure:
{
  "cards": [
    {
      "id": "card-1",
      "title": "card title",
      "content": "markdown content",
      "imageUrl": null
    }
  ],
  "questions": [
    {
      "id": "q-1",
      "type": "single",
      "question": "question text",
      "options": ["A", "B", "C", "D"],
      "answer": "A",
      "explanation": "explanation when wrong"
    }
  ]
}

Return ONLY the JSON object, no additional text.`;
}
```

- [ ] **Step 2: 创建 lib/minimax.ts**

```typescript
// lib/minimax.ts

interface MiniMaxResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
}

export async function callMiniMax(prompt: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;

  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY is not set');
  }

  const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-Text-01',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`MiniMax API error: ${response.status}`);
  }

  const data: MiniMaxResponse = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from MiniMax');
  }

  return data.choices[0].message.content;
}

export function parseJSONResponse<T>(content: string): T {
  // Try to extract JSON from the response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }
  return JSON.parse(jsonMatch[0]) as T;
}
```

- [ ] **Step 3: 创建 app/api/generate/route.ts**

```typescript
// app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildCourseTreePrompt } from '@/lib/prompt';
import { CourseTree } from '@/types/course';

export async function POST(request: NextRequest) {
  try {
    const { topic } = await request.json();

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    const prompt = buildCourseTreePrompt(topic);
    const content = await callMiniMax(prompt);
    const course = parseJSONResponse<CourseTree>(content);

    return NextResponse.json(course);
  } catch (error) {
    console.error('Course generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate course' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: 创建 app/api/generate/node/route.ts**

```typescript
// app/api/generate/node/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildNodeContentPrompt } from '@/lib/prompt';

interface NodeContentResponse {
  cards: Array<{
    id: string;
    title: string;
    content: string;
    imageUrl: string | null;
  }>;
  questions: Array<{
    id: string;
    type: 'single' | 'multiple' | 'fill';
    question: string;
    options?: string[];
    answer: string | string[];
    explanation: string;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const { topic, title, cardCount } = await request.json();

    if (!topic || !title || !cardCount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const prompt = buildNodeContentPrompt(topic, title, cardCount);
    const content = await callMiniMax(prompt);
    const data = parseJSONResponse<NodeContentResponse>(content);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Node content generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate node content' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 5: 提交**

```bash
git add lib/minimax.ts lib/prompt.ts app/api/generate/route.ts "app/api/generate/node/route.ts"
git commit -m "feat: add MiniMax API integration and prompts"
```

---

## Phase 6: 全局样式和配置

### Task 16: 全局样式和 Root Layout

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`

- [ ] **Step 1: 更新 app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --foreground-rgb: 0, 0, 0;
  --background-rgb: 249, 250, 251;
}

body {
  color: rgb(var(--foreground-rgb));
  background: rgb(var(--background-rgb));
}

/* 移动端优化 */
* {
  -webkit-tap-highlight-color: transparent;
}

/* 平滑滚动 */
html {
  scroll-behavior: smooth;
}

/* Prose 样式（用于卡片内容） */
.prose h3 {
  @apply text-lg font-semibold mt-4 mb-2;
}

.prose p {
  @apply mb-3 leading-relaxed;
}

.prose ul, .prose ol {
  @apply ml-5 mb-3;
}

.prose ul {
  @apply list-disc;
}

.prose ol {
  @apply list-decimal;
}

.prose li {
  @apply mb-1;
}
```

- [ ] **Step 2: 确保 app/layout.tsx 正确配置**

```typescript
// app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { CombinedProvider } from '@/contexts';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Learning - Personalized Learning Path',
  description: '输入任何感兴趣的主题，AI 为你生成专属学习路径',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <CombinedProvider>
          {children}
        </CombinedProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add app/globals.css app/layout.tsx
git commit -m "style: update global styles and layout"
```

---

## Phase 7: 验收测试

### Task 17: 手动验收

- [ ] **Step 1: 启动开发服务器**

```bash
npm run dev
```

Expected: 开发服务器启动在 http://localhost:3000

- [ ] **Step 2: 验收清单**

| # | 检查项 | 预期结果 |
|---|--------|----------|
| 1 | 首页 | 输入框 + 开始按钮 + 示例话题 |
| 2 | 生成课程 | 输入"日本江户时代历史" → 获得课程树 |
| 3 | 课程树 | 纵向显示 4-8 个节点，第一个可用 |
| 4 | 进入节点 | 点击第一个节点 → 看到学习卡片 |
| 5 | 学习卡片 | 1-5 张卡片，可滑动，最后有"开始答题" |
| 6 | 答题 | 单选/多选/填空，即时反馈 |
| 7 | 完成答题 | 显示"Lesson Complete"，可返回 |
| 8 | 进度保存 | 刷新页面，进度保留 |
| 9 | 节点解锁 | 完成一个节点，下一个自动解锁 |
| 10 | 生成失败 | RetryModal 弹窗 |

---

## 执行方式

**Plan complete and saved to `docs/superpowers/plans/2026-03-23-duolingo-ai-learning-implementation.md`**

**两个执行选项：**

**1. Subagent-Driven (recommended)** — 每个 Task 由独立的 subagent 执行，任务间有检查点，快速度迭代

**2. Inline Execution** — 在当前 session 中批量执行任务，带检查点回顾

选择哪个方式？