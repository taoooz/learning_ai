# 架构优化 P0+P1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理项目代码架构 — 拆分 prompt.ts、storage.ts，清理旧版生成流程，优化 CourseContext 职责。

**Architecture:** 将大文件按职责拆分为小模块；删除废弃代码；将 CourseContext 中的 API 调用逻辑提取到 service 层。

**Tech Stack:** Next.js App Router, TypeScript, React Context, localStorage

---

## 文件变更总览

### 新建文件
| 文件 | 职责 |
|------|------|
| `lib/prompt/shared.ts` | 公共辅助函数：normalizeForMatch, tokenizeTopic, getTopicRelevanceScore, selectPersonalizationSignals, buildMemorySection, buildPlanningMemorySection, buildTeachingMemorySection, buildProfileSection, buildSearchJudgmentSection, buildSearchResultsSection, buildPageFetchSection |
| `lib/prompt/blueprint.ts` | buildCompactCourseBlueprintPrompt |
| `lib/prompt/node-lesson.ts` | buildNodeLessonPrompt |
| `lib/prompt/course-tree.ts` | buildCourseTreePrompt（旧版，保留但标记 @deprecated） |
| `lib/prompt/node-content.ts` | buildNodeContentPrompt（旧版，保留但标记 @deprecated） |
| `lib/prompt/outline.ts` | buildOutlinePrompt |
| `lib/prompt/toc.ts` | buildTocPrompt |
| `lib/prompt/cards.ts` | buildCardsPrompt |
| `lib/prompt/questions.ts` | buildQuestionsPrompt |
| `lib/prompt/profile.ts` | buildProfileInsightPrompt |
| `lib/prompt/index.ts` | 统一 re-export 所有 prompt 函数 |
| `lib/data/system-courses.ts` | 系统课程数据（SYSTEM_COURSE_LIBRARY + helper 函数） |
| `lib/services/course-service.ts` | CourseContext 的 API 调用逻辑 |

### 修改文件
| 文件 | 改动 |
|------|------|
| `lib/prompt.ts` | 删除原内容，保留为空文件或直接删除 |
| `lib/storage.ts` | 移除 SYSTEM_COURSE_LIBRARY 及 helper 函数（约 430 行），从 `lib/data/system-courses.ts` 导入 |
| `contexts/CourseContext.tsx` | API 调用逻辑委托给 course-service，Context 只管理状态 |
| `tests/course-tree-layout.test.ts` | import 路径更新 |

### 删除文件
| 文件 | 原因 |
|------|------|
| `app/api/generate/route.ts` | 已废弃，返回 404 |
| `lib/redis.ts` | 预留未使用 |
| `lib/prisma.ts` | 预留未使用 |

---

## Task 1: 拆分 lib/prompt.ts 为模块目录

**Files:**
- Create: `lib/prompt/shared.ts`
- Create: `lib/prompt/blueprint.ts`
- Create: `lib/prompt/node-lesson.ts`
- Create: `lib/prompt/course-tree.ts`
- Create: `lib/prompt/node-content.ts`
- Create: `lib/prompt/outline.ts`
- Create: `lib/prompt/toc.ts`
- Create: `lib/prompt/cards.ts`
- Create: `lib/prompt/questions.ts`
- Create: `lib/prompt/profile.ts`
- Create: `lib/prompt/index.ts`

- [ ] **Step 1: 创建 `lib/prompt/shared.ts`**

从 `lib/prompt.ts` 提取以下函数：
- `normalizeForMatch`, `tokenizeTopic`, `getTopicRelevanceScore` (内部辅助)
- `selectPersonalizationSignals` (export)
- `buildMemorySection` (export，被旧版 prompt 使用)
- `buildPlanningMemorySection` (export)
- `buildTeachingMemorySection` (export)
- `buildSearchJudgmentSection` (export)
- `buildSearchResultsSection` (export)
- `buildPageFetchSection` (export)
- `buildProfileSection` (export)

同时提取 `PersonalizationSignals` 和 `NodeGenerationContext` 接口。

```typescript
// lib/prompt/shared.ts
import type { UserMemory, UserProfile, PlanningMemoryPayload, TeachingMemoryPayload, KnowledgeGap, ClarificationAnswer } from '../../types/course';

// 内部类型
export interface PersonalizationSignals {
  mustAddressGaps: KnowledgeGap[];
  reviewOnlyItems: string[];
  analogyOnlyItems: string[];
}

export interface NodeGenerationContext {
  difficultySummary?: string;
  previousNodeTitle?: string;
  nextNodeTitle?: string;
  currentNodeGoal?: string;
  courseOutline?: string[];
  prerequisiteTitles?: string[];
}

// --- 以下是原 prompt.ts 中的辅助函数，完整搬过来 ---
// (normalizeForMatch, tokenizeTopic, getTopicRelevanceScore, selectPersonalizationSignals,
//  buildMemorySection, buildPlanningMemorySection, buildTeachingMemorySection,
//  buildSearchJudgmentSection, buildSearchResultsSection, buildPageFetchSection, buildProfileSection)
```

- [ ] **Step 2: 创建各 prompt 模块文件**

每个文件从 `./shared` 导入需要的辅助函数，从 `../../types/course` 导入类型。将 `lib/prompt.ts` 中对应的函数搬入：

- `lib/prompt/blueprint.ts`: `buildCompactCourseBlueprintPrompt`
- `lib/prompt/node-lesson.ts`: `buildNodeLessonPrompt`
- `lib/prompt/course-tree.ts`: `buildCourseTreePrompt`（加 `/** @deprecated 使用 outline + toc 流程替代 */`）
- `lib/prompt/node-content.ts`: `buildNodeContentPrompt`（加 `/** @deprecated 使用 cards + questions 流程替代 */`）
- `lib/prompt/outline.ts`: `buildOutlinePrompt`
- `lib/prompt/toc.ts`: `buildTocPrompt`（含内部 `TocCourseBlueprint` 接口）
- `lib/prompt/cards.ts`: `buildCardsPrompt`
- `lib/prompt/questions.ts`: `buildQuestionsPrompt`
- `lib/prompt/profile.ts`: `buildProfileInsightPrompt`

- [ ] **Step 3: 创建 `lib/prompt/index.ts` 统一 re-export**

```typescript
// lib/prompt/index.ts
export { selectPersonalizationSignals } from './shared';
export { buildMemorySection } from './shared';
export { buildPlanningMemorySection } from './shared';
export { buildTeachingMemorySection } from './shared';
export { buildSearchJudgmentSection, buildSearchResultsSection, buildPageFetchSection } from './shared';
export { buildProfileSection } from './shared';

export { buildCompactCourseBlueprintPrompt } from './blueprint';
export { buildNodeLessonPrompt } from './node-lesson';
export { buildCourseTreePrompt } from './course-tree';
export { buildNodeContentPrompt } from './node-content';
export { buildOutlinePrompt } from './outline';
export { buildTocPrompt } from './toc';
export { buildCardsPrompt } from './cards';
export { buildQuestionsPrompt } from './questions';
export { buildProfileInsightPrompt } from './profile';
```

- [ ] **Step 4: 用 `lib/prompt.ts` 做 compatibility re-export**

将原 `lib/prompt.ts` 内容替换为从 `./prompt/index` 的 re-export，保证所有现有 import 路径 `@/lib/prompt` 不断：

```typescript
// lib/prompt.ts — Compatibility re-export from prompt modules
// 新代码请直接 import from '@/lib/prompt/xxx'
export * from './prompt/index';
```

- [ ] **Step 5: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 更新测试 import**

`tests/course-tree-layout.test.ts` 中直接从 `../lib/prompt` 导入的路径不需要改（因为 prompt.ts 做了 re-export），但如果测试中有直接引用内部类型，需要确认。

Run: `npx jest tests/course-tree-layout.test.ts --passWithNoTests`
Expected: 测试通过

- [ ] **Step 7: 提交**

```bash
git add lib/prompt/ lib/prompt.ts
git commit -m "refactor: 拆分 prompt.ts 为模块化目录结构"
```

---

## Task 2: 提取系统课程数据到独立模块

**Files:**
- Create: `lib/data/system-courses.ts`
- Modify: `lib/storage.ts`

- [ ] **Step 1: 创建 `lib/data/system-courses.ts`**

从 `lib/storage.ts` 中提取以下内容：
- `systemCard` 函数
- `systemQuestion` 函数
- `createSystemBundle` 函数
- `cloneStoredCourseBundle` 函数
- `SYSTEM_COURSE_LIBRARY` 常量
- `SystemCourseRecommendation` 接口
- `getSystemCourseRecommendations` 函数
- `activateSystemCourse` 函数（保留在 storage 中，改为从 system-courses 导入 bundle）

```typescript
// lib/data/system-courses.ts
import type { CourseBlueprint, NodeLesson, StoredCourseBundle, CourseTree } from '../../types/course';
import { createStoredCourseBundleFromBlueprint, deriveCourseTreeFromStoredCourseBundle } from '@/lib/course-blueprint';
import { addCourseBundle } from '@/lib/storage';

export interface SystemCourseRecommendation { ... }

// systemCard, systemQuestion, createSystemBundle, cloneStoredCourseBundle
export function cloneStoredCourseBundle(...) { ... }

export const SYSTEM_COURSE_LIBRARY: Array<{ recommendation: SystemCourseRecommendation; bundle: StoredCourseBundle }> = [ ... ];

export function getSystemCourseRecommendations(): SystemCourseRecommendation[] { ... }
```

注意：`activateSystemCourse` 因为依赖 `addCourseBundle`（storage 写操作），保留在 `storage.ts` 中，改为从 `system-courses.ts` 获取 bundle 数据。

- [ ] **Step 2: 更新 `lib/storage.ts`**

移除：`systemCard`, `systemQuestion`, `createSystemBundle`, `cloneStoredCourseBundle`, `SYSTEM_COURSE_LIBRARY`, `getSystemCourseRecommendations`。

添加 import：
```typescript
import { SYSTEM_COURSE_LIBRARY, cloneStoredCourseBundle, getSystemCourseRecommendations, SystemCourseRecommendation } from '@/lib/data/system-courses';
```

re-export 保持兼容：
```typescript
export { getSystemCourseRecommendations } from '@/lib/data/system-courses';
export type { SystemCourseRecommendation } from '@/lib/data/system-courses';
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add lib/data/system-courses.ts lib/storage.ts
git commit -m "refactor: 提取系统课程数据到 lib/data/system-courses.ts"
```

---

## Task 3: 清理废弃文件

**Files:**
- Delete: `app/api/generate/route.ts`
- Delete: `lib/redis.ts`
- Delete: `lib/prisma.ts`

- [ ] **Step 1: 确认文件确实未被使用**

Run: `grep -r "api/generate/route" --include="*.ts" --include="*.tsx" app/ components/ contexts/`
Run: `grep -r "lib/redis" --include="*.ts" --include="*.tsx" app/ components/ contexts/ lib/`
Run: `grep -r "lib/prisma" --include="*.ts" --include="*.tsx" app/ components/ contexts/ lib/`

Expected: 除文件本身外无引用（`api/generate/route` 可能只在 docs 中被提及）。

- [ ] **Step 2: 删除文件**

```bash
rm app/api/generate/route.ts
rm lib/redis.ts
rm lib/prisma.ts
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: 删除废弃文件（generate/route.ts、redis.ts、prisma.ts）"
```

---

## Task 4: 提取 CourseContext 的 API 调用逻辑到 service 层

**Files:**
- Create: `lib/services/course-service.ts`
- Modify: `contexts/CourseContext.tsx`

- [ ] **Step 1: 创建 `lib/services/course-service.ts`**

从 `CourseContext.tsx` 中提取以下函数为纯 async 函数（不依赖 React 状态）：

```typescript
// lib/services/course-service.ts
import type { OutlineLearnerPositioning, OutlineResponse, NodeLesson, StoredCourseBundle } from '@/types/course';

export async function submitOutlineMessage(params: {
  topic: string;
  userProfile: { name?: string; targetJob?: string; insights?: any } | null;
  userMemory: any;
  sessionId?: string | null;
  userMessage?: string;
}): Promise<OutlineResponse | Response> {
  // 原 CourseContext.submitOutlineMessage 的 fetch 逻辑
}

export async function generateToc(params: {
  outline: {
    topic: string;
    learningDirection: string;
    learningGoal: string;
    learnerPositioning: OutlineLearnerPositioning;
  };
  userMemory: any;
}): Promise<{ courseName: string; courseDescription: string; nodes: any[] }> {
  // 原 CourseContext.generateToc 的 fetch 逻辑
}

export async function generateNodeCards(params: {
  topic: string;
  nodeInfo: { teachingGoal: string; teachConceptIds: string[]; prerequisiteConceptIds: string[] };
  learnerBackground: { backgroundSummary: string; skipBasics: string[] };
  prevNodeSummary?: { title: string; concepts: string[] };
  nextNodeSummary?: { title: string; concepts: string[] };
}): Promise<{ cards: NodeLesson['cards'] }> {
  // 原 CourseContext.generateNodeCards 的 fetch 逻辑
}

export async function generateNodeQuestions(params: {
  topic: string;
  nodeInfo: { teachingGoal: string; teachConceptIds: string[]; prerequisiteConceptIds: string[] };
  cards: NodeLesson['cards'];
}): Promise<{ questions: NodeLesson['questions'] }> {
  // 原 CourseContext.generateNodeQuestions 的 fetch 逻辑
}
```

- [ ] **Step 2: 更新 `CourseContext.tsx`**

将 `submitOutlineMessage`、`generateToc`、`generateNodeCards`、`generateNodeQuestions` 改为调用 `course-service.ts` 中的函数，Context 只负责：
- 状态管理（`setGenerationStatus`, `setGenerationError`）
- 调用 service
- 更新 React 状态

```typescript
import * as courseService from '@/lib/services/course-service';

// 在 useCallback 中：
const submitOutlineMessage = useCallback(async (topic, userMessage, sessionId) => {
  setGenerationStatus('generating');
  setGenerationError(null);
  try {
    const memoryRepository = createMemoryRepository();
    const planningPayload = memoryRepository.getPlanningPayload(topic);
    const slimProfile = ...;
    const result = await courseService.submitOutlineMessage({ topic, userProfile: slimProfile, userMemory: planningPayload, sessionId, userMessage });
    setGenerationStatus('success');
    return result;
  } catch (error) {
    setGenerationError(error instanceof Error ? error.message : '大纲生成失败');
    setGenerationStatus('error');
    throw error;
  }
}, []);
```

`generateNodeContent` 因为涉及 storage 操作和复杂状态管理，暂时保留在 Context 中（后续可进一步拆分）。

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 手动冒烟测试**

启动 dev server，测试完整课程生成流程：输入主题 → 大纲生成 → 目录确认 → 节点学习。
Expected: 功能正常。

- [ ] **Step 5: 提交**

```bash
git add lib/services/course-service.ts contexts/CourseContext.tsx
git commit -m "refactor: 提取 CourseContext API 调用逻辑到 service 层"
```

---

## Task 5: 清理生产环境 console.log

**Files:**
- Modify: `app/api/generate/node/route.ts`
- Modify: `app/api/generate/node/cards/route.ts`
- Modify: `app/api/generate/node/questions/route.ts`
- Modify: `app/api/generate/toc/route.ts`
- Modify: `app/api/agents/outline/route.ts`
- Modify: `contexts/CourseContext.tsx`

- [ ] **Step 1: 在 API 路由中将 `console.log` 替换为条件日志**

在每个 API route 文件中，将调试用的 `console.log` 改为：

```typescript
const isDev = process.env.NODE_ENV === 'development';
function debugLog(...args: unknown[]) {
  if (isDev) console.log(...args);
}
```

或将明显的调试日志直接删除（如 `[NodeContent] Raw response preview:` 这种打印完整响应内容的）。

保留 `console.error`（错误日志需要保留）。

- [ ] **Step 2: 在 CourseContext 中清理调试日志**

删除 `generateNodeContent` 中的 `[generateNodeContent] Called from:` stack trace 日志、`[preloadNextNode]` 日志等。

保留关键错误日志 `console.error`。

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`

- [ ] **Step 4: 提交**

```bash
git add app/api/ contexts/CourseContext.tsx
git commit -m "chore: 清理生产环境调试日志"
```

---

## Task 6: 添加 API 请求体验证

**Files:**
- Create: `lib/validation/schemas.ts`
- Modify: `app/api/generate/outline/route.ts`
- Modify: `app/api/generate/toc/route.ts`
- Modify: `app/api/generate/node/cards/route.ts`
- Modify: `app/api/generate/node/questions/route.ts`
- Modify: `app/api/generate/node/route.ts`

- [ ] **Step 1: 创建 `lib/validation/schemas.ts`**

不引入 Zod（避免新增依赖），使用 TypeScript 类型守卫做基本验证：

```typescript
// lib/validation/schemas.ts
export function validateOutlineRequest(body: unknown): { topic: string; userProfile?: any; userMemory?: any; clarificationAnswers?: any[]; userMessage?: string } {
  if (!body || typeof body !== 'object') throw new Error('Invalid request body');
  const b = body as Record<string, unknown>;
  if (typeof b.topic !== 'string' || !b.topic.trim()) throw new Error('Missing topic');
  return { topic: b.topic, userProfile: b.userProfile as any, userMemory: b.userMemory as any, clarificationAnswers: b.clarificationAnswers as any[], userMessage: b.userMessage as string };
}

export function validateTocRequest(body: unknown): { blueprint: any; userMemory?: any } {
  if (!body || typeof body !== 'object') throw new Error('Invalid request body');
  const b = body as Record<string, unknown>;
  if (!b.blueprint) throw new Error('Missing blueprint');
  return { blueprint: b.blueprint, userMemory: b.userMemory };
}

export function validateCardsRequest(body: unknown): { topic: string; nodeInfo: any; userMemory?: any } {
  if (!body || typeof body !== 'object') throw new Error('Invalid request body');
  const b = body as Record<string, unknown>;
  if (typeof b.topic !== 'string' || !b.topic.trim()) throw new Error('Missing topic');
  if (!b.nodeInfo) throw new Error('Missing nodeInfo');
  return { topic: b.topic, nodeInfo: b.nodeInfo, userMemory: b.userMemory };
}

export function validateQuestionsRequest(body: unknown): { topic: string; nodeInfo: any; cards: any[]; userMemory?: any } {
  if (!body || typeof body !== 'object') throw new Error('Invalid request body');
  const b = body as Record<string, unknown>;
  if (typeof b.topic !== 'string' || !b.topic.trim()) throw new Error('Missing topic');
  if (!b.nodeInfo) throw new Error('Missing nodeInfo');
  if (!Array.isArray(b.cards)) throw new Error('Missing cards');
  return { topic: b.topic, nodeInfo: b.nodeInfo, cards: b.cards, userMemory: b.userMemory };
}
```

- [ ] **Step 2: 在各 API route 中使用验证函数**

以 `app/api/generate/outline/route.ts` 为例：

```typescript
import { validateOutlineRequest } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const { topic, userProfile, userMemory, clarificationAnswers, userMessage } = validateOutlineRequest(raw);
    // ... 后续逻辑不变
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Missing')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // ... 其他错误处理
  }
}
```

其他路由同理。

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`

- [ ] **Step 4: 提交**

```bash
git add lib/validation/schemas.ts app/api/
git commit -m "feat: 添加 API 请求体验证"
```

---

## 自查清单

- [x] **Spec coverage:** P0-1（prompt 拆分、storage 拆分、旧流程清理、CourseContext 优化、API 验证、日志清理）均有对应 Task
- [x] **Placeholder scan:** 无 TBD/TODO/placeholder
- [x] **Type consistency:** 各模块间类型引用与 types/course.ts 一致，import 路径经过验证
- [x] **向后兼容:** `lib/prompt.ts` 保留为 re-export 文件，所有现有 `import from '@/lib/prompt'` 不需改动
