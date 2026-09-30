# 课程质量改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化课程生成质量，通过改进 Prompt 工程和用户画像洞察机制，实现更个性化、更易理解的学习内容

**Architecture:**
- 用户画像洞察：在 Profile 保存时调用 AI 提取 `knowledgeBackground`、`analogyExperiences`、`summary`
- Prompt 优化：课程树和节点内容生成时结合洞察信息，增加质量标准
- 内容验证：节点内容生成后增加验证层（阶段二）

**Tech Stack:** Next.js, TypeScript, MiniMax API, localStorage

---

## 任务清单

### Task 1: 调整 LearningInsight 类型定义

**Files:**
- Modify: `types/course.ts`

**Steps:**
- [ ] 将 `LearningInsight` 接口调整为：
```typescript
interface LearningInsight {
  knowledgeBackground: string[];
  analogyExperiences: string[];
  summary: string;
}
```
- [ ] 确保 `UserProfile` 包含 `insights: LearningInsight`

- [ ] Commit: `types: update LearningInsight to use knowledgeBackground, analogyExperiences, summary`

---

### Task 2: 新增洞察提取 Prompt 函数

**Files:**
- Modify: `lib/prompt.ts`

**Steps:**
- [ ] 新增 `buildProfileInsightPrompt(profile: UserProfile): string` 函数
- [ ] Prompt 要求只提取事实（knowledgeBackground、analogyExperiences）
- [ ] 生成一句话 summary

- [ ] Commit: `prompt: add buildProfileInsightPrompt function`

---

### Task 3: 新增洞察提取 API

**Files:**
- Create: `app/api/profile/insights/route.ts`

**Steps:**
- [ ] 创建 `POST /api/profile/insights` 端点
- [ ] 调用 `buildProfileInsightPrompt` 生成 prompt
- [ ] 调用 MiniMax 获取洞察结果
- [ ] 更新 UserProfile 的 insights 字段
- [ ] 返回更新后的 profile

```typescript
export async function POST(request: NextRequest) {
  try {
    const profile = await request.json();
    const prompt = buildProfileInsightPrompt(profile);
    const content = await callMiniMax(prompt);
    const insights = parseJSONResponse<LearningInsight>(content);

    // 更新 storage 中的 profile
    const currentProfile = getUserProfile();
    if (currentProfile) {
      currentProfile.insights = insights;
      saveUserProfile(currentProfile);
      return NextResponse.json(currentProfile);
    }

    return NextResponse.json({ insights });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to extract insights' }, { status: 500 });
  }
}
```

- [ ] Commit: `api: add /api/profile/insights endpoint for insight extraction`

---

### Task 4: 更新 Profile 页面调用洞察 API

**Files:**
- Modify: `app/profile/page.tsx`

**Steps:**
- [ ] 在保存 Profile 成功后，调用 `POST /api/profile/insights`
- [ ] 传递完整的 profile 数据
- [ ] 更新 local storage 中的 insights

- [ ] Commit: `profile: call insights API after saving`

---

### Task 4.5: 更新 UserProfileContext 同步洞察数据

**Files:**
- Modify: `contexts/UserProfileContext.tsx`

**Steps:**
- [ ] 确保 `updateProfile` 函数同步保存 insights
- [ ] 确保从 storage 加载时正确恢复 insights 状态

- [ ] Commit: `contexts: ensure UserProfileContext syncs insights data`

---

### Task 5: 优化课程树生成 Prompt

**Files:**
- Modify: `lib/prompt.ts`

**Steps:**
- [ ] 重构 `buildCourseTreePrompt` 函数
- [ ] 结合 insights 中的 `knowledgeBackground` 和 `analogyExperiences`
- [ ] 增加质量标准描述（结构清晰、目标明确、可实践、有关联）
- [ ] 移除 `learningGoal`、`learningStyle` 相关引用

- [ ] Commit: `prompt: enhance buildCourseTreePrompt with quality standards and insights`

---

### Task 6: 优化节点内容生成 Prompt

**Files:**
- Modify: `lib/prompt.ts`

**Steps:**
- [ ] 重构 `buildNodeContentPrompt` 函数
- [ ] 结合 insights 中的 `knowledgeBackground` 和 `analogyExperiences`
- [ ] 增加"好卡片"质量标准（场景引入、清晰定义、避坑提示、一句话总结）
- [ ] 增加"好 Quiz"质量标准（考察维度、难度等级、对应卡片）
- [ ] 增加 `dimension`、`difficulty`、`cardId` 字段到 Question 类型

- [ ] Commit: `prompt: enhance buildNodeContentPrompt with quality standards`

---

### Task 7: 更新 Question 类型定义

**Files:**
- Modify: `types/course.ts`

**Steps:**
- [ ] 在 `Question` 接口增加可选字段：
```typescript
interface Question {
  // ... existing fields
  dimension?: 'memory' | 'understanding' | 'application' | 'analysis';
  difficulty?: 1 | 2 | 3;
  cardId?: string;
}
```

- [ ] Commit: `types: add dimension, difficulty, cardId to Question`

---

### Task 8: 更新课程生成 API 使用洞察

**Files:**
- Modify: `app/api/generate/route.ts`

**Steps:**
- [ ] 从 storage 获取 UserProfile
- [ ] 传递 insights 给 `buildCourseTreePrompt`
- [ ] 确保洞察信息正确拼接

- [ ] Commit: `api: pass insights to course tree generation`

---

### Task 9: 更新节点内容生成 API 使用洞察

**Files:**
- Modify: `app/api/generate/node/route.ts`

**Steps:**
- [ ] 从 storage 获取 UserProfile
- [ ] 传递 insights 给 `buildNodeContentPrompt`

- [ ] Commit: `api: pass insights to node content generation`

---

### Task 10: 更新 CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

**Steps:**
- [ ] 记录本次课程质量改进内容

- [ ] Commit: `changelog: document course quality improvements`

---

## 阶段二（后续任务）

### Task 11: 新增内容验证层

**Files:**
- Create: `lib/verify.ts`

**Steps:**
- [ ] 创建 `verifyNodeContent` 函数
- [ ] 检查答案正确性、选项合理性、卡片-题目匹配
- [ ] 在节点内容生成后调用验证
- [ ] 设置最大重试次数（2次）
- [ ] 重试耗尽时标记 `hasWarnings: true`

- [ ] Commit: `verify: add content verification layer`

---

## 依赖关系

```
Task 1 (types) → Task 2 (prompt)
Task 2 → Task 3 (API)
Task 3 → Task 4 (profile page)
Task 4 → Task 4.5 (context sync)
Task 2 + Task 7 → Task 5 (course tree prompt)
Task 2 + Task 7 → Task 6 (node content prompt)
Task 5 → Task 8 (generate API)
Task 6 → Task 9 (node API)
Task 1-9 → Task 10 (CHANGELOG)
Task 11 独立，可在阶段一完成后进行
```
