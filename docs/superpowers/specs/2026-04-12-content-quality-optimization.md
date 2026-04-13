# 课程内容质量优化

## 问题

生成的课程内容存在"水分"：空泛的描述、车轱辘话、Google 搜一下就能看到的常识。根本原因：

1. **领域知识不足**：LLM 对特定领域缺少深度知识，只能输出训练数据中的通用表述
2. **Prompt 缺乏质量约束**：说了"避免泛泛而谈"但没定义什么是好的内容

## 方案

### 改动 1：Cards Prompt 重构（`cards_service.py` - `build_cards_prompt`）

用 XML 标签分层，区分关键指令和参考信息。核心改动：

**a) 新增 `<critical_rules>` 区块**

```
<critical_rules>
## 写作标准

你的读者是有经验的职场人，来这里是学有实际价值的东西。
如果你写的内容在 Google 搜索结果摘要里随便就能看到，就不要写。

### 写法要求
- 内容要有重点，不要堆砌无意义内容
- 用结构化的方法表达知识或观点
- 一个卡片围绕一个知识或技能
- 去掉任何一句删掉后读者没有损失的话
</critical_rules>
```

设计理由：
- 角色设定明确目标读者是有经验的职场人，学有实际价值的东西
- 4 条写法要求精简，不限制模型发挥空间

**b) Prompt 结构重组**

```
<critical_rules> → 关键指令（写作标准）
<chapter_info>   → 章节信息
<user_context>   → 用户画像（降为参考区域）
<output_format>  → 输出格式 + 可视化规则
```

XML 标签比普通段落更能吸引 LLM 注意力。

### 改动 2：TOC Prompt 加章节描述质量标准（`toc_service.py` - `build_toc_prompt`）

在"设计原则"段落后追加：

```
## 章节描述质量要求
- 建议包含至少 2 个具体知识点或技能
- 建议说明读者学完后能做的一件具体的事
- 建议避免"深入了解""掌握核心""全面了解"等空泛表述
```

使用"建议"而非"必须"，避免 MiniMax reasoning_split 下模型过度思考导致生成时间过长。

## 不做的事

- 不加后处理压缩步骤（Chain of Density 式二次 LLM 调用）：先验证 prompt 优化效果
- 不改前端：SSE 事件类型和流程不变
- 不改数据流：API 接口和 payload 格式不变

## 改动范围

| 文件 | 改动 |
|------|------|
| `python-agent/services/cards_service.py` | `build_cards_prompt` 重构（XML分区 + 写作标准） |
| `python-agent/services/toc_service.py` | `build_toc_prompt` 追加质量标准 |

## 验证方式

1. 启动 Python Agent
2. 生成一个课程 TOC → 检查章节描述是否包含具体知识点
3. 进入第一章生成 Cards → 检查内容信息密度、是否有车轱辘话
4. 对比优化前后的生成时间，确认没有显著增加
