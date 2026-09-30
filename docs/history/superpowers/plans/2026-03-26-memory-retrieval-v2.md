# Memory Retrieval V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 prompt 拼接式 memory 升级为可迁移到服务端的 v2 schema，并用双层 retrieval 支撑课程目录与节点内容生成。

**Architecture:** 保留现有 localStorage 存储入口，但新增 signal/state/summaries 分层的 `MemoryStoreV2`。前端和 API 通过 planning/teaching payload builder 获取结构化记忆输入，prompt 不再直接扫描原始 memory。通过迁移函数兼容旧版 memory，并用纯函数聚合维持后续可迁移到服务端的边界。

**Tech Stack:** Next.js 16, TypeScript, localStorage, Node test

---

### Task 1: 定义 Memory V2 类型与迁移入口

**Files:**
- Modify: `types/course.ts`
- Modify: `hooks/useUserMemory.ts`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出会失败的迁移测试**
- [ ] **Step 2: 运行测试并确认因缺少 v2 结构失败**
- [ ] **Step 3: 在 `types/course.ts` 增加 v2 schema 与 retrieval payload 类型**
- [ ] **Step 4: 在 `hooks/useUserMemory.ts` 增加 v1 -> v2 迁移与统一读取入口**
- [ ] **Step 5: 运行测试确认通过**

### Task 2: 实现 signal/state 聚合与双层 retrieval builder

**Files:**
- Modify: `hooks/useUserMemory.ts`
- Modify: `types/course.ts`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出 planning payload / teaching payload 的失败测试**
- [ ] **Step 2: 运行测试并确认因 builder 缺失或输出不符失败**
- [ ] **Step 3: 实现 signal append、topic/concept state 聚合、打分和 gating 逻辑**
- [ ] **Step 4: 暴露 `getPlanningMemoryPayload` / `getTeachingMemoryPayload`**
- [ ] **Step 5: 运行测试确认通过**

### Task 3: 改造 prompt 注入格式

**Files:**
- Modify: `lib/prompt.ts`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出 prompt 应使用结构化 planning/teaching payload 的失败测试**
- [ ] **Step 2: 运行测试并确认旧 prompt 输出不符合要求**
- [ ] **Step 3: 重构课程目录与节点内容 prompt，改为注入结构化决策块**
- [ ] **Step 4: 保留现有搜索增强逻辑，确保 prompt 输出仍兼容 JSON 流程**
- [ ] **Step 5: 运行测试确认通过**

### Task 4: 接入生成链路与学习记录写入

**Files:**
- Modify: `contexts/CourseContext.tsx`
- Modify: `app/api/generate/route.ts`
- Modify: `app/api/generate/node/route.ts`
- Modify: `app/course/[courseId]/learn/[nodeIndex]/page.tsx`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 写出课程目录和节点生成链路使用 retrieval payload 的失败测试（纯函数级）**
- [ ] **Step 2: 运行测试并确认当前调用链未传入新 payload**
- [ ] **Step 3: 让课程目录生成调用 planning payload，节点生成调用 teaching payload**
- [ ] **Step 4: 修正学习完成写入，避免节点标题污染 topic 级学习记录**
- [ ] **Step 5: 运行测试确认通过**

### Task 5: 文档与验证

**Files:**
- Modify: `CHANGELOG.md`
- Test: `tests/course-tree-layout.test.ts`

- [ ] **Step 1: 更新 `CHANGELOG.md` 记录 memory v2 与 retrieval 改造**
- [ ] **Step 2: 运行完整相关测试命令并记录结果**
- [ ] **Step 3: 说明未覆盖的风险点与后续服务端迁移接口**
