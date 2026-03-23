# 课程质量改进方案

## 概述

优化课程生成质量，通过改进 Prompt 工程、用户画像处理和内容质量标准，实现更个性化、更易理解的学习内容。

## 核心设计原则

1. **理解用户，而非限制用户** — 用户背景是洞察来源，不是约束条件
2. **约束目标，不约束格式** — 告诉 AI 要达到什么效果，让它自主决定怎么做
3. **精炼信息，高效传递** — 原文 → 洞察 → prompt，避免信息噪音
4. **质量可预期** — 通过标准和验证让输出质量更稳定

---

## 一、用户画像：AI 提取洞察机制

### 问题

当前用户画像直接原文拼接到 prompt，导致：
- 信息冗余，prompt 膨胀
- AI 难以从原始简历中提取学习相关洞察

### 解决方案

**流程：**
```
用户保存简历 → AI 提取学习洞察 → 存储洞察结论 → 课程生成时使用
```

### 数据结构

```typescript
// types/course.ts 调整

interface LearningInsight {
  // 用户的知识背景（从教育+工作经历提取的事实）
  knowledgeBackground: string[];
  // 可用于类比的经历（从工作/生活经历中提取的事实）
  analogyExperiences: string[];
  // 总结（一句话概括，便于 prompt 使用）
  summary: string;
}

interface UserProfile {
  name?: string;
  targetJob: string;
  workExperience: WorkExperience[];
  education: Education[];
  // AI 提取的洞察结论
  insights: LearningInsight;
}
```

### 洞察提取 Prompt

```typescript
// lib/prompt.ts 新增

export function buildProfileInsightPrompt(profile: UserProfile): string {
  return `你是一个学习规划专家。请从以下用户信息中提取与学习课程相关的洞察。

要求：只提取事实，不要推测。关注与"学习"最相关的信息。

目标岗位：${profile.targetJob || '未填写'}

工作经历：
${profile.workExperience && profile.workExperience.length > 0
  ? profile.workExperience.map(w => `- ${w.company}，${w.position}${w.description ? '，工作内容：' + w.description : ''}`).join('\n')
  : '暂无'}

教育背景：
${profile.education && profile.education.length > 0
  ? profile.education.map(e => `- ${e.school}，${e.major}`).join('\n')
  : '暂无'}

请提取以下信息用于帮助生成个性化课程（用中文回答）：

1. knowledgeBackground：用户已具备的相关知识背景（从工作经历和教育背景中提取的事实）
2. analogyExperiences：用户经历中可用于类比的场景（用熟悉的场景解释陌生概念）
3. summary：一句话总结用户背景特点

输出 JSON 格式：
{
  "knowledgeBackground": ["背景1", "背景2"],
  "analogyExperiences": ["经历场景1", "经历场景2"],
  "summary": "一句话总结"
}`;
}
```

### API 设计

**新增 API 端点：**
```
POST /api/profile/insights
```

**流程：**
1. 用户保存 profile 后，前端调用此 API
2. 后端调用 MiniMax 提取洞察
3. 将洞察结果保存到 UserProfile
4. 返回更新后的 profile

---

## 二、Prompt 工程优化

### 2.1 课程树生成 Prompt 优化

**改进点：**
1. 增加质量标准描述
2. 提供 Few-shot 示例
3. 结合用户洞察（而非原文拼接）

```typescript
// lib/prompt.ts 重构

export function buildCourseTreePrompt(topic: string, insights?: LearningInsight | null): string {
  let insightSection = '';

  if (insights) {
    insightSection = `
用户学习洞察：
${insights.summary}

根据用户背景，课程设计时应：
1. 利用用户已有知识：${insights.knowledgeBackground.join('、') || '无相关背景'}
2. 参考用户的经历进行类比：${insights.analogyExperiences.join('、') || '无特定经历'}
`;
  }

  return `${insightSection}
你是一个专业的 AI 导师，为用户创建个性化的学习路径。

主题：${topic}

## 质量标准

一个好的学习课程应该：
- **结构清晰**：知识点由浅入深，环环相扣
- **目标明确**：每个节点都有清晰的学习目标
- **可实践**：内容能帮助用户解决真实问题
- **有关联**：与用户已有知识建立联系，便于迁移学习

## 输出要求

创建 4-8 个学习节点（根据主题复杂度决定），每个节点包含：
- title：简洁明确的学习主题
- description：一句话说明这个节点学什么、为什么有用
- cardCount：1-5 张卡片（复杂概念多几张，简单概念少几张）

节点设计原则：
- 第一个节点应该激发用户兴趣，而非讲枯燥基础
- 每个节点都应该能在 3-5 分钟内完成学习
- 后续节点建立在前序节点之上

输出 JSON：
{
  "courseId": "唯一ID",
  "topic": "${topic}",
  "totalNodes": 数量,
  "nodes": [
    {
      "index": 0,
      "title": "节点标题",
      "description": "一句话描述",
      "cardCount": 数字,
      "status": "locked"
    }
  ]
}

Return ONLY the JSON object, no additional text.`;
}
```

### 2.2 节点内容生成 Prompt 优化

**改进点：**
1. 描述"好卡片"的质量标准
2. 描述"好 Quiz"的质量标准
3. 卡片与 Quiz 强绑定

```typescript
// lib/prompt.ts 新增

export function buildNodeContentPrompt(
  topic: string,
  nodeTitle: string,
  cardCount: number,
  insights?: LearningInsight | null
): string {
  let insightSection = '';

  if (insights) {
    insightSection = `
用户背景：${insights.summary}
用户已有相关知识：${insights.knowledgeBackground.join('、') || '无'}
推荐类比素材：${insights.analogyExperiences.join('、') || '无'}
`;
  }

  return `你是一个专业的 AI 导师，为用户创建学习内容。

${insightSection}
主题：${topic}
当前节点：${nodeTitle}

## 学习卡片质量标准

好的学习卡片应该让用户"学完这张卡后能够做到 X"：

1. **场景引入**：用一个具体场景或生活类比引入概念，让用户感到真实和熟悉
2. **清晰定义**：给出明确的定义和关键特征，让用户能判断什么情况适用/不适用
3. **避坑提示**：指出 2-3 个最常见的理解误区，帮用户少走弯路
4. **一句话总结**：结尾用精炼的一句话概括核心要点，便于记忆

格式要求：
- content 使用 Markdown，可包含代码示例、列表等
- 每张卡片聚焦一个核心概念，不贪多
- 用词简洁，避免冗长的学术解释

## Quiz 题目质量标准

每道题必须：
- **考察维度**：记忆 / 理解 / 应用 / 分析
- **难度等级**：1（基础，大多数人能答对）/ 2（进阶，认真学的能答对）/ 3（综合，只有掌握很好的能答对）
- **对应卡片**：每道题必须对应某张卡片的某个核心要点

题目原则：
- 测试用户是否真正理解（而非死记硬背）
- 避免偏难怪题，优先考察实际应用
- 正确答案要明确无误，错误选项要有一定迷惑性

## 输出要求

生成 ${cardCount} 张学习卡片和对应的 Quiz 题目：

{
  "cards": [
    {
      "id": "card-1",
      "title": "卡片标题（简洁）",
      "content": "Markdown 格式内容"
    }
  ],
  "questions": [
    {
      "id": "q-1",
      "type": "single" | "multiple" | "fill",
      "question": "题目文本",
      "options": ["A", "B", "C", "D"],  // 单选/多选
      "answer": "正确答案",
      "explanation": "解析",
      "dimension": "记忆 | 理解 | 应用 | 分析",
      "difficulty": 1 | 2 | 3,
      "cardId": "对应的卡片ID"
    }
  ]
}

Return ONLY the JSON object, no additional text.`;
}
```

---

## 三、内容质量验证层

### 问题

AI 生成的内容可能存在：
- 答案错误
- 选项不合理
- 卡片内容与 Quiz 考察点不匹配

### 解决方案

**增加验证层：** 用第二个 AI 调用检查生成内容的正确性

```typescript
// lib/verify.ts 新建

interface VerificationResult {
  valid: boolean;
  errors: VerificationError[];
}

interface VerificationError {
  type: 'ANSWER_WRONG' | 'OPTION_MISLEADING' | 'MISMATCH' | 'FACTUAL_ERROR';
  message: string;
  location: string; // 例如 "q-1" 或 "card-1"
}

export async function verifyNodeContent(
  cards: LearningCard[],
  questions: Question[]
): Promise<VerificationResult> {
  const prompt = `
你是一个内容质量审核员。请检查以下学习内容是否存在问题：

学习卡片：
${cards.map(c => `- ${c.title}: ${c.content.slice(0, 100)}...`).join('\n')}

Quiz 题目：
${questions.map(q => `
- ${q.id}: ${q.question}
  类型: ${q.type}
  选项: ${q.options?.join(', ')}
  答案: ${q.answer}
`).join('\n')}

请检查：
1. 答案是否正确（ factual 正确性）
2. 错误选项是否真的有迷惑性（不是明显错误）
3. 题目考察点是否与卡片内容相关
4. 是否有事实性错误

返回 JSON：
{
  "valid": true 或 false,
  "errors": [
    {
      "type": "ANSWER_WRONG | OPTION_MISLEADING | MISMATCH | FACTUAL_ERROR",
      "message": "问题描述",
      "location": "题目或卡片ID"
    }
  ]
}
`;

  // 调用 MiniMax 验证
  const content = await callMiniMax(prompt);
  return parseJSONResponse<VerificationResult>(content);
}
```

### 验证流程

```
生成内容 → 验证内容 → 如果有问题 → 重新生成该部分 → 再次验证
```

**注意：** 只在发现明显错误时才重新生成，避免无限循环。设置最大重试次数（如 2 次）。

**重试耗尽策略：**
- 如果达到最大重试次数仍有问题，保留内容但标记 `hasWarnings: true`
- 前端显示内容时给出轻微提示（如"内容已生成，建议反馈"）
- 不阻塞用户学习，但记录日志供后续分析

---

## 四、实施计划

### 阶段一：快速见效

1. **新增洞察提取 API**
   - 创建 `/api/profile/insights` 端点
   - 修改 Profile 页面保存时调用
   - 更新 UserProfile 类型

2. **优化课程树生成 Prompt**
   - 增加质量标准描述
   - 用洞察替代原文拼接
   - 测试生成效果

3. **优化节点内容 Prompt**
   - 增加卡片/Quiz 质量标准
   - 增加维度标注（考察维度、难度）
   - 建立卡片-题目对应关系

### 阶段二：稳健完善

4. **增加内容验证层**
   - 创建 `lib/verify.ts`
   - 在节点内容生成后调用验证
   - 错误时重新生成

---

## 五、文件改动清单

| 文件 | 改动 |
|------|------|
| `types/course.ts` | 新增 `LearningInsight` 接口，扩展 `UserProfile` |
| `lib/prompt.ts` | 重构 `buildCourseTreePrompt`，新增 `buildNodeContentPrompt`、`buildProfileInsightPrompt` |
| `lib/verify.ts` | 新建，包含内容验证函数 |
| `app/api/profile/insights/route.ts` | 新建，洞察提取 API |
| `app/profile/page.tsx` | 保存时调用洞察 API |
| `app/api/generate/route.ts` | 使用洞察替代原文拼接 |
| `app/api/generate/node/route.ts` | 使用优化后的 Prompt |
| `contexts/UserProfileContext.tsx` | 同步洞察数据 |
| `CHANGELOG.md` | 记录本次改进 |

---

## 六、预期效果

- **课程结构更合理**：节点间逻辑清晰，每个节点有明确学习目标
- **内容更易理解**：有生活类比、有避坑提示，不枯燥
- **Quiz 更有价值**：考察真正的理解，有区分度
- **个性化更自然**：利用用户背景做类比和迁移，而非硬凑
