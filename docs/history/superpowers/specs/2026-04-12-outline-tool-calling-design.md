# Outline Agent Tool Calling 改造设计

## 背景

当前 outline 生成环节存在的问题：
- 模型可能一次输出多个 `<quiz>` XML 标签，解析器只取第一个，导致其他问题被丢弃
- Blueprint 生成可能夹杂无关内容
- 文本解析脆弱，不够 robust

## 目标

通过 Tool Calling 机制，强制模型：
1. 提问时必须调用 `ask_question` tool
2. 提交 Blueprint 时必须调用 `submit_blueprint` tool
3. 每次 reply 只使用一个 tool

## 设计

### 新增 Tools

```python
# search_tools.py 新增

ASK_QUESTION_TOOL = {
    "type": "function",
    "function": {
        "name": "ask_question",
        "description": "向用户提出一个问题以了解学习需求或背景。如果用户输入已经足够清晰，可以直接调用 submit_blueprint。",
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "要问的问题，简洁明确，一句话"
                }
            },
            "required": ["question"]
        }
    }
}

SUBMIT_BLUEPRINT_TOOL = {
    "type": "function",
    "function": {
        "name": "submit_blueprint",
        "description": "提交课程大纲。如果还有问题想问，先调用 ask_question。",
        "parameters": {
            "type": "object",
            "properties": {
                "learning_direction": {
                    "type": "string",
                    "description": "学习方向/课程标题，15-30字"
                },
                "keypoint": {
                    "type": "string",
                    "description": "核心知识点，15-30字"
                },
                "goal": {
                    "type": "string",
                    "description": "学习目标，20-40字"
                },
                "estimated_level": {
                    "type": "string",
                    "enum": ["beginner", "intermediate", "advanced"]
                },
                "background_summary": {
                    "type": "string",
                    "description": "用户背景摘要"
                },
                "skip_basics": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "可跳过的基础知识"
                }
            },
            "required": ["learning_direction", "keypoint", "goal", "estimated_level"]
        }
    }
}
```

**设计原则**：
1. 移除 `question_type`——模型不需要分类
2. `blueprint` 参数扁平化——与模型实际输出的字段对应
3. 使用下划线命名（JSON 风格）
4. 添加 `required` 约束，明确必填字段

### Tool 执行函数

```python
def ask_question(question: str, question_type: str = "clarification") -> str:
    """返回空字符串，结果通过 SSE 事件发送"""
    return ""  # 结果在 yield 中处理

def submit_blueprint(blueprint: dict) -> str:
    """返回空字符串，结果通过 SSE 事件发送"""
    return ""
```

### System Prompt 更新

在 `build_initial_prompt()` 中增加：

```
## 工具使用规则
1. 每次 reply 只使用一个 tool
2. 如果需要了解用户信息，调用 ask_question 提问
3. 信息足够时，调用 submit_blueprint 提交完整大纲
4. 不要同时调用多个 tool
```

### 后端事件处理

```python
def _handle_tool_call(tool_call: dict, splitter) -> list[dict]:
    """处理单个 tool call，只消费第一个"""
    tool_name = tool_call["function"]["name"]
    tool_args = tool_call["function"]["arguments"]

    if tool_name == "ask_question":
        question = tool_args.get("question", "")
        yield {"type": "question", "question": question}

    elif tool_name == "submit_blueprint":
        blueprint = tool_args.get("blueprint", {})
        yield {"type": "confirmation", "blueprint": blueprint, "sessionId": session_id}

    elif tool_name == "search_info":
        query = tool_args.get("query", "")
        yield {"type": "thinking", "message": f"正在搜索：{query}"}

    elif tool_name == "read_url":
        url = tool_args.get("url", "")
        yield {"type": "thinking", "message": f"正在读取：{url}"}
```

### 流程改造

**生成阶段**：
```
1. 用户输入 topic
2. 前端 → POST /api/agents/outline/generate_agent { topic, userProfile, userMemory }
3. Python Agent 调用 MiniMax API，tools=[search_info, read_url, ask_question, submit_blueprint]
4. 模型决定：
   - 调用 ask_question → 后端 yield question → 前端显示
   - 调用 submit_blueprint → 后端 yield confirmation → 前端显示确认
   - 调用 search_info/read_url → 后端 yield thinking → 继续循环
5. 用户选择选项回答 → 前端发送 userMessage
6. 模型再决定（问下一个 OR 提交 blueprint）
```

**回答阶段**：
```
1. 前端 → POST /api/agents/outline/answer_agent { sessionId, answer }
2. Python Agent 从 session 恢复状态，继续调用 MiniMax API
3. 流程同上
```

### 前端改造

#### SSE 事件类型更新

```typescript
type OutlineSSEEvent =
  | { type: 'thinking'; message: string }
  | { type: 'content_delta'; content: string }  // 保留，streaming text
  | { type: 'question'; question: string; questionType?: string }  // 新增，逐个问题
  | { type: 'questions'; questions: ClarificationQuestion[]; sessionId: string }  // 保留，兼容
  | { type: 'confirmation'; blueprint: OutlineBlueprint; sessionId: string }
  | { type: 'session_created'; sessionId: string }
  | { type: 'error'; message: string }
```

#### 前端处理逻辑

```typescript
// useStreamChat.ts 或 CourseContext.tsx

onQuestion(question: string) {
  // 显示问题，等待用户选择
  setCurrentQuestion(question);
  setWaitingForAnswer(true);
}

onConfirmation(blueprint, sessionId) {
  // 显示 blueprint 确认
  setBlueprint(blueprint);
  setShowConfirmation(true);
}
```

### Blueprint 结构（直接传递，不解析 XML）

```typescript
interface OutlineBlueprint {
  learning_direction: string;    // "ToB AI 产品经理的 AI Agent 知识体系"
  keypoint: string;             // "掌握 Agent 从设计到落地的核心能力"
  goal: string;                 // "能够独立规划并落地一个企业级 Agent 产品"
  estimated_level: "beginner" | "intermediate" | "advanced";
  background_summary: string;
  skip_basics: string[];
}
```

与现有 `outline_service.py` 中解析后的结构保持一致（字段名对应）。

## 改动文件清单

### Python Agent

1. `services/outline_agent.py`
   - 新增 `ASK_QUESTION_TOOL`, `SUBMIT_BLUEPRINT_TOOL`
   - 修改 `stream_outline_with_tools()` 使用新 tools
   - 修改 `_handle_tool_call()` 只消费第一个 tool
   - 修改 `stream_answer_with_tools()` 同上

2. `lib/tools/search_tools.py`
   - 新增 `ask_question()`, `submit_blueprint()` 执行函数
   - 新增 tool 定义

3. `services/outline_service.py`
   - 可能需要调整 `build_initial_prompt()` 增加 tool 规则

### 前端 (Next.js)

1. `types/course.ts`
   - 更新 `OutlineSSEEvent` 类型

2. `contexts/CourseContext.tsx`
   - 处理新的 `question` 事件类型
   - 更新 `submitOutlineMessage` 回调

3. `app/generate/chat/page.tsx` 或相关组件
   - 更新问题显示逻辑

## 测试计划

1. 单元测试：验证 tool call 处理逻辑
2. 集成测试：
   - 模型只问一个问题 → 回答 → 模型提交 blueprint
   - 模型问多个问题 → 验证只处理第一个
   - 模型直接提交 blueprint → 验证正常流程
3. 人工测试：完整用户流程

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 模型仍输出多个 tool_calls | 后端只消费第一个 + system prompt 强调 |
| 前端 UI 需要改造 | 设计兼容旧的事件类型 |
| MiniMax API tool calling 行为差异 | 先测试，必要时调整 |
