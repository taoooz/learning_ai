# 课程创建体验优化设计

## 背景

当前课程创建流程直接生成完整内容，没有利用用户背景和 memory，缺乏确认环节，内容生成方式不够优化。

## 目标

平衡速度和体验，利用用户背景生成更贴合用户的课程，加入确认环节，分离 cards 和 questions 生成提高内容质量。

---

## 新流程

### 步骤 1：用户输入
用户表达想学习的内容（一段话或一句话）。

### 步骤 2：课程纲要生成与确认
**输入**：topic + Profile + memory
**输出**：课程纲要（Blueprint 结构化展示）

### 步骤 3：确认页（改造 ClarificationScreen）
- 显示确认卡片或选择题
- 用户可发消息，AI 重新思考后发出新问题或确认卡片
- 未回答的问题不计入 3 道限制

### 步骤 4：课程目录生成
**输入**：已确认的 Blueprint
**输出**：课程名称 + 描述 + 目录（节点名 + 描述）
**备注**：不需要 memory

### 步骤 5：节点内容生成（分离）
**5a 生成 cards**：当前节点信息 + memory
**5b 生成 questions**：当前节点信息 + memory + cards（基于知识范围）

用户看到目录后，第一节内容后台同步生成。

### 步骤 6：节点学习与作答
- 用户进入节点学习
- 作答题目
- 有错题则中间页引导重新作答

### 步骤 7：结束庆祝页
- 正反馈
- 主按钮：进入下一节
- 次按钮：返回课程目录

---

## 数据流

```
用户输入 topic
      ↓
步骤 2: 课程纲要生成 (topic + Profile + memory)
      ↓
步骤 3: 确认页 (确认卡片 或 选择题 或 消息输入)
      ↓
步骤 4: 目录生成 (Blueprint → 名称 + 描述 + 节点结构)
      ↓
用户看到课程目录页（第一节后台生成）
      ↓
步骤 5a: 生成 cards (节点信息 + memory)
      ↓
步骤 5b: 生成 questions (节点信息 + memory + cards)
      ↓
步骤 6: 学习 + 作答
      ↓
步骤 6b: 错题重答（如需要）
      ↓
步骤 7: 结束庆祝页
```

---

## API 设计

### 新增：课程纲要生成
**Endpoint**：`POST /api/generate/outline`

**输入**：
```typescript
{
  topic: string;
  userProfile?: UserProfile | null;
  userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null;
  clarificationAnswers?: ClarificationAnswer[];
  userMessage?: string;
}
```

**输出**：
```typescript
// 确认
{ type: 'confirmation', blueprint: CourseBlueprint }

// 选择题
{ type: 'questions', questions: ClarificationQuestion[] }

// 重新评估
{ type: 'reconsider', message: string }
```

### 新增：课程目录生成
**Endpoint**：`POST /api/generate/toc`

**输入**：
```typescript
{ blueprint: CourseBlueprint }
```

**输出**：
```typescript
{
  courseName: string;
  courseDescription: string;
  nodes: Array<{ index: number; title: string; description: string }>;
}
```

### 改造：节点内容生成（分离）

**5a cards**：`POST /api/generate/node/cards`
```typescript
{
  topic: string;
  nodeInfo: { teachingGoal: string; teachConceptIds: string[]; prerequisiteConceptIds: string[] };
  userProfile?: UserProfile | null;
  userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null;
}
```

**5b questions**：`POST /api/generate/node/questions`
```typescript
{
  topic: string;
  nodeInfo: { teachingGoal: string; teachConceptIds: string[]; prerequisiteConceptIds: string[] };
  cards: LearningCard[];
  userProfile?: UserProfile | null;
  userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null;
}
```

---

## 实现顺序

1. 步骤 2-3：课程纲要生成与确认页
2. 步骤 4：课程目录生成
3. 步骤 5：节点内容分离生成
4. 步骤 6-7：错题重答 + 结束庆祝页
