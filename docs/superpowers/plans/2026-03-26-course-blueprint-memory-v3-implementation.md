# Course Blueprint + Memory V3 + Validator/Refine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将课程生成升级为 blueprint 中间层，将用户记忆升级为 event-sourced 的 Memory V3，并为课程/节点生成接入 validator + 按需 refine 机制。

**Architecture:** 课程生成先产出 `CourseBlueprint`，再派生目录视图 `CourseTreeView`。学习内容生成基于 blueprint 节点元数据生成 `NodeLesson`。用户交互只追加 `MemoryEvent`，通过后台 projector 生成 projections，planning/teaching/chat retrieval 统一从 projections 读取。模型第一次自由生成，本地 validator 失败时才追加一次 refine 调用。

**Tech Stack:** Next.js 16, TypeScript, localStorage, MiniMax API, Node test

---

### Task 0: 补齐可执行的 TypeScript 测试入口

**Files:**
- Modify: `package.json`
- Optional: `tests/` 下辅助运行文件

- [ ] **Step 1: 确定本仓库可运行 `.ts` 测试的方案，并避免继续依赖当前失效的 `node --test` 直接跑 `.ts`**
- [ ] **Step 2: 在 `package.json` 中新增可执行测试命令**
- [ ] **Step 3: 先验证现有测试文件能够被命令加载**
- [ ] **Step 4: 记录运行命令，后续所有任务统一使用该入口**

### Task 1: 定义 CourseBlueprint、NodeLesson 和 Memory V3 类型

**Files:**
- Modify: `types/course.ts`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出 blueprint / node lesson / memory v3 类型的失败测试**
- [ ] **Step 2: 运行测试并确认当前类型与新 schema 不匹配**
- [ ] **Step 3: 在 `types/course.ts` 新增 `CanonicalConcept`、`CourseBlueprint`、`CourseBlueprintNode`、`CourseTreeView`、`NodeLesson`、`MemoryStoreV3`、`MemoryEvent`、各类 projection 和 retrieval payload 类型**
- [ ] **Step 4: 让 `NodeLesson.cards[]` 带上 `coveredConceptIds`，避免后续 validator 重新做正文语义猜测**
- [ ] **Step 5: 删除或标记旧 `userMemory` / `userMemoryV2` 相关类型为废弃路径，不再作为主流程类型**
- [ ] **Step 6: 运行测试确认新类型可被引用**

### Task 2: 重构存储层，切换到新 key 和课程主数据结构

**Files:**
- Modify: `lib/storage.ts`
- Modify: `contexts/CourseContext.tsx`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出存储层应保存 `CourseBlueprint + CourseTreeView + NodeLesson` 的失败测试**
- [ ] **Step 2: 运行测试并确认当前 `ai-learning-data` 结构不足**
- [ ] **Step 3: 将存储 key 切换为 `ai-learning-data-v2`，移除旧课程数据兼容分支**
- [ ] **Step 4: 新增读写 blueprint、tree view、node lesson 的 storage 方法**
- [ ] **Step 5: 在存储初始化路径中清理旧的 `ai-learning-data`、`userMemory`、`userMemoryV2` 键，避免旧数据残留污染新结构**
- [ ] **Step 6: 更新 `CourseContext` 的读取与写入逻辑，确保目录页仍能拿到轻量视图**
- [ ] **Step 7: 运行测试确认课程主数据和视图数据读写正确**

### Task 3: 实现课程 blueprint prompt 与课程级 validator/refine

**Files:**
- Modify: `lib/prompt.ts`
- Create: `lib/validation/course-validator.ts`
- Create: `lib/generation/refine.ts`
- Modify: `app/api/generate/route.ts`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出课程 draft validator 的失败测试**
- [ ] **Step 2: 写出课程 API 在 validator 失败时应触发 refine 的失败测试**
- [ ] **Step 3: 重写课程生成 prompt，让模型输出 `CourseBlueprint` 而不是旧 `CourseTreeResponse`**
- [ ] **Step 4: 在 `course-validator.ts` 实现概念覆盖、前置依赖、标题质量、risk remediation 等硬约束检查**
- [ ] **Step 5: 在 `refine.ts` 实现“draft + issues -> refine prompt”构造函数**
- [ ] **Step 6: 改造 `app/api/generate/route.ts`：第一次生成 blueprint，validator 失败时 refine 一次，通过后派生 `CourseTreeView` 并返回**
- [ ] **Step 7: 运行测试确认 pass 场景不会 refine，fail 场景会 refine 一次**

### Task 4: 实现节点内容 prompt 与节点级 validator/refine

**Files:**
- Modify: `lib/prompt.ts`
- Create: `lib/validation/node-validator.ts`
- Modify: `app/api/generate/node/route.ts`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出 `NodeLesson` validator 的失败测试**
- [ ] **Step 2: 写出节点 API 在 concept 未覆盖或题目未命中 target 时触发 refine 的失败测试**
- [ ] **Step 3: 改写节点内容 prompt，输入改为 blueprint node 元数据与 `TeachingRetrievalPayload`**
- [ ] **Step 4: 在 `node-validator.ts` 实现 teachConcept 覆盖、assessmentTarget 命中、`targetConceptId` 合法性、`cardId` 对齐等检查**
- [ ] **Step 5: 改造 `app/api/generate/node/route.ts`，让节点生成输出 `NodeLesson` 并在 validator 失败时 refine 一次**
- [ ] **Step 6: 运行测试确认节点 lesson 的结构与校验链路正确**

### Task 5: 建立 Memory V3 事件模型与 projector

**Files:**
- Modify: `lib/memory/aggregator.ts`
- Modify: `lib/memory/repository.ts`
- Modify: `hooks/useUserMemory.ts`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出从 `MemoryEvent[]` 重建 `ConceptProjection` / `TopicProjection` / `EpisodicProjection` 的失败测试**
- [ ] **Step 2: 运行测试并确认当前 memory 实现仍是同步写派生结果**
- [ ] **Step 3: 在 `aggregator.ts` 中新增 event projector 纯函数，支持 course/node/question/chat/summary 事件**
- [ ] **Step 4: 在 `repository.ts` 中切换到 `memoryStoreV3` 读取、保存和快照重建**
- [ ] **Step 5: 在 `hooks/useUserMemory.ts` 中把现有方法改成 append event 的热路径接口**
- [ ] **Step 6: 增加 event compaction 规则，确保 localStorage 中不会无限增长**
- [ ] **Step 7: 运行测试确认热路径不会直接改 projection，只会触发 append + projector 重建**

### Task 6: 实现 ConceptLinker，并重建 planning / teaching / chat retrieval builder

**Files:**
- Modify: `lib/memory/aggregator.ts`
- Modify: `lib/memory/repository.ts`
- Modify: `lib/chat-context.ts`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出 `ConceptLinker` 的失败测试，覆盖 current node / course scope / alias / fallback 四类命中**
- [ ] **Step 2: 写出 `PlanningRetrievalPayload`、`TeachingRetrievalPayload`、`ChatMemoryPayload` 基于 projection 构建的失败测试**
- [ ] **Step 3: 运行测试并确认当前 retrieval 仍依赖旧式 topic text matching**
- [ ] **Step 4: 在 `aggregator.ts` 中实现集中式 `ConceptLinker`，统一自由文本到 concept id 的链接逻辑**
- [ ] **Step 5: 让 retrieval 优先使用 concept id / topic projection / episodic projection，alias 与 token overlap 仅作为 `ConceptLinker` 的 fallback**
- [ ] **Step 6: 更新聊天上下文构造逻辑，让其消费新的 projection 和当前节点 concept 元数据**
- [ ] **Step 7: 运行测试确认 planning/teaching/chat payload 的主召回来自结构化投影**

### Task 7: 更新前端学习链路，让 memory 回写绑定 targetConceptId

**Files:**
- Modify: `app/course/[courseId]/learn/[nodeIndex]/page.tsx`
- Modify: `components/ui/ChatWidget.tsx`
- Modify: `hooks/useChatHistory.ts`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出题目提交后应基于 `targetConceptId` 记录事件的失败测试**
- [ ] **Step 2: 写出聊天会话结束或截断时生成 episodic summary event 的失败测试**
- [ ] **Step 3: 改造学习页答题提交逻辑，优先使用 `question.targetConceptId`，不再从题干抽 concept**
- [ ] **Step 4: 改造聊天组件发送逻辑，只写 `chat_user_message` 事件**
- [ ] **Step 5: 改造聊天历史 hook，在截断、过期或结束时产出 `chat_session_summarized` 事件输入**
- [ ] **Step 6: 运行测试确认学习和聊天都回写到了新事件模型**

### Task 8: 增加后台 flush 策略与重复请求保护

**Files:**
- Modify: `hooks/useUserMemory.ts`
- Modify: `contexts/CourseContext.tsx`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出 memory flush 策略的失败测试或可验证行为测试**
- [ ] **Step 2: 为 memory projector 增加 `requestIdleCallback + debounce + visibilitychange flush` 机制**
- [ ] **Step 3: 为节点生成增加 in-flight 去重，避免预加载和用户进入节点时重复请求**
- [ ] **Step 4: 运行测试确认 flush 和去重逻辑不破坏主流程**

### Task 9: 文档和验收说明

**Files:**
- Modify: `CHANGELOG.md`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 运行相关测试并记录结果**
- [ ] **Step 2: 更新 `CHANGELOG.md` 记录 blueprint、memory v3、validator/refine 重构**
- [ ] **Step 3: 记录未覆盖风险点、后续服务端迁移方向和验收结论**
