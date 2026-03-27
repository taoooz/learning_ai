# 课程蓝图概念设计

> 本文档描述的方案目前已暂停使用，仅作为历史参考。

## 概述

概念设计是一种**精确的课程内容规划方法**，通过预定义概念列表和概念映射，实现：
- 精确的知识点覆盖追踪
- 个性化的学习路径调整
- 基于概念掌握度的验证

## 核心数据结构

### CourseBlueprint

```typescript
interface CourseBlueprint {
  courseId: string;
  topic: string;
  learnerPositioning: {
    estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
    difficultySummary: string;      // 为什么这门课是这个难度
    whyThisCourseFits: string;     // 针对哪类起点用户
  };
  courseGoal: string;

  // 核心：全局概念列表
  globalConcepts: CanonicalConcept[];

  nodes: CourseBlueprintNode[];
}

interface CanonicalConcept {
  id: string;
  name: string;
  aliases: string[];  // 同义词/别名
}

interface CourseBlueprintNode {
  index: number;
  title: string;
  teachingGoal: string;

  // 概念映射：节点与概念的关联
  teachConceptIds: string[];           // 本节点教授的概念
  prerequisiteConceptIds: string[]; // 前置概念
  assessmentTargetIds: string[];      // 评估目标

  bridgeFromPreviousNode: string;    // 如何承接上一节点

  personalizationHooks: {
    mustRemediateConceptIds: string[];     // 必须纠错的概念（常见误区）
    canCompressKnownConceptIds: string[]; // 可压缩的概念（用户已掌握）
    analogyFactIds: string[];              // 将使用的类比
  };

  cardCount: number;
  status: 'locked' | 'available' | 'completed';
}

interface Coverage {
  introducedConceptIds: string[];   // 引入了哪些概念
  assessedConceptIds: string[];    // 评估了哪些概念
  remediatedConceptIds: string[];  // 纠错了哪些概念
}
```

## Prompt 设计

### buildCourseTreePrompt

完整格式的 Prompt，包含：
- 用户洞察（知识背景、类比经历）
- Memory 信息
- 澄清回答
- 搜索增强
- 个性化要求（压缩、补基础、纠错）

### 输出格式

```json
{
  "courseId": "唯一ID",
  "topic": "主题",
  "difficultySummary": "难度描述",
  "totalNodes": 5,
  "nodes": [
    {
      "index": 0,
      "title": "节点标题",
      "cardCount": 8,
      "status": "locked",
      // 以下为概念设计新增字段
      "teachConceptIds": ["concept-1", "concept-2"],
      "prerequisiteConceptIds": [],
      "assessmentTargetIds": ["concept-1"],
      "bridgeFromPreviousNode": "从核心基础开始"
    }
  ],
  "globalConcepts": [
    { "id": "concept-1", "name": "Agent定义", "aliases": ["智能体"] }
  ]
}
```

## 验证机制

### validateCourseBlueprint

检查：
1. **概念覆盖**：所有 `mustCoverConceptIds` 必须被某个节点的 `teachConceptIds` 覆盖
2. **评估覆盖**：所有 `riskConceptIds` 必须被某个节点的 `assessmentTargetIds` 覆盖
3. **概念映射有效**：每个节点的 `teachConceptIds` 必须存在于 `globalConcepts` 中
4. **前置依赖**：如果节点 A 的 `prerequisiteConceptIds` 包含概念 X，则包含 X 的节点必须在 A 之前

### validateNodeLesson

检查：
1. **卡片概念覆盖**：每张卡片的 `coveredConceptIds` 必须覆盖对应节点的 `teachConceptIds`
2. **题目评估覆盖**：每道题的 `targetConceptId` 必须在 `assessmentTargetIds` 中
3. **题目-card 绑定**：每道题的 `cardId` 必须对应一张实际存在的卡片

## 个性化机制

### 基于概念的压缩

如果用户已掌握某个概念（通过 Memory 中的 `masteryScore` 判断）：
- 该概念的节点可压缩为"快速回顾"
- `personalizationHooks.canCompressKnownConceptIds` 标记

### 基于风险的纠错

如果某个概念容易产生误区：
- 必须在节点中显式纠正
- `personalizationHooks.mustRemediateConceptIds` 标记

### 类比落地

使用用户的真实经历作为类比：
- `personalizationHooks.analogyFactIds` 引用
- 只在节点设计中体现，不写进 JSON

## 搜索增强

当模型判断需要更多信息时，会返回：
```json
{
  "needsSearch": true,
  "searchQueries": ["查询1", "查询2"]
}
```

## 当前状态

**已暂停使用**：当前系统使用简化格式 `buildCompactCourseBlueprintPrompt`，不包含概念设计。

简化格式的输出：
```json
{
  "difficultySummary": "一句话描述",
  "courseGoal": "一句话描述",
  "nodes": [{
    "title": "具体标题",
    "teachingGoal": "一句话目标"
  }]
}
```

## 未来恢复

如需恢复概念设计：
1. 恢复 `buildCourseTreePrompt` 作为需要澄清时的分支
2. 恢复 `validateCourseBlueprint` 和 `validateNodeLesson` 验证逻辑
3. 恢复 `convertOutlineToBlueprint` 中的概念映射逻辑
4. 恢复 NodeLesson 输出中的 `coveredConceptIds` 和 `targetConceptId`
