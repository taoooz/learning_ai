# 课程 Blueprint + Memory V3 + Validator/Refine 重构设计

## 背景

当前产品在课程生成质量和用户 memory 构建上已经有一版可用链路，但仍存在三个结构性问题：

1. 课程树输出更像展示层 JSON，而不是教学系统的中间层  
   节点缺少显式的教学目标、概念覆盖、前置依赖和评估目标。后续节点内容生成、题目设计、memory 更新都只能从节点标题和题目文案里反推语义，稳定性不足。

2. memory 写入过重，且以即时派生结果为主  
   聊天、答题、学习进度会直接更新多种聚合结果。热路径承担了过多推理和整理工作，既增加等待时间，也让后续算法升级成本偏高。

3. 生成链路缺少可靠的后验约束  
   当前更依赖 prompt 里一次性把要求写全。模型一旦输出了结构合法但教学质量不佳的结果，就会直接落库。为了追求稳定性只能继续加长 prompt，导致 token 成本和等待时间上升。

本次重构接受一次性清空旧课程和旧 memory 数据，不保留向后兼容逻辑。目标是在现有 localStorage + MiniMax + Next.js 架构下，建立一套更适合持续迭代的课程中间层、事件式 memory 和轻量 validator/refine 机制。

---

## 目标

1. 课程生成从“标题驱动”升级为“教学结构驱动”
2. memory 从“同步写派生结果”升级为“热路径写事件 + 后台整理投影”
3. 生成从“单轮硬约束”升级为“自由生成 + 本地校验 + 按需 refine”
4. 在不引入后端数据库的前提下，先在 localStorage 中跑通完整架构
5. 为后续接入 embeddings、服务端 memory、复习调度器预留稳定边界

## 非目标

1. 本次不引入服务端数据库或向量库
2. 本次不解决多端同步问题
3. 本次不做完整 spaced repetition 产品化，只保留 `nextReviewAt` 等投影接口
4. 本次不改首页、课程目录页和学习页的视觉设计，只改数据来源与交互逻辑

---

## 设计原则

1. 单一真相源  
   课程主数据以 `CourseBlueprint` 为准，目录页和学习页只消费其派生视图。

2. 标题不是语义主键  
   节点标题只负责展示，概念、目标、前置依赖、评估目标必须单独显式建模。

3. 热路径只做最小写入  
   聊天、答题、节点完成等高频交互只写事件，不在用户等待链路里做大规模重算。

4. 约束后移，失败再补救  
   尽量让模型先自由发挥，再由 validator 判断是否需要 refine，避免无差别放大 prompt。

5. 结构化优先，文本匹配兜底  
   retrieval 优先使用 concept id、topic id、goal 关联；alias 和词面匹配仅作为 fallback。

---

## 架构概览

```text
用户输入 Topic / 用户画像 / Memory Projections
                │
                ▼
     Planning Retrieval Payload Builder
                │
                ▼
        MiniMax 生成 CourseBlueprint Draft
                │
                ▼
        Course Blueprint Validator
         │                    │
         │ pass               │ fail
         ▼                    ▼
   派生 CourseTreeView   Refine Prompt + 再生成一次
         │
         ▼
    localStorage 持久化 Blueprint + View

进入单节点学习
         │
         ▼
   Teaching Retrieval Payload Builder
         │
         ▼
      MiniMax 生成 NodeLesson Draft
         │
         ▼
      Node Lesson Validator
         │
    pass │ / fail refine
         ▼
      持久化 NodeLesson

聊天 / 答题 / 节点完成
         │
         ▼
       append MemoryEvent
         │
         ▼
 requestIdleCallback / debounce / 页面隐藏时 flush
         │
         ▼
   Memory Projector 重建 projections
         │
         ▼
   planning / teaching / chat retrieval 读取 projections
```

---

## 核心数据结构

### 1. CourseBlueprint

`CourseBlueprint` 是课程生成链路的主输出，也是 validator、memory 对齐和后续节点内容生成的依据。

```ts
type CourseBlueprint = {
  courseId: string;
  topic: string;
  learnerPositioning: {
    estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
    difficultySummary: string;
    whyThisCourseFits: string;
  };
  courseGoal: string;
  globalConcepts: CanonicalConcept[];
  nodes: CourseBlueprintNode[];
  coverage: {
    introducedConceptIds: string[];
    assessedConceptIds: string[];
    remediatedConceptIds: string[];
  };
  generationNotes: {
    compressedKnownConceptIds: string[];
    emphasizedRiskConceptIds: string[];
    selectedAnalogyFactIds: string[];
  };
};
```

### 2. CourseBlueprintNode

```ts
type CourseBlueprintNode = {
  index: number;
  title: string;
  teachingGoal: string;
  teachConceptIds: string[];
  prerequisiteConceptIds: string[];
  assessmentTargetIds: string[];
  bridgeFromPreviousNode: string;
  personalizationHooks: {
    mustRemediateConceptIds: string[];
    canCompressKnownConceptIds: string[];
    analogyFactIds: string[];
  };
  cardCount: number;
  status: 'locked' | 'available' | 'completed';
};
```

### 3. CourseTreeView

目录页只需要轻量视图，继续保持当前 UI 所需字段，避免展示层被大范围改写。

```ts
type CourseTreeView = {
  courseId: string;
  topic: string;
  difficultySummary: string;
  totalNodes: number;
  nodes: Array<{
    index: number;
    title: string;
    cardCount: number;
    status: 'locked' | 'available' | 'completed';
  }>;
};
```

### 4. NodeLesson

```ts
type NodeLesson = {
  courseId: string;
  nodeIndex: number;
  title: string;
  teachingGoal: string;
  teachConceptIds: string[];
  assessmentTargetIds: string[];
  cards: Array<LearningCard & {
    coveredConceptIds: string[];
  }>;
  questions: Array<Question & {
    targetConceptId: string;
  }>;
  validatorSummary?: {
    passed: boolean;
    issues: string[];
  };
};
```

### 5. MemoryStoreV3

```ts
type MemoryStoreV3 = {
  version: 3;
  learnerId: string;
  profile: {
    stableFacts: MemoryStableFact[];
    goals: MemoryGoal[];
    preferences: LearningPreference[];
  };
  events: MemoryEvent[];
  projections: {
    conceptProjections: ConceptProjection[];
    topicProjections: TopicProjection[];
    episodicProjections: EpisodicProjection[];
  };
  updatedAt: number;
};
```

### 6. MemoryEvent

```ts
type MemoryEvent =
  | {
      type: 'course_generated';
      topic: string;
      courseId: string;
      occurredAt: number;
      payload: {
        courseGoal: string;
        globalConceptIds: string[];
      };
    }
  | {
      type: 'node_started';
      courseId: string;
      topic: string;
      nodeIndex: number;
      occurredAt: number;
      payload: {
        teachConceptIds: string[];
      };
    }
  | {
      type: 'question_answered';
      courseId: string;
      topic: string;
      nodeIndex: number;
      occurredAt: number;
      payload: {
        targetConceptId: string;
        isCorrect: boolean;
        difficulty?: 1 | 2 | 3;
        dimension?: 'memory' | 'understanding' | 'application' | 'analysis';
      };
    }
  | {
      type: 'chat_user_message';
      topic: string;
      courseId?: string;
      occurredAt: number;
      payload: {
        text: string;
        currentConceptIds?: string[];
      };
    }
  | {
      type: 'chat_session_summarized';
      topic: string;
      courseId?: string;
      occurredAt: number;
      payload: {
        summary: string;
        unresolvedConceptIds: string[];
        explanationStyles: string[];
        followUp?: string;
      };
    }
  | {
      type: 'node_completed';
      courseId: string;
      topic: string;
      nodeIndex: number;
      occurredAt: number;
      payload: {
        teachConceptIds: string[];
      };
    };
```

---

## 课程生成设计

### 输入

课程生成不再直接把一大段原始 memory 拼进 prompt，而是构造 `PlanningRetrievalPayload`：

```ts
type PlanningRetrievalPayload = {
  learnerSnapshot: {
    estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
    confidence: number;
    targetGoal?: string;
  };
  mustCoverConceptIds: string[];
  mustCoverConceptNames: string[];
  skippableConceptIds: string[];
  skippableConceptNames: string[];
  riskConceptIds: string[];
  riskConceptNames: string[];
  analogyFacts: Array<{ id: string; text: string }>;
  recentEpisodes: Array<{ topic: string; summary: string }>;
};
```

### 模型输出

课程生成 API 第一次调用要求模型直接输出 `CourseBlueprintDraft`，不再输出只有标题的课程树。

### 本地 validator

课程 draft 必须通过以下检查：

1. `globalConcepts` 非空，且 concept id/name 唯一
2. `nodes` 数量在允许范围内
3. 每个节点至少有一个 `teachConceptId`
4. `prerequisiteConceptIds` 不能引用未来节点首次出现的 concept
5. `mustCoverConceptIds` 必须被至少一个节点的 `teachConceptIds` 或 `mustRemediateConceptIds` 覆盖
6. `assessmentTargetIds` 必须是 `globalConcepts` 的子集
7. `title` 不能只是“基础篇/进阶篇/补充内容”这类空泛标题
8. 至少一个节点显式承担 remediation 责任，如果存在风险 concept
9. `whyThisCourseFits` 和 `difficultySummary` 必须解释“为什么适合这个起点”

### refine 触发

仅当 validator 失败时，才发起第二次模型调用。refine prompt 只包含：

1. 原始 `CourseBlueprintDraft`
2. validator issue 列表
3. 简短修复要求

不重复注入长篇系统约束，降低 token 开销。

### 存储

课程保存时写入：

1. `CourseBlueprint`
2. 由 blueprint 派生出的 `CourseTreeView`

---

## 节点内容生成设计

### 输入

节点内容不再从“节点标题 + 前几节标题”反推，而是基于 blueprint 构造 `TeachingRetrievalPayload`：

```ts
type TeachingRetrievalPayload = {
  nodeTopic: string;
  nodeTitle: string;
  teachingGoal: string;
  teachConcepts: Array<{
    id: string;
    name: string;
    status: 'unknown' | 'learning' | 'fragile' | 'mastered';
    masteryScore: number;
    misconceptionHints: string[];
  }>;
  prerequisiteConcepts: Array<{
    id: string;
    name: string;
    status: 'unknown' | 'learning' | 'fragile' | 'mastered';
    masteryScore: number;
  }>;
  assessmentTargets: Array<{
    id: string;
    name: string;
    reason: 'core' | 'risk' | 'remediation';
  }>;
  analogyFacts: Array<{ id: string; text: string }>;
  preferredExplanationStyles: string[];
  recentRelevantQuestions: string[];
};
```

### 模型输出

模型生成 `NodeLessonDraft`，其中题目必须带 `targetConceptId`，而不是只写 `concept` 文案。

### 本地 validator

节点内容必须通过以下检查：

1. 每个 `teachConceptId` 至少被一张卡片的 `coveredConceptIds` 显式覆盖
2. `assessmentTargetIds` 至少被题目命中一次
3. 若某个 target concept 是高风险概念，至少有一道题直接命中它
4. 所有 `questions[].targetConceptId` 必须属于该节点的 `assessmentTargetIds`
5. `cardId` 必须引用存在的卡片
6. 不允许大量重复上一节桥接内容，只能保留衔接性说明

节点 validator 不负责从卡片正文中重新猜测概念覆盖，避免把“文本匹配”重新引回主链路。概念覆盖由模型通过 `coveredConceptIds` 显式申报，validator 只校验结构一致性与最低覆盖要求。

### refine 触发

与课程生成相同，仅在 validator 失败时做一次 refine。

---

## Memory V3 设计

### 热路径写入

以下交互只 append event，不同步重算全部 projections：

1. 用户发送聊天消息
2. 用户回答题目
3. 用户进入节点
4. 用户完成节点
5. 课程生成完成

### 后台整理

通过 `requestIdleCallback` + `setTimeout` fallback + debounce 触发 projector：

1. 普通交互后延迟整理
2. 页面隐藏时强制 flush
3. 节点完成时强制 flush
4. 聊天会话截断或结束时强制 flush

### 投影类型

#### ConceptProjection

维护每个 concept 在某个 topic 下的学习状态：

```ts
type ConceptProjection = {
  topic: string;
  conceptId: string;
  conceptName: string;
  masteryScore: number;
  status: 'unknown' | 'learning' | 'fragile' | 'mastered';
  recentErrors: number;
  recentSuccesses: number;
  misconceptionHints: string[];
  confidence: number;
  lastSeenAt?: number;
  nextReviewAt?: number;
  updatedAt: number;
};
```

#### TopicProjection

维护某主题下的整体熟悉度和课程规划信号：

```ts
type TopicProjection = {
  topic: string;
  familiarityScore: number;
  estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
  mustCoverConceptIds: string[];
  skippableConceptIds: string[];
  riskConceptIds: string[];
  confidence: number;
  updatedAt: number;
};
```

#### EpisodicProjection

维护最近课程/聊天摘要，支持 retrieval：

```ts
type EpisodicProjection = {
  id: string;
  topic: string;
  courseId?: string;
  kind: 'course' | 'chat';
  summary: string;
  conceptIds: string[];
  explanationStyles: string[];
  followUp?: string;
  updatedAt: number;
};
```

### 与当前实现的核心差异

1. 当前实现会同步更新多种派生结果  
   新实现改为只写事件，由 projector 统一产出投影。

2. 当前很多 concept 来自标题/题目文案猜测  
   新实现优先消费 `targetConceptId / teachConceptIds / assessmentTargetIds`。

3. 当前聊天历史只有 7 天过期才会总结  
   新实现会在会话结束、页面关闭或主动截断时也生成 episodic summary。

### 事件压缩与保留策略

由于存储仍然基于 localStorage，事件不能无限增长。需要引入 compaction 规则：

1. `question_answered`
   - 保留最近 50 条原始事件
   - 更老事件折叠进对应 `ConceptProjection` 的累计统计，不再保留全量明细

2. `chat_user_message`
   - 会话被总结为 `chat_session_summarized` 后，原始消息事件只保留最近 20 条
   - 更老消息由 `EpisodicProjection.summary` 代表

3. `node_started`
   - 仅保留最近一次进入同一节点的事件

4. `node_completed`
   - 保留，因为其数量天然有限，且对学习历史有直接价值

5. compaction 触发时机
   - projector flush 后
   - 页面隐藏时
   - `events.length` 超过阈值时

6. 目标上限
   - `memoryStoreV3.events` 默认控制在 200 条以内

---

## Retrieval 设计

### ConceptLinker

虽然 retrieval 以 concept id 为核心，但真实用户输入、聊天提问和部分旧摘要仍然是自由文本，因此需要一个显式的 `ConceptLinker` 作为结构化入口，而不是把这部分逻辑散落到 retrieval builder 里。

```ts
type LinkedConcept = {
  conceptId: string;
  conceptName: string;
  confidence: number;
  source: 'exact_name' | 'alias' | 'current_node' | 'course_scope' | 'fallback_text_match';
};
```

`ConceptLinker` 的输入：

1. 当前节点 `teachConceptIds`
2. 当前课程 `globalConcepts`
3. 用户消息文本
4. alias 字典

链接顺序：

1. 当前节点 concept 名称精确命中
2. 当前节点 concept alias 命中
3. 当前课程范围内 concept 名称命中
4. 当前课程范围内 concept alias 命中
5. 最后才是 fallback 文本相似度

输出：

1. `LinkedConcept[]`
2. 若无高置信度结果，允许返回空数组，不强行链接

使用位置：

1. 聊天 retrieval：从用户问题解析相关 concept
2. 聊天 summary：把自由文本 unresolved concept 归一到 canonical concept id
3. validator issue：在需要引用 concept 时展示稳定 name/id

这样可以把“自由文本 -> concept id”的不稳定逻辑集中到一处，而不是让 retrieval builder 再次依赖大量词面猜测。

### 规划 retrieval

课程生成时按以下顺序检索：

1. 与当前 topic 高关联的 `TopicProjection`
2. 由 `riskConceptIds` 派生出的 concept 投影
3. 与用户目标和 topic 相关的 stable facts
4. 最近相关课程或聊天 episode

### 教学 retrieval

节点生成时按以下顺序检索：

1. 该节点 `teachConceptIds`
2. `prerequisiteConceptIds`
3. `assessmentTargetIds`
4. 通过 `ConceptLinker` 从近期提问解析出的 concept
5. 近期相关题目与聊天 episode
6. 可用类比与解释偏好

### 聊天 retrieval

聊天回答时按以下顺序检索：

1. 当前节点 `teachConceptIds`
2. 通过 `ConceptLinker` 从当前问题解析出的 concept id
3. 当前节点的高风险 concept
4. 最近相关聊天摘要

### 文本匹配策略

词面匹配和 alias 字典仍保留，但只作为 `ConceptLinker` 的 fallback：

1. 先做 concept id 关联
2. 再做 topic / goal / course 关联
3. 最后才用 alias 和 token overlap 兜底

---

## Validator / Refine 设计

### 为什么用双阶段

如果把全部质量约束都写进 prompt，模型会：

1. 变慢
2. 更容易过拟合格式要求，牺牲内容表达
3. 在每次调用都重复消费大量 token

因此采用：

1. 第一阶段：自由生成
2. 第二阶段：本地 validator
3. 第三阶段：失败才 refine

### refine 上限

1. 课程生成最多 refine 1 次
2. 节点生成最多 refine 1 次
3. refine 后仍失败则返回错误，并附带 validator issue

### validator 实现位置

新增：

1. `lib/validation/course-validator.ts`
2. `lib/validation/node-validator.ts`
3. `lib/generation/refine.ts`

---

## 存储与清理策略

### 新存储键

| Key | 内容 |
|-----|------|
| `ai-learning-data-v2` | 课程列表、当前课程、节点内容、目录视图 |
| `memoryStoreV3` | profile + events + projections |
| `chatHistory_{courseId}` | 当前课程聊天历史 |

### 清理策略

本次版本直接执行一次性切换：

1. 删除旧的 `ai-learning-data`
2. 删除旧的 `userMemory`
3. 删除旧的 `userMemoryV2`
4. 重建 `memoryStoreV3`

因为已明确接受清空旧数据，所以不保留迁移兼容层。

---

## 前端影响

### 课程目录页

目录页继续展示 `CourseTreeView`，不需要理解全部 blueprint 细节。

### 学习页

学习页的题目判分和 memory 写入改为依赖 `targetConceptId`，不再从题干中抽 concept。

### 聊天组件

聊天消息发送时只追加 `chat_user_message` 事件。对话摘要生成后追加 `chat_session_summarized` 事件。

---

## 测试策略

### 单元测试

新增覆盖：

1. `CourseBlueprint` validator
2. `NodeLesson` validator
3. `MemoryProjector`
4. retrieval builder
5. refine 触发条件

### 集成测试

覆盖以下链路：

1. 课程生成 draft 通过 validator 时不 refine
2. draft 失败时会触发 refine
3. 节点内容生成后题目能用 `targetConceptId` 更新 concept projection
4. 聊天结束后会写 episode summary

### 运行入口

当前仓库还缺少稳定的 TypeScript test 运行入口。本次重构需要顺手补一个可执行命令，否则难以验证大范围类型和 projector 重构。

---

## 风险与缓解

### 风险 1：改动面大，容易把前端课程消费链路改坏

缓解：
1. 保留 `CourseTreeView`
2. 先让 UI 吃派生视图，再逐步切主数据源

### 风险 2：validator 过严导致频繁 refine，反而变慢

缓解：
1. validator 只校验硬约束
2. 只允许 1 次 refine
3. issue 文案保持简短

### 风险 3：event projector 出错会让 retrieval 全面退化

缓解：
1. projector 写成纯函数
2. 单测覆盖事件到投影的关键变换
3. repository 层暴露重建和快照方法，便于调试

---

## 验收标准

满足以下条件视为本次重构完成：

1. 课程生成主输出变为 `CourseBlueprint`
2. 课程目录页消费 `CourseTreeView`
3. 节点内容生成消费 blueprint 节点元数据，而不是只靠标题
4. memory 热路径只 append event
5. retrieval 读取 projections，而不是直接扫描原始聊天和旧式派生字段
6. 课程和节点生成都具备 validator/refine 机制
7. 题目使用 `targetConceptId` 回写 memory
8. 仓库具备可运行的 TypeScript 测试入口

---

## 推荐实施顺序

1. 先落类型和存储切换
2. 再落课程 blueprint 生成和 validator/refine
3. 再落节点内容生成和 validator/refine
4. 再切 memory event pipeline 与 projections
5. 最后改前端消费与测试
