# Memory System 清理方案

## 当前状态分析

### 三层存储架构

1. **V1 (UserMemory)** - Legacy 格式
   - 结构：`{ profile, learningHistory, extractedInsights, conversationSummaries }`
   - 使用场景：
     - `updateInterests()` - 更新主题兴趣
     - `addKnowledgeGap()` - 添加知识盲点
     - `addQuestionPattern()` - 记录提问模式
     - `addLearningRecord()` - 记录学习历史
   - 调用位置：
     - `ChatWidget.tsx` - 聊天时记录
     - `learn/[nodeIndex]/page.tsx` - 学习时记录

2. **V2 (MemoryStoreV2)** - 中间格式
   - 结构：`{ profile, states, summaries, signals }`
   - 使用场景：Memory Agent 内部转换层
   - 状态：**仅用于转换，不直接使用**

3. **V3 (MemoryStoreV3)** - 当前格式
   - 结构：`{ profile, events, projections }`
   - 使用场景：
     - `appendMemoryEvent()` - 写入事件
     - Memory Agent 读取
   - 状态：**主要存储格式**

---

## 问题识别

### 1. 双写问题

**现状**：
```typescript
// V1 写入
repository.saveLegacyMemory(memory);

// V3 写入
repository.appendMemoryEvent({...});
```

**问题**：
- 数据不一致风险
- 维护成本高
- V1 的 `extractedInsights` 已被 V3 的 `projections` 替代

### 2. 废弃的 V1 方法

以下方法仍在使用，但功能已被 V3 替代：

| V1 方法 | V3 替代 | 状态 |
|---------|---------|------|
| `updateInterests()` | 自动从 `course_generated` 事件推断 | ❌ 冗余 |
| `addKnowledgeGap()` | `chat_confusion` 事件 | ❌ 冗余 |
| `addQuestionPattern()` | `chat_question` 事件 | ❌ 冗余 |
| `addLearningRecord()` | `node_completed` 事件 | ❌ 冗余 |

### 3. V2 的定位不清

**当前**：V2 仅用于 Memory Agent 内部转换  
**问题**：增加复杂度，V3 → V2 → 处理 → 返回

---

## 清理方案

### 阶段 1：移除 V1 写入逻辑（高优先级）

**目标**：所有数据写入统一使用 V3 事件

**修改点**：
1. `ChatWidget.tsx`：
   ```typescript
   // 删除
   userMemory.addQuestionPattern(...)
   userMemory.addKnowledgeGap(...)
   userMemory.updateInterests(...)
   
   // 已有 V3 事件，无需额外操作
   ```

2. `learn/[nodeIndex]/page.tsx`：
   ```typescript
   // 删除
   userMemory.updateInterests(...)
   
   // 已有 course_generated 事件，无需额外操作
   ```

3. `hooks/useUserMemory.ts`：
   - 删除 `updateInterests`
   - 删除 `addKnowledgeGap`
   - 删除 `addQuestionPattern`
   - 删除 `addLearningRecord`
   - 保留 `recordQuestionAttempt`（已同时写入 V1 和 V3）

### 阶段 2：简化 V2 转换（中优先级）

**目标**：减少转换层级

**方案 A（激进）**：Memory Agent 直接读取 V3
- 优点：减少转换开销
- 缺点：需要重写 Memory Agent 逻辑

**方案 B（保守）**：保持现状
- 优点：稳定性高
- 缺点：多一层转换

**建议**：采用方案 B，V2 作为稳定的中间层

### 阶段 3：清理 V1 存储（低优先级）

**目标**：停止写入 V1 格式

**修改点**：
1. `repository.ts`：
   - 删除 `saveLegacyMemory()`
   - 保留 `getLegacyMemory()`（用于迁移）

2. `storage.ts`：
   - 保留 `userMemory` key（用于迁移）
   - 不再写入

---

## 实施优先级

### 🔥 立即执行（阶段 1）

1. ✅ 删除 `ChatWidget.tsx` 中的 V1 写入
2. ✅ 删除 `learn/[nodeIndex]/page.tsx` 中的 V1 写入
3. ✅ 删除 `useUserMemory` 中的废弃方法

**预期效果**：
- 消除双写，数据一致性提升
- 代码减少 ~100 行

### 📝 后续优化（阶段 2）

保持 V2 作为中间层，暂不修改

### 💡 长期规划（阶段 3）

用户数据迁移完成后，删除 V1 存储逻辑

---

## 风险评估

### 低风险
- V1 写入已被 V3 事件覆盖
- 删除 V1 写入不影响读取
- V3 事件已在生产环境运行

### 需要验证
- `recordQuestionAttempt` 同时写入 V1 和 V3，确认 V3 数据完整性
- `conversationSummaries` 是否还在使用

---

## 验证清单

删除 V1 写入后，验证以下功能：

- [ ] 聊天记录正常保存
- [ ] 知识盲点正常识别
- [ ] 学习历史正常记录
- [ ] Memory Agent 正常检索
- [ ] 课程推荐正常工作
