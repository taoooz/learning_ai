# 课程游戏化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为课程目录页添加连续学习天数（Streak Fire）和课程完成庆祝弹窗，提升学习驱动力。

**Architecture:** 新建 `useStreak` hook 管理 localStorage 中的连续学习数据；修改 `CourseHeaderBar` 新增 `streak` prop 渲染火焰图标；新建 `CourseCelebrationSheet` 组件在课程全部完成时弹出庆祝弹窗；在 `ProgressContext.markCompleted` 中触发 `recordStudy`。

**Tech Stack:** React hooks, localStorage, Framer Motion, Tailwind CSS v4

---

### Task 1: 创建 `useStreak` hook

**Files:**
- Create: `hooks/useStreak.ts`

- [ ] **Step 1: 创建 `hooks/useStreak.ts`**

```typescript
// hooks/useStreak.ts
'use client';

import { useState, useEffect, useCallback } from 'react';

interface StreakData {
  currentStreak: number;
  bestStreak: number;
  lastStudyDate: string; // ISO 8601 date string, e.g. "2026-04-12"
}

const STORAGE_KEY = 'streak_data';
const DEFAULT_STREAK: StreakData = {
  currentStreak: 0,
  bestStreak: 0,
  lastStudyDate: '',
};

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDaysDiff(a: string, b: string): number {
  const dateA = new Date(a);
  const dateB = new Date(b);
  const ms = dateA.getTime() - dateB.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function readStreak(): StreakData {
  if (typeof window === 'undefined') return DEFAULT_STREAK;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_STREAK, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_STREAK;
}

function writeStreak(data: StreakData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function useStreak() {
  const [streakData, setStreakData] = useState<StreakData>(DEFAULT_STREAK);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setStreakData(readStreak());
    setIsLoading(false);
  }, []);

  const recordStudy = useCallback(() => {
    setStreakData(prev => {
      const today = getToday();
      if (prev.lastStudyDate === today) return prev; // 今天已学习

      let newStreak: number;
      if (prev.lastStudyDate === '') {
        // 首次学习
        newStreak = 1;
      } else {
        const diff = getDaysDiff(today, prev.lastStudyDate);
        if (diff === 1) {
          newStreak = prev.currentStreak + 1; // 连续
        } else {
          newStreak = 1; // 断了，重置
        }
      }

      const updated: StreakData = {
        currentStreak: newStreak,
        bestStreak: Math.max(prev.bestStreak, newStreak),
        lastStudyDate: today,
      };
      writeStreak(updated);
      return updated;
    });
  }, []);

  const studiedToday = streakData.lastStudyDate === getToday();

  return { streakData, studiedToday, recordStudy, isLoading };
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useStreak.ts
git commit -m "feat: 添加 useStreak hook 管理连续学习天数"
```

---

### Task 2: CourseHeaderBar 添加 streak prop

**Files:**
- Modify: `components/CourseHeaderBar.tsx`

- [ ] **Step 1: 修改 `components/CourseHeaderBar.tsx`，新增 `streak` prop 和火焰渲染**

在 interface 中新增 `streak` prop，在 trailing 前渲染火焰图标：

```typescript
'use client';

interface CourseHeaderBarProps {
  title: React.ReactNode;
  backLabel: string;
  onBack: () => void;
  trailing?: React.ReactNode;
  streak?: { count: number; studiedToday: boolean };
  maxWidthClassName?: string;
}

function getStreakColor(count: number): string {
  if (count >= 7) return 'text-red-500';
  if (count >= 3) return 'text-accent';
  return 'text-amber-400';
}

function StreakFire({ count, studiedToday }: { count: number; studiedToday: boolean }) {
  const colorClass = studiedToday ? getStreakColor(count) : 'text-tertiary';
  const opacityClass = studiedToday ? '' : 'opacity-40';

  return (
    <div className={`flex shrink-0 items-center gap-1 ${opacityClass}`}>
      <svg className={`h-4 w-4 ${colorClass}`} viewBox="0 0 20 20" fill="currentColor">
        <path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" />
      </svg>
      <span className={`text-[13px] font-semibold ${studiedToday ? colorClass : 'text-tertiary'}`}>
        {count}
      </span>
    </div>
  );
}

export function CourseHeaderBar({
  title,
  backLabel,
  onBack,
  trailing,
  streak,
  maxWidthClassName = 'max-w-md',
}: CourseHeaderBarProps) {
  return (
    <div className="fixed inset-x-0 top-0 z-20 pt-4">
      <div className={`mx-auto ${maxWidthClassName} px-5 pb-2 sm:px-6`}>
        <div className="rounded-[24px] border border-white/72 bg-surface/80 px-3 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)] backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-background/92 text-secondary transition-colors hover:bg-subtle"
              aria-label={backLabel}
            >
              <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="min-w-0 flex-1 overflow-hidden">
              {typeof title === 'string' ? (
                <p className="truncate text-[15px] font-semibold leading-5 text-primary">{title}</p>
              ) : (
                <div className="truncate text-[15px] font-semibold leading-5 text-primary">{title}</div>
              )}
            </div>

            {streak && streak.count > 0 && (
              <StreakFire count={streak.count} studiedToday={streak.studiedToday} />
            )}

            {trailing}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/CourseHeaderBar.tsx
git commit -m "feat: CourseHeaderBar 新增 streak prop 显示连续学习火焰"
```

---

### Task 3: 在 ProgressContext.markCompleted 中触发 recordStudy

**Files:**
- Modify: `contexts/ProgressContext.tsx`

- [ ] **Step 1: 在 `markCompleted` 中调用 streak 记录**

`recordStudy` 是纯 localStorage 写入，不需要 React state。直接在 `ProgressContext` 中导入一个纯函数版本。

首先，在 `hooks/useStreak.ts` 底部新增一个不依赖 React state 的导出函数：

在 `hooks/useStreak.ts` 末尾追加：

```typescript
/** 记录学习（非 hook 版本，供 ProgressContext 等非组件调用） */
export function recordStudyStandalone(): StreakData {
  const prev = readStreak();
  const today = getToday();
  if (prev.lastStudyDate === today) return prev;

  let newStreak: number;
  if (prev.lastStudyDate === '') {
    newStreak = 1;
  } else {
    const diff = getDaysDiff(today, prev.lastStudyDate);
    newStreak = diff === 1 ? prev.currentStreak + 1 : 1;
  }

  const updated: StreakData = {
    currentStreak: newStreak,
    bestStreak: Math.max(prev.bestStreak, newStreak),
    lastStudyDate: today,
  };
  writeStreak(updated);
  return updated;
}
```

然后修改 `contexts/ProgressContext.tsx`：

在文件顶部 import 区域添加：
```typescript
import { recordStudyStandalone } from '@/hooks/useStreak';
```

在 `markCompleted` 回调体内，`markNodeCompleted(courseId, nodeIndex);` 之前添加：
```typescript
recordStudyStandalone();
```

完整 `markCompleted` 改动后：

```typescript
const markCompleted = useCallback((courseId: string, nodeIndex: number) => {
    recordStudyStandalone();
    markNodeCompleted(courseId, nodeIndex);
    const bundle = getStoredCourseBundle(courseId);
    const node = bundle?.blueprint.nodes[nodeIndex];
    // ... rest unchanged
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useStreak.ts contexts/ProgressContext.tsx
git commit -m "feat: 章节完成时自动记录连续学习天数"
```

---

### Task 4: 课程目录页集成 streak

**Files:**
- Modify: `app/course/[courseId]/page.tsx`

- [ ] **Step 1: 在课程目录页导入 `useStreak` 并传递 streak prop**

在 `app/course/[courseId]/page.tsx` 中：

1. 添加 import：
```typescript
import { useStreak } from '@/hooks/useStreak';
```

2. 在 `CoursePage` 函数体中，`const [showTitleInBar, setShowTitleInBar] = useState(false);` 后面添加：
```typescript
const { streakData, studiedToday } = useStreak();
```

3. 修改 `CourseHeaderBar` 调用，新增 `streak` prop：
```tsx
<CourseHeaderBar
  title={showTitleInBar ? course.topic : ""}
  backLabel="首页"
  onBack={() => router.push('/')}
  streak={streakData.currentStreak > 0 ? { count: streakData.currentStreak, studiedToday } : undefined}
  trailing={(
    <div className="rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent">
      {progressPercent}% 完成
    </div>
  )}
  maxWidthClassName="max-w-2xl"
/>
```

- [ ] **Step 2: Commit**

```bash
git add app/course/[courseId]/page.tsx
git commit -m "feat: 课程目录页 HeaderBar 展示连续学习火焰"
```

---

### Task 5: 创建课程完成庆祝弹窗

**Files:**
- Create: `components/CourseCelebrationSheet.tsx`

- [ ] **Step 1: 创建 `components/CourseCelebrationSheet.tsx`**

```tsx
// components/CourseCelebrationSheet.tsx
'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import type { CourseTree } from '@/types/course';
import { useStreak } from '@/hooks/useStreak';

interface CourseCelebrationSheetProps {
  isOpen: boolean;
  onClose: () => void;
  course: CourseTree;
}

export function CourseCelebrationSheet({ isOpen, onClose, course }: CourseCelebrationSheetProps) {
  const router = useRouter();
  const { streakData } = useStreak();
  const [isDragging, setIsDragging] = useState(false);

  const totalNodes = course.totalNodes || course.nodes.length;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />

          {/* Sheet */}
          <motion.div
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80) onClose();
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-[32px] bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.12)]"
          >
            {/* 拖拽指示条 */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-black/[0.12]" />
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* 庆祝图标 + 粒子 */}
              <div className="relative mt-2 mb-6 flex justify-center">
                {/* 粒子动效 */}
                <div className="absolute inset-0 flex items-center justify-center">
                  {[0, 1, 2, 3, 4].map(i => (
                    <span
                      key={i}
                      className="absolute h-2 w-2 rounded-full animate-confetti"
                      style={{
                        backgroundColor: ['#FF8A00', '#22C55E', '#3B82F6', '#F59E0B', '#EC4899'][i],
                        animationDelay: `${i * 0.15}s`,
                        '--confetti-x': `${(i - 2) * 24}px`,
                        '--confetti-y': `${-20 - i * 8}px`,
                      } as React.CSSProperties}
                    />
                  ))}
                </div>
                <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 via-orange-50 to-white shadow-[0_12px_32px_rgba(255,138,0,0.15)]">
                  <span className="text-4xl">🏆</span>
                </div>
              </div>

              {/* 标题 */}
              <h2 className="mb-6 text-center text-[22px] font-bold text-primary">
                恭喜完成课程！
              </h2>

              {/* 统计信息 */}
              <div className="mb-6 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-black/[0.03] p-4 text-center">
                  <p className="text-[24px] font-bold text-primary">{totalNodes}</p>
                  <p className="mt-0.5 text-[13px] text-secondary">章节完成</p>
                </div>
                <div className="rounded-2xl bg-black/[0.03] p-4 text-center">
                  <p className="text-[24px] font-bold text-primary">{streakData.currentStreak}</p>
                  <p className="mt-0.5 text-[13px] text-secondary">连续学习天数</p>
                </div>
              </div>

              {/* 课程名称 */}
              <div className="mb-6 rounded-2xl border border-black/[0.06] p-4">
                <p className="text-[12px] font-medium uppercase tracking-wider text-tertiary">已完成课程</p>
                <p className="mt-1 text-[15px] font-semibold text-primary">{course.topic}</p>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="border-t border-black/[0.06] px-6 py-4">
              <button
                onClick={() => {
                  onClose();
                  router.push('/');
                }}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-cta px-6 py-3 text-[15px] font-semibold text-cta shadow-[0_8px_24px_rgba(255,138,0,0.20)] transition-all duration-150 hover:shadow-[0_12px_32px_rgba(255,138,0,0.25)] active:scale-[0.985]"
              >
                回到首页
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: 添加粒子 CSS 动画**

在 `app/globals.css` 末尾追加：

```css
@keyframes confetti {
  0% {
    transform: translate(0, 0) scale(1);
    opacity: 1;
  }
  100% {
    transform: translate(var(--confetti-x), var(--confetti-y)) scale(0);
    opacity: 0;
  }
}

.animate-confetti {
  animation: confetti 0.8s ease-out forwards;
}
```

- [ ] **Step 3: Commit**

```bash
git add components/CourseCelebrationSheet.tsx app/globals.css
git commit -m "feat: 创建课程完成庆祝弹窗组件"
```

---

### Task 6: 课程目录页集成庆祝弹窗

**Files:**
- Modify: `app/course/[courseId]/page.tsx`

- [ ] **Step 1: 在课程目录页添加庆祝弹窗逻辑**

在 `app/course/[courseId]/page.tsx` 中：

1. 添加 import：
```typescript
import { CourseCelebrationSheet } from '@/components/CourseCelebrationSheet';
```

2. 在 `CoursePage` 函数体中，`const { streakData, studiedToday } = useStreak();` 后添加：
```typescript
const [showCelebration, setShowCelebration] = useState(false);
const celebrationShownRef = useRef(false);
```

3. 添加 useEffect 检测全部完成（放在 `useEffect` 区域内）：
```typescript
// 所有章节完成时弹出庆祝弹窗
useEffect(() => {
  if (!course) return;
  const allCompleted = course.nodes.length > 0 && course.nodes.every(n => n.status === 'completed');
  if (allCompleted && !celebrationShownRef.current) {
    celebrationShownRef.current = true;
    // 短暂延迟，等页面渲染完成
    const timer = setTimeout(() => setShowCelebration(true), 500);
    return () => clearTimeout(timer);
  }
}, [course]);
```

4. 在 `</main>` 关闭标签前、`<ChatLauncher>` 前，添加庆祝弹窗：
```tsx
<CourseCelebrationSheet
  isOpen={showCelebration}
  onClose={() => setShowCelebration(false)}
  course={course}
/>
```

- [ ] **Step 2: Commit**

```bash
git add app/course/[courseId]/page.tsx
git commit -m "feat: 课程全部完成时弹出庆祝弹窗"
```

---

### Task 7: 验证与清理

- [ ] **Step 1: 构建验证**

Run: `npm run build` from the project root

Expected: 构建成功，无 TypeScript 错误。

- [ ] **Step 2: 手动验证清单**

在浏览器中验证以下场景：

1. **Streak 火焰显示**：打开课程目录页，header 右侧应显示火焰图标（首次学习后才会出现）
2. **Streak 未学习灰色**：清除 `streak_data` localStorage 后刷新，火焰应显示为灰色
3. **Streak 打卡**：完成一节学习后返回目录页，火焰应变为彩色
4. **庆祝弹窗**：手动将所有节点状态设为 completed（在 localStorage 中修改），刷新目录页后应弹出庆祝弹窗
5. **庆祝弹窗关闭**：向下滑动 / 点击遮罩 / 点击"回到首页"均可关闭弹窗
6. **向后兼容**：打开其他使用 CourseHeaderBar 的页面（首页、profile、chat 等），确认无异常

- [ ] **Step 3: 更新 CHANGELOG**

在 `CHANGELOG.md` 顶部添加：

```markdown
## 2026-04-12
- 新增连续学习天数（Streak Fire）系统，CourseHeaderBar 展示火焰图标
- 新增课程完成庆祝弹窗，全部章节完成时自动弹出
- 章节完成时自动记录连续学习天数
```
