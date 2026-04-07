# Markdown 协议规范

## 概述

在流式内容中嵌入结构化组件，使用特殊标记分隔。

## 支持的块类型

### 1. 文本块
普通 Markdown 文本，无需特殊标记。

### 2. 问题块
```markdown
---QUESTION:1---
你目前对 React Hooks 的了解程度？
- [ ] 完全不了解
- [ ] 听说过但没用过
- [ ] 用过基础的 useState/useEffect
- [ ] 熟练使用各种 Hooks
---END---
```

**格式说明**：
- `---QUESTION:id---`：开始标记，id 为问题编号
- 第一行：问题文本
- 后续行：选项，格式为 `- [ ] 选项内容`
- `---END---`：结束标记

### 3. 纲要块
```markdown
---OUTLINE---
学习方向: React Hooks 深入理解
学习目标: 掌握 Hooks 原理和最佳实践
学习者定位: 有 React 基础的开发者
---END---
```

**格式说明**：
- `---OUTLINE---`：开始标记
- 每行格式：`字段名: 字段值`
- `---END---`：结束标记

## 完整示例

```markdown
根据你的情况，我需要先了解一些信息。

---QUESTION:1---
你目前对 React Hooks 的了解程度？
- [ ] 完全不了解
- [ ] 听说过但没用过
- [ ] 用过基础的 useState/useEffect
- [ ] 熟练使用各种 Hooks
---END---

请选择最符合你情况的选项。

---QUESTION:2---
你的学习目标是什么？
- [ ] 快速入门，能用就行
- [ ] 深入理解原理
- [ ] 解决实际项目问题
- [ ] 准备面试
---END---

根据你的回答，我为你设计了这个学习路径：

---OUTLINE---
学习方向: React Hooks 深入理解
学习目标: 掌握 Hooks 原理和最佳实践
学习者定位: 有 React 基础的开发者
---END---

让我们开始吧！
```

## 后端实现建议

### SSE 事件流
```typescript
// 1. 思考阶段
data: {"type":"thinking","message":"分析用户需求..."}

// 2. 流式内容
data: {"type":"content_delta","content":"根据你的情况"}
data: {"type":"content_delta","content":"，我需要先"}
data: {"type":"content_delta","content":"了解一些信息。\n\n"}

// 3. 嵌入问题块
data: {"type":"content_delta","content":"---QUESTION:1---\n"}
data: {"type":"content_delta","content":"你目前对 React Hooks 的了解程度？\n"}
data: {"type":"content_delta","content":"- [ ] 完全不了解\n"}
data: {"type":"content_delta","content":"- [ ] 听说过但没用过\n"}
data: {"type":"content_delta","content":"---END---\n\n"}

// 4. 继续文本
data: {"type":"content_delta","content":"请选择最符合你情况的选项。"}

// 5. 完成
data: [DONE]
```

### 注意事项
1. 确保 `---END---` 标记完整传输后再发送新内容
2. 问题选项必须以 `- [ ]` 开头
3. 纲要字段名必须与前端约定一致
