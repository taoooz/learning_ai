# Memory System 数据流优化方案

## 问题分析

### 1. mustCoverConcepts/riskConcepts 数据质量差

**根本原因**：
- `conceptId` 来自事件 payload 的 `teachConceptIds`
- 这些 ID 可能是从 LLM 生成的课程大纲中提取的
- LLM 可能返回垃圾数据（标点符号、短语片段）

**解决方案**：
1. **在事件写入时过滤**：`appendEventToMemoryStoreV3` 中验证 conceptId
2. **在读取时过滤**：Memory Agent 中添加验证逻辑（已完成）
3. **改进 LLM prompt**：明确要求返回有效的概念名称

### 2. recentRelevantCourses 的 summary 无用

**当前**：`"最近完成了 我想学 langgraph 的第 1 节"`

**应该**：`"完成了 LangGraph 基础：理解状态图和节点概念"`

**解决方案**：
- 在 `node_completed` 事件中传入 `nodeTitle` 和 `teachingGoal`
- 修改 summary 格式：`完成了 ${nodeTitle}：${teachingGoal}`

### 3. insights 生成质量不稳定

**当前流程**：
```
用户填写 → LLM 提取 → insights
```

**问题**：
- LLM 可能提取不准确
- 用户更新 profile 后需要重新生成
- 没有人工审核机制

**解决方案**：
1. **改进 prompt**：更明确的提取规则
2. **添加验证**：过滤空字符串、重复项
3. **可选人工编辑**：允许用户手动调整 insights

---

## 实施计划

### 阶段 1：修复 recentRelevantCourses（立即）

**修改点**：
1. `ProgressContext.tsx`：在 `node_completed` 事件中传入 `nodeTitle` 和 `teachingGoal`
2. `aggregator.ts`：修改 summary 格式

**预期效果**：
```json
{
  "topic": "LangGraph",
  "summary": "完成了 LangGraph 基础：理解状态图和节点概念"
}
```

### 阶段 2：改进 conceptId 验证（立即）

**修改点**：
1. `aggregator.ts`：在 `upsertConceptProjection` 中添加验证
2. 过滤规则：
   - 长度 >= 2
   - 不包含标点符号
   - 不是纯数字

### 阶段 3：优化 insights 生成（可选）

**修改点**：
1. `buildProfileInsightPrompt`：更明确的规则
2. 添加后处理：去重、过滤空值
3. UI 改进：允许用户编辑 insights

---

## 优先级

1. ✅ **已完成**：Memory Agent 读取时过滤垃圾数据
2. 🔥 **高优先级**：修复 recentRelevantCourses summary
3. 🔥 **高优先级**：在事件写入时验证 conceptId
4. 📝 **中优先级**：改进 insights prompt
5. 💡 **低优先级**：允许用户编辑 insights
