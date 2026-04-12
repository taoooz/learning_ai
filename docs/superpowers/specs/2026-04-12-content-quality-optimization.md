# 课程内容质量优化

## 问题

生成的课程内容存在"水分"：空泛的描述、车轱辘话、Google 搜一下就能看到的常识。根本原因：

1. **领域知识不足**：LLM 对特定领域缺少深度知识，只能输出训练数据中的通用表述
2. **Prompt 缺乏质量约束**：说了"避免泛泛而谈"但没定义什么是好的内容
3. **搜索可选不可选**：Agent 版虽然接了搜索工具，但 LLM 大概率选择不搜

## 方案

### 改动 1：Cards Prompt 重构（`cards_service.py` - `build_cards_prompt`）

用 XML 标签分层，区分关键指令和参考信息。核心改动：

**a) 新增 `<critical_rules>` 区块**

```
<critical_rules>
## 写作标准

你的读者是有经验的职场人，来这里是学"他自己查不到的东西"。
如果你写的内容在 Google 搜索结果摘要里就能看到，就不要写。

### 写法要求
- 开篇直接给结论，不要铺垫
- 用列表/对比表/决策树代替段落叙述
- 给具体数字和范围（"延迟增加 2-3 倍" > "延迟显著增加"）
- 说清边界条件（"数据量 < 10万用 FAISS，超过考虑 Milvus"）
- 一个卡片只讲透一个知识点
- 去掉任何一句删掉后读者没有损失的话
</critical_rules>
```

设计理由：
- 用角色设定（"为有经验的职场人写"）替代禁令清单，正面引导比负面约束更有效
- 每条规则都附带具体对比示例，让 LLM 理解期望的信息密度
- 6 行规则足够精简，不会显著增加 reasoning 时间

**b) Prompt 结构重组**

```
<critical_rules> → 关键指令（写作标准）
<chapter_info>   → 章节信息
<user_context>   → 用户画像（降为参考区域）
<output_format>  → 输出格式 + 搜索指令 + 可视化规则
```

XML 标签比普通段落更能吸引 LLM 注意力。

**c) 搜索从可选改为强制**

```
"建议至少搜索 1 次以获取领域真实知识"（替代原来的"可主动调用"）
```

### 改动 2：TOC Prompt 加章节描述质量标准（`toc_service.py` - `build_toc_prompt`）

在"设计原则"段落后追加：

```
## 章节描述质量要求
- 建议包含至少 2 个具体知识点或技能
- 建议说明读者学完后能做的一件具体的事
- 建议避免"深入了解""掌握核心""全面了解"等空泛表述
```

使用"建议"而非"必须"，避免 MiniMax reasoning_split 下模型过度思考导致生成时间过长。

### 改动 3：TOC Agent 强制搜索（`toc_agent.py` - `stream_toc_with_tools`）

user message 改为明确要求先搜索：

```python
{"role": "user", "content": "请生成课程目录。建议先使用 search_info 搜索该领域的最新知识和常见课程结构，确保目录内容准确且不过时。"}
```

## 不做的事

- 不加后处理压缩步骤（Chain of Density 式二次 LLM 调用）：先验证 prompt 优化效果
- 不改前端：SSE 事件类型和流程不变
- 不改数据流：API 接口和 payload 格式不变

## 改动范围

| 文件 | 改动 |
|------|------|
| `python-agent/services/cards_service.py` | `build_cards_prompt` 重构 |
| `python-agent/services/toc_service.py` | `build_toc_prompt` 追加质量标准 |
| `python-agent/services/toc_agent.py` | user message 改为建议搜索 |

## 验证方式

1. 启动 Python Agent
2. 生成一个课程 TOC → 检查章节描述是否包含具体知识点
3. 进入第一章生成 Cards → 检查内容信息密度、是否有车轱辘话
4. 对比优化前后的生成时间，确认没有显著增加
