# 课程树生成优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根据用户画像（insights）动态调整课程难度，实现两级课程生成机制（直接生成 or 澄清问题后生成）

**Architecture:**
- 修改 `buildProfileInsightPrompt` 生成更准确的事实性洞察
- 修改 `buildCourseTreePrompt` 支持两级判断（直接生成 vs 返回问题）
- API route 支持两种响应格式和二次调用
- 前端 Context 支持澄清状态管理

**Tech Stack:** Next.js API Routes, React Context, localStorage

---

## 文件结构

```
改动文件:
- lib/prompt.ts                      # 修改 Prompt 构建逻辑
- types/course.ts                    # 新增 ClarificationQuestion 类型
- app/api/generate/route.ts         # 支持两种响应格式和二次调用
- contexts/CourseContext.tsx         # 新增澄清状态管理
```

---

## Task 1: 更新 types/course.ts 添加新类型

**Files:**
- Modify: `types/course.ts`

- [ ] **Step 1: 添加 ClarificationQuestion 和 CourseTreeResponse 类型**

```typescript
// 在 CourseTreeResponse 之后添加

export interface ClarificationQuestion {
  id: string;
  question: string;
}

export interface ClarificationAnswer {
  id: string;
  question: string;
  answer: string;
}

// 修改 CourseTree 接口，添加 difficultySummary
export interface CourseTree {
  courseId: string;
  topic: string;
  difficultySummary: string;  // 新增
  totalNodes: number;
  nodes: CourseNode[];
}
```

- [ ] **Step 2: Commit**

```bash
git add types/course.ts
git commit -m "feat(types): add ClarificationQuestion and difficultySummary"
```

---

## Task 2: 更新 lib/prompt.ts - buildProfileInsightPrompt

**Files:**
- Modify: `lib/prompt.ts:146-175`

- [ ] **Step 1: 更新 prompt 指导语**

找到当前的 `buildProfileInsightPrompt` 函数，替换为以下版本：

```typescript
export function buildProfileInsightPrompt(profile: UserProfile): string {
  return `你是一个学习规划专家。请从以下用户信息中提取与学习课程相关的洞察。

要求：
- 只提取事实，不要推测
- 用更清晰的语言总结，不遗漏关键信息
- 不要延伸推理（如"用过 docker"不推导"有容器化基础"，只说"在项目中使用过 Docker"）

目标岗位：${profile.targetJob || '未填写'}

工作经历：
${profile.workExperience && profile.workExperience.length > 0
  ? profile.workExperience.map(w => `- ${w.company}，${w.position}${w.description ? '，工作内容：' + w.description : ''}`).join('\n')
  : '暂无'}

教育背景：
${profile.education && profile.education.length > 0
  ? profile.education.map(e => `- ${e.school}，${e.major}`).join('\n')
  : '暂无'}

请总结以下信息（用中文回答）：

1. knowledgeBackground：基于工作经历和教育背景总结的关键事实
   - 每份工作的实质内容（做什么产品、有什么技能、什么领域）
   - 教育背景中的专业方向
   - 关键信息不遗漏、不延伸
   - 保持事实性，不推理"是否有用"

2. analogyExperiences：用户的真实经历，可作为课程案例素材
   - 描述用户实际做过的具体事情
   - 不加引申

3. summary：一句话总结用户背景特点

输出 JSON 格式：
{
  "knowledgeBackground": ["总结1", "总结2"],
  "analogyExperiences": ["经历1", "经历2"],
  "summary": "一句话总结"
}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/prompt.ts
git commit -m "feat(prompt): improve buildProfileInsightPrompt for factual summaries"
```

---

## Task 3: 更新 lib/prompt.ts - buildCourseTreePrompt

**Files:**
- Modify: `lib/prompt.ts:5-61`

- [ ] **Step 1: 替换 buildCourseTreePrompt 函数**

找到当前的 `buildCourseTreePrompt` 函数，替换为以下版本：

```typescript
export function buildCourseTreePrompt(
  topic: string,
  userProfile?: UserProfile | null,
  clarificationAnswers?: ClarificationAnswer[]
): string {
  let insightSection = '';
  let clarificationSection = '';

  // 用户洞察 section
  if (userProfile?.insights) {
    const { knowledgeBackground, analogyExperiences } = userProfile.insights;
    insightSection = `
## 用户洞察

知识背景：
${knowledgeBackground && knowledgeBackground.length > 0
  ? knowledgeBackground.map(k => `- ${k}`).join('\n')
  : '暂无相关背景'}

类比经历：
${analogyExperiences && analogyExperiences.length > 0
  ? analogyExperiences.map(a => `- ${a}`).join('\n')
  : '暂无相关经历'}
`;
  }

  // 用户澄清回答 section（第二次调用时）
  if (clarificationAnswers && clarificationAnswers.length > 0) {
    clarificationSection = `
## 用户澄清回答

${clarificationAnswers.map(a => `问题：${a.question}\n回答：${a.answer}`).join('\n\n')}

请结合以上回答和原始用户洞察，重新评估：
1. 用户对主题的实际经验水平
2. 课程应有的难度和结构

直接生成课程，不需要再返回问题。
`;
  }

  return `${insightSection}${clarificationSection}你是一位专业的 AI 导师，为用户创建个性化的学习路径。

主题：${topic}

## 课程结构决策指南

**节点数量：**
- 参考范围：5-15 个
- 决策因素：主题本身的复杂度
- 原则：节点之间有清晰的逻辑顺序

**卡片数量：**
- 参考范围：每节点 8-12 张
- 决策因素：内容深度（核心原理需要更多展开）
- 原则：避免单张卡片内容过多

## 质量标准

一个好的学习课程应该：
- **结构清晰**：知识点由浅入深，环环相扣
- **目标明确**：每个节点都有清晰的学习目标
- **可实践**：内容能帮助用户解决真实问题

## 输出格式

如果可以直接生成课程（洞察足够或已有澄清回答），请输出：
{
  "courseId": "唯一ID",
  "topic": "${topic}",
  "difficultySummary": "简要的难度描述（基于用户背景与主题的关联度分析，用中文描述）",
  "totalNodes": 节点数量,
  "nodes": [
    {
      "index": 0,
      "title": "节点标题",
      "cardCount": 数字 (8-12),
      "status": "locked"
    }
  ]
}

如果需要更多信息才能生成课程，请输出：
{
  "questions": [
    {
      "id": "q1",
      "question": "问题文本（必须是与课程设计直接相关的具体问题，最多3个）"
    }
  ]
}

只返回 JSON 对象，不要有其他文本。`;
}
```

- [ ] **Step 2: 导入 ClarificationAnswer 类型**

在文件顶部添加导入：

```typescript
import { UserProfile, ClarificationAnswer } from '@/types/course';
```

- [ ] **Step 3: Commit**

```bash
git add lib/prompt.ts
git commit -m "feat(prompt): add two-level course generation with clarification flow"
```

---

## Task 4: 更新 app/api/generate/route.ts

**Files:**
- Modify: `app/api/generate/route.ts`
- Note: 这是课程树生成的 API endpoint，不是 `/api/generate/node`

- [ ] **Step 1: 导入类型（已在 Task 1 添加到 types/course.ts）**

在文件顶部已有导入：
```typescript
import { CourseTree } from '@/types/course';
```

添加额外导入：
```typescript
import { ClarificationQuestion, CourseTreeResponse } from '@/types/course';
```

- [ ] **Step 2: 更新 POST 函数支持两种响应和二次调用**

```typescript
// ClarificationResponse 是内部使用的类型，不需要导出
interface ClarificationResponse {
  questions: ClarificationQuestion[];
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[CourseTree] Starting at', new Date().toISOString());

  try {
    const { topic, clarificationAnswers } = await request.json();

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    const promptBuildStart = Date.now();
    const userProfile = getUserProfile();
    const prompt = buildCourseTreePrompt(topic, userProfile, clarificationAnswers);
    console.log(`[CourseTree] Prompt built: ${Date.now() - promptBuildStart}ms`);

    const apiStart = Date.now();
    console.log('[CourseTree] Calling MiniMax API...');
    const content = await callMiniMax(prompt);
    console.log(`[CourseTree] MiniMax API: ${Date.now() - apiStart}ms`);

    const parseStart = Date.now();

    // 尝试解析为课程响应
    try {
      const course = parseJSONResponse<CourseTreeResponse>(content);

      // 如果有 questions 字段，说明需要澄清
      if ('questions' in course && Array.isArray(course.questions)) {
        console.log('[CourseTree] Clarification needed, returning questions');
        return NextResponse.json({ questions: course.questions });
      }

      // 否则是完整的课程
      console.log(`[CourseTree] Parse JSON: ${Date.now() - parseStart}ms`);
      console.log(`[CourseTree] Total: ${Date.now() - startTime}ms`);
      return NextResponse.json(course);
    } catch {
      // 解析失败，尝试作为澄清响应
      const clarificationResponse = parseJSONResponse<ClarificationResponse>(content);
      if ('questions' in clarificationResponse) {
        console.log('[CourseTree] Clarification needed, returning questions');
        return NextResponse.json({ questions: clarificationResponse.questions });
      }
      throw new Error('Invalid response format');
    }
  } catch (error) {
    console.error(`[CourseTree] Error after ${Date.now() - startTime}ms:`, error);
    return NextResponse.json(
      { error: 'Failed to generate course' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/generate/route.ts
git commit -m "feat(api): support two-level course generation with clarification"
```

---

## Task 5: 更新 contexts/CourseContext.tsx - 澄清状态管理

**Files:**
- Modify: `contexts/CourseContext.tsx`

- [ ] **Step 1: 添加澄清状态类型和状态**

找到 `CourseContextType` 接口，添加：

```typescript
interface ClarificationState {
  topic: string;
  questions: Array<{
    id: string;
    question: string;
    answer: string;
  }>;
}
```

在 `CourseProvider` 组件中添加状态：

```typescript
const [clarification, setClarification] = useState<ClarificationState | null>(null);
```

- [ ] **Step 2: 修改 generateCourse 函数**

```typescript
const generateCourse = useCallback(async (topic: string) => {
  setGenerationStatus('generating');
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic }),
    });

    if (!response.ok) throw new Error('Generation failed');

    const data = await response.json();

    // 检查是否需要澄清
    if (data.questions && Array.isArray(data.questions)) {
      setClarification({
        topic,
        questions: data.questions.map((q: { id: string; question: string }) => ({
          ...q,
          answer: ''
        }))
      });
      setGenerationStatus('success');
      return;
    }

    // 直接返回课程
    const course: CourseTree = data;

    // 第一个节点设为 available
    if (course.nodes && course.nodes.length > 0) {
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
```

- [ ] **Step 3: 添加 submitClarification 函数**

```typescript
const submitClarification = useCallback(async () => {
  if (!clarification) return;

  const unanswered = clarification.questions.filter(q => !q.answer.trim());
  if (unanswered.length > 0) {
    throw new Error('Please answer all questions');
  }

  setGenerationStatus('generating');
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: clarification.topic,
        clarificationAnswers: clarification.questions
      }),
    });

    if (!response.ok) throw new Error('Generation failed');

    const course: CourseTree = await response.json();

    // 第一个节点设为 available
    if (course.nodes && course.nodes.length > 0) {
      course.nodes[0].status = 'available';
    }

    saveCourse(course);
    setCourses(prev => [...prev, course]);
    setCurrentCourse(course);
    setClarification(null);
    setGenerationStatus('success');
  } catch {
    setGenerationStatus('error');
    throw new Error('Failed to generate course');
  }
}, [clarification]);
```

- [ ] **Step 4: 更新 Provider value**

```typescript
return (
  <CourseContext.Provider value={{
    courses,
    currentCourse,
    generationStatus,
    generateCourse,
    generateNodeContent,
    preloadNextNode,
    updateNodeContent,
    deleteCourse,
    clarification,           // 新增
    setClarification,         // 新增（用于更新问题回答）
    submitClarification,      // 新增
  }}>
    {children}
  </CourseContext.Provider>
);
```

- [ ] **Step 5: 更新 CourseContextType 接口**

确保 `CourseContextType` 包含新字段：

```typescript
interface CourseContextType {
  // ... existing fields
  clarification: ClarificationState | null;
  setClarification: React.Dispatch<React.SetStateAction<ClarificationState | null>>;
  submitClarification: () => Promise<void>;
}
```

- [ ] **Step 6: Commit**

```bash
git add contexts/CourseContext.tsx
git commit -m "feat(context): add clarification state for two-level course generation"
```

---

## Task 6: 更新前端组件支持澄清流程

**Files:**
- Modify: `app/generate/page.tsx`（课程生成页面）

**前置条件：** 已完成 Task 5（CourseContext 新增了 `clarification` 和 `submitClarification`）

- [ ] **Step 1: 在生成课程页面添加澄清问题展示**

在 `app/generate/page.tsx` 中，使用 `useCourse()` hook 获取 `clarification` 和 `submitClarification`。

当 `clarification` 不为 null 时，展示问题表单（替代或叠加在现有的生成按钮/表单上）：

```tsx
// 在组件顶部获取 from useCourse()
const { clarification, submitClarification, generationStatus } = useCourse();

// 在 JSX 中，当 clarification 存在时展示问题表单
{clarification && (
  <div classNameName="clarification-form">
    <h2>为了更好地为您生成课程，请回答以下问题</h2>
    {clarification.questions.map((q) => (
      <div key={q.id} classNameName="question-item">
        <label>{q.question}</label>
        <textarea
          value={q.answer}
          onChange={(e) => {
            setClarification(prev => prev ? {
              ...prev,
              questions: prev.questions.map(item =>
                item.id === q.id ? { ...item, answer: e.target.value } : item
              )
            } : null)}
          }
          placeholder="请输入您的回答"
        />
      </div>
    ))}
    <button onClick={submitClarification} disabled={generationStatus === 'generating'}>
      {generationStatus === 'generating' ? '生成中...' : '提交并生成课程'}
    </button>
  </div>
)}
```

**注意：**
- `setClarification` 来自 `useCourse()` hook（Task 5 中已在 Context Provider 中导出）
- `clarification` 为 null 时，显示正常的课程生成表单
- `clarification` 不为 null 时，显示问题表单

- [ ] **Step 2: Commit**

```bash
git add app/generate/page.tsx
git commit -m "feat(generate): add clarification questions UI"
```

---

## 测试验证

- [ ] **Test 1: 洞察生成质量**
   - 验证"用过 docker"不会被延伸为"有容器化基础"
   - 验证工作经历总结包含产品/技能/领域信息

- [ ] **Test 2: 难度判断**
   - 无背景用户输入主题 → 应直接生成课程
   - 有关联背景用户 → 应生成带 difficultySummary 的课程

- [ ] **Test 3: 澄清问题流程**
   - AI 判断需要澄清时 → 返回 questions 数组
   - 用户回答后 → 第二次调用生成课程

- [ ] **Test 4: 课程结构**
   - 节点数量在 5-15 范围内
   - 每节点卡片数量在 8-12 范围内
