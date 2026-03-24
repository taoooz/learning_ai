# 课程树生成优化设计

## 背景

当前课程树生成存在以下问题：
1. 课程树生成只使用 topic，没有利用用户画像（insights）
2. insights 注入方式简单，效果有限
3. 节点数量/卡片数量由 AI 随意决定，没有根据用户水平动态调整

## 目标

根据用户画像（insights）动态调整课程难度和长度，让课程匹配用户实际水平，避免过难或过简单。

---

## 设计方案

### 1. 用户洞察（insights）设计

用户洞察是一份通用的、基于用户真实信息的事实性总结，任何课程都可以参考。

#### 1.1 knowledgeBackground

**定义：**
用更清晰的语言总结用户的工作经历和教育背景，关键信息不遗漏、不延伸。

**总结内容：**
- 每份工作：做什么产品/项目、有什么技能、处于什么领域
- 教育背景：专业方向

**原则：**
- 只描述事实，不推理、不判断"是否有用"
- 不过度延伸（如"用过 docker" → "在项目中使用过 Docker"，而不是"有容器化基础"）

**示例：**

| 原始输入 | 总结结果 |
|----------|----------|
| "在腾讯做产品经理，负责后台管理系统" | "腾讯后台管理系统产品经理" |
| "计算机科学专业本科" | "计算机科学专业本科" |
| "用过 docker" | "在项目中使用过 Docker" |

#### 1.2 analogyExperiences

**定义：**
用户的真实工作/生活经历，可作为课程案例的素材参考。

**原则：**
- 描述用户实际做过的具体事情
- 不加引申，不用作类比解释

**示例：**

| 原始输入 | 总结结果 |
|----------|----------|
| "做过用户增长项目" | "负责过用户增长项目" |
| "独立负责过活动策划" | "独立负责过活动策划" |

### 2. 课程树生成策略

#### 2.1 两级判断机制

```
第一次 API 调用
      │
      ▼
┌─────────────────────────────────────────┐
│  AI 分析 insights 与 topic 的关联度       │
│                                         │
│  情况 A：洞察足够 → 直接生成课程 ✅        │
│                                         │
│  情况 B：洞察不足但关键 → 返回问题         │
└─────────────────────────────────────────┘
      │
      ▼
用户回答问题（仅情况 B）
      │
      ▼
第二次 API 调用（仅情况 B）→ 生成课程 ✅
```

#### 2.2 第一次调用 Prompt 设计

**buildCourseTreePrompt(topic, userProfile)**

```
## 用户洞察

知识背景：
- 列表项（更清晰的事实性总结）

类比经历：
- 列表项（用户的真实经历）

## 指导语

请先分析：
1. 用户想学的主题（{topic}）与用户已具备的知识背景的关联度
2. 判断该主题对用户的难易程度

如果以下任一情况成立，请返回问题而非直接生成课程：
1. 需要确定用户对 topic 的具体经验细节
2. 这个细节会显著影响课程起点设计

问题要求：
- 最多 3 个问题
- 必须是与设计课程直接相关的具体问题
- 优先问经验细节类问题

如果洞察足够直接生成课程，请输出：
{
  "courseId": "唯一ID",
  "topic": "主题",
  "difficultySummary": "简要的难度描述（基于用户背景分析，不只是标签）",
  "totalNodes": 节点数量,
  "nodes": [...]
}

如果需要更多信息，请输出：
{
  "questions": [
    {
      "id": "q1",
      "question": "问题文本"
    }
  ]
}
```

#### 2.2.1 第二次调用 Prompt 设计

**buildCourseTreePrompt(topic, userProfile, clarificationAnswers)**

第二次调用时，将用户的回答作为额外 context 注入 prompt，让 AI 结合原始洞察和新回答综合判断课程设计。

**Prompt 在原始结构基础上，增加：**

```
## 用户澄清回答

{clarificationAnswers.map(a => `问题：${a.question}\n回答：${a.answer}`).join('\n\n')}

请结合以上回答和原始用户洞察，重新评估：
1. 用户对主题的实际经验水平
2. 课程应有的难度和结构

直接生成课程，不需要再返回问题。
```

**API 调用方式：**
- 第二次调用与第一次调用使用相同的 API endpoint（`/api/generate`）
- 请求体增加 `clarificationAnswers` 字段：
```typescript
{
  topic: string;
  clarificationAnswers: Array<{
    id: string;
    question: string;
    answer: string;
  }>;
}
```

#### 2.3 难度与课程结构映射

节点数量和卡片数量独立决策，不强行绑定：

**节点数量 = 反映"跳过多少基础"**
- 新手/入门：6-8 个节点（从基础讲起，覆盖全面）
- 进阶：4-5 个节点（有选择地讲核心）
- 高级：3-4 个节点（聚焦精华，跳过基础）

**卡片数量 = 反映"内容深度"**
- 新手/入门：每节点 3-4 张（内容浅显，避免认知过载）
- 进阶：每节点 3-4 张（标准深度）
- 高级：每节点 4-5 张（内容浓缩，核心原理需要更多展开）

**课程风格**
- 新手/入门：「从基础概念到实战，循序渐进，大量实例」
- 进阶：「有选择地深入核心原理与实践」
- 高级：「聚焦核心难点，深入原理，密集输出」

### 3. 洞察生成 Prompt 改进

**buildProfileInsightPrompt(profile)**

```
你是一个学习规划专家。请从以下用户信息中提取与学习课程相关的洞察。

要求：
- 只提取事实，不要推测
- 用更清晰的语言总结，不遗漏关键信息
- 不要延伸推理（如"用过 docker"不推导"有容器化基础"）

目标岗位：{profile.targetJob || '未填写'}

工作经历：
{列表}

教育背景：
{列表}

请总结以下信息（用中文回答）：

1. knowledgeBackground：基于工作经历和教育背景总结的关键事实
   - 每份工作的实质内容（做什么产品、有什么技能、什么领域）
   - 教育背景中的专业方向
   - 关键信息不遗漏、不延伸

2. analogyExperiences：用户的真实经历，可作为课程案例素材
   - 描述用户实际做过的具体事情
   - 不加引申

3. summary：一句话总结用户背景特点

输出 JSON 格式：
{
  "knowledgeBackground": ["总结1", "总结2"],
  "analogyExperiences": ["经历1", "经历2"],
  "summary": "一句话总结"
}
```

### 4. 数据结构变更

#### 4.1 CourseTree 输出格式（API 返回）

```typescript
interface CourseTreeResponse {
  // 情况 A：直接生成课程
  courseId: string;
  topic: string;
  difficultySummary: string;  // 新增：简要难度描述
  totalNodes: number;
  nodes: Array<{
    index: number;
    title: string;
    cardCount: number;
    status: 'locked' | 'available';
  }>;

  // 情况 B：需要澄清
  questions?: Array<{
    id: string;
    question: string;
  }>;
}
```

#### 4.2 前端状态扩展

```typescript
interface ClarificationState {
  topic: string;                  // 保存用户当前的 topic
  questions: Array<{
    id: string;
    question: string;
    answer: string;               // 用户回答
  }>;
}
```

**说明：**
- 情况 B 时，不返回 courseId（课程尚未生成）
- 前端保存 topic 和 questions，供第二次调用使用
- 第二次调用时，携带 topic + clarificationAnswers

### 5. 流程变更

#### 5.1 generateCourse 流程

```
用户输入 topic
      │
      ▼
fetch /api/generate({ topic })
      │
      ▼
┌─────────────────────────────────────┐
│  判断返回类型                         │
│                                     │
│  if (questions) {                   │
│    // 情况 B：展示问题表单            │
│    setClarificationState({          │
│      topic,                         │
│      questions                      │
│    })                               │
│  } else {                           │
│    // 情况 A：保存课程               │
│    saveCourse(course)               │
│  }                                  │
└─────────────────────────────────────┘
      │
      ▼
用户回答问题（如果是情况 B）
      │
      ▼
fetch /api/generate({
  topic,
  clarificationAnswers: [...]   // 用户的回答
})
      │
      ▼
saveCourse(course)
```

---

## 改动范围

| 文件 | 改动内容 |
|------|----------|
| `lib/prompt.ts` | 修改 `buildProfileInsightPrompt` 和 `buildCourseTreePrompt` |
| `app/api/generate/node/route.ts` | 可能需要调整输出结构（新增 difficultySummary） |
| `contexts/CourseContext.tsx` | 增加澄清问题状态管理 |
| `types/course.ts` | 确认/增加相关类型定义 |

---

## 测试要点

1. **洞察生成质量**
   - 验证"用过 docker"不会被延伸为"有容器化基础"
   - 验证工作经历总结包含产品/技术/领域信息

2. **难度判断准确性**
   - 完全无背景用户 → 生成入门课程（6-8 节点）
   - 有相关背景用户 → 生成进阶/精简课程
   - 需要澄清的场景 → 正确返回问题而非硬猜

3. **澄清问题质量**
   - 问题是否与课程设计直接相关
   - 是否在 1-3 个问题内
   - 用户回答后是否能有效调整课程
