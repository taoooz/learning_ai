# Outline Agent Tool Calling 改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过 Tool Calling 机制改造 outline agent，强制模型通过 `ask_question` 和 `submit_blueprint` tool 与用户交互，解决多个问题被合并丢弃的问题。

**Architecture:**
- Python Agent: 新增 `ask_question` 和 `submit_blueprint` 两个 tool，修改 `outline_agent.py` 处理新的 tool call 流程
- 前端 Next.js: 新增 `question` 事件类型，处理逐个问题显示

**Tech Stack:** Python (FastAPI), MiniMax API, Next.js, TypeScript, SSE

---

## 文件结构

```
.worktrees/agent-feature/python-agent/
├── lib/tools/search_tools.py      # 新增 ask_question, submit_blueprint tools
├── services/outline_agent.py      # 修改 tool call 处理逻辑
├── services/outline_service.py    # 修改 system prompt
├── schemas/outline.py             # Blueprint schema 兼容

app/                               # Next.js 前端
├── contexts/CourseContext.tsx     # 处理新的 question 事件
└── types/course.ts               # 更新 OutlineSSEEvent 类型
```

---

## Task 1: 更新 Blueprint Schema 兼容 snake_case

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/schemas/outline.py`

- [ ] **Step 1: 添加 BlueprintSubmission Schema（用于 tool 参数）**

```python
# schemas/outline.py 新增

class BlueprintSubmission(BaseModel):
    """submit_blueprint tool 的参数结构"""
    learning_direction: str = Field(description="学习方向/课程标题，15-30字")
    keypoint: str = Field(description="核心知识点，15-30字")
    goal: str = Field(description="学习目标，20-40字")
    estimated_level: Literal["beginner", "intermediate", "advanced"]
    background_summary: Optional[str] = Field(default="", description="用户背景摘要")
    skip_basics: list[str] = Field(default_factory=list, description="可跳过的基础知识")

    def to_outline_blueprint(self) -> OutlineBlueprint:
        """转换为内部使用的 OutlineBlueprint"""
        return OutlineBlueprint(
            learningDirection=self.learning_direction,
            learningGoal=self.goal,
            learnerPositioning=LearnerPositioning(
                estimatedLevel=self.estimated_level,
                difficultySummary="",
                backgroundSummary=self.background_summary,
                skipBasics=self.skip_basics,
                whyThisCourseFits="",
            ),
        )
```

- [ ] **Step 2: Run test to verify schema works**

Run: `cd .worktrees/agent-feature/python-agent && python -c "from schemas.outline import BlueprintSubmission; bp = BlueprintSubmission(learning_direction='test', keypoint='k', goal='g', estimated_level='beginner'); print('Schema OK')"`

Expected: `Schema OK`

- [ ] **Step 3: Commit**

```bash
cd .worktrees/agent-feature/python-agent
git add schemas/outline.py
git commit -m "feat: add BlueprintSubmission schema for tool parameters"
```

---

## Task 2: 新增 ask_question 和 submit_blueprint tools

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/lib/tools/search_tools.py`

- [ ] **Step 1: 添加 tool 定义**

```python
# lib/tools/search_tools.py 新增

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

- [ ] **Step 2: 添加 tool 执行函数**

```python
def ask_question(question: str) -> str:
    """ask_question tool 执行函数

    结果通过 SSE 事件发送，此处返回空字符串
    """
    return ""

def submit_blueprint(
    learning_direction: str,
    keypoint: str,
    goal: str,
    estimated_level: str,
    background_summary: str = "",
    skip_basics: list[str] = None,
) -> str:
    """submit_blueprint tool 执行函数

    结果通过 SSE 事件发送，此处返回空字符串
    """
    if skip_basics is None:
        skip_basics = []
    return ""
```

- [ ] **Step 3: 更新 TOOL_FUNCTIONS 映射**

```python
TOOL_FUNCTIONS = {
    "search_info": search_info,
    "read_url": read_url,
    "ask_question": ask_question,
    "submit_blueprint": submit_blueprint,
}
```

- [ ] **Step 4: 验证语法**

Run: `cd .worktrees/agent-feature/python-agent && python -c "from lib.tools.search_tools import ASK_QUESTION_TOOL, SUBMIT_BLUEPRINT_TOOL, TOOL_FUNCTIONS; print('Tools loaded:', list(TOOL_FUNCTIONS.keys()))"`

Expected: `Tools loaded: ['search_info', 'read_url', 'ask_question', 'submit_blueprint']`

- [ ] **Step 5: Commit**

```bash
cd .worktrees/agent-feature/python-agent
git add lib/tools/search_tools.py
git commit -m "feat: add ask_question and submit_blueprint tools"
```

---

## Task 3: 修改 outline_service.py 更新 system prompt

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/services/outline_service.py`

- [ ] **Step 1: 查看现有 system prompt 结构**

```bash
grep -n "build_initial_prompt" .worktrees/agent-feature/python-agent/services/outline_service.py | head -5
```

- [ ] **Step 2: 找到并更新 system prompt 中的工具使用说明部分**

在 `build_initial_prompt()` 的返回字符串中，找到或添加：

```
## 工具使用规则
1. 每次 reply 只使用一个 tool
2. 如果需要了解用户信息，调用 ask_question 提问
3. 信息足够时，调用 submit_blueprint 提交完整大纲
4. 不要同时调用多个 tool
```

- [ ] **Step 3: 验证更新后的 prompt 包含新规则**

```bash
cd .worktrees/agent-feature/python-agent && python -c "from services.outline_service import build_initial_prompt; prompt = build_initial_prompt('test', {}, {}); assert 'ask_question' in prompt, 'Missing ask_question'; assert 'submit_blueprint' in prompt, 'Missing submit_blueprint'; print('Prompt OK')"
```

- [ ] **Step 4: Commit**

```bash
cd .worktrees/agent-feature/python-agent
git add services/outline_service.py
git commit -m "feat: update system prompt with tool usage rules"
```

---

## Task 4: 修改 outline_agent.py 处理新的 tool call 流程

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/services/outline_agent.py`

- [ ] **Step 1: 更新导入**

```python
from lib.tools.search_tools import SEARCH_TOOLS, ASK_QUESTION_TOOL, SUBMIT_BLUEPRINT_TOOL, TOOL_FUNCTIONS
from schemas.outline import BlueprintSubmission
```

- [ ] **Step 2: 修改 tools 列表**

在 `stream_outline_with_tools()` 中，修改：

```python
ALL_TOOLS = SEARCH_TOOLS + [ASK_QUESTION_TOOL, SUBMIT_BLUEPRINT_TOOL]
```

替换原来的 `SEARCH_TOOLS`。

- [ ] **Step 3: 新增 _handle_single_tool_call 函数**

```python
def _handle_single_tool_call(tool_call: dict, session_id: str) -> list[dict]:
    """处理单个 tool call，只消费第一个

    Args:
        tool_call: tool_call dict，含 function.name 和 function.arguments
        session_id: 当前 session id

    Returns:
        要 yield 的事件列表
    """
    events = []
    func_name = tool_call["function"]["name"]
    func_args = json.loads(tool_call["function"]["arguments"])

    if func_name == "ask_question":
        question = func_args.get("question", "")
        events.append({"type": "question", "question": question})

    elif func_name == "submit_blueprint":
        # 转换为内部 Blueprint 结构
        submission = BlueprintSubmission(**func_args)
        blueprint = submission.to_outline_blueprint()
        events.append({"type": "confirmation", "blueprint": blueprint, "sessionId": session_id})

    elif func_name == "search_info":
        query = func_args.get("query", "")
        events.append({"type": "thinking", "message": f"正在搜索：{query}"})

    elif func_name == "read_url":
        url = func_args.get("url", "")
        events.append({"type": "thinking", "message": f"正在读取：{url}"})

    return events
```

- [ ] **Step 4: 修改 stream_outline_with_tools 中的工具处理**

在循环中，找到工具调用处理部分，修改为只处理第一个 tool_call：

```python
# 在 yield {"type": "tool_call", ...} 之后

# 只消费第一个 tool_call
first_tool_call = sorted_tcs[0]  # tool_calls 已按 index 排序
for ev in _handle_single_tool_call(first_tool_call, session_id):
    yield ev

# 如果有额外的 tool_call，只记录但不处理（避免多次调用）
if len(sorted_tcs) > 1:
    print(f"[Outline Agent] Warning: multiple tool_calls received, only processing first: {[tc['function']['name'] for tc in sorted_tcs]}")
```

- [ ] **Step 5: 同样修改 stream_answer_with_tools**

复制相同的修改到 `stream_answer_with_tools()` 函数中。

- [ ] **Step 6: 测试 import**

```bash
cd .worktrees/agent-feature/python-agent && python -c "from services.outline_agent import stream_outline_with_tools, stream_answer_with_tools; print('Import OK')"
```

- [ ] **Step 7: Commit**

```bash
cd .worktrees/agent-feature/python-agent
git add services/outline_agent.py
git commit -m "feat: implement tool-based outline generation with ask_question and submit_blueprint"
```

---

## Task 5: 更新前端 OutlineSSEEvent 类型

**Files:**
- Modify: `types/course.ts`

- [ ] **Step 1: 更新 OutlineSSEEvent 类型**

找到 `OutlineSSEEvent` 类型定义（约第 468 行），添加 `question` 事件类型：

```typescript
export type OutlineSSEEvent =
  | { type: 'thinking'; message: string }
  | { type: 'content_delta'; content: string }
  | { type: 'question'; question: string }  // 新增：逐个问题
  | { type: 'question_start'; questionNumber: number }
  | { type: 'questions'; questions: ClarificationQuestion[]; sessionId: string }
  | { type: 'blueprint_start' }
  | { type: 'blueprint_field'; field: string; value: any }
  | { type: 'confirmation'; blueprint: OutlineBlueprint; sessionId: string }
  | { type: 'session_created'; sessionId: string }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: 添加 BlueprintSubmission 类型（用于接收 snake_case 的 blueprint）**

```typescript
export interface BlueprintSubmission {
  learning_direction: string;
  keypoint: string;
  goal: string;
  estimated_level: 'beginner' | 'intermediate' | 'advanced';
  background_summary: string;
  skip_basics: string[];
}
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd /Users/admin/Documents/OpenCode/Learning\ AI && npx tsc --noEmit types/course.ts 2>&1 | head -20`

Expected: 无错误（或只有已有的无关错误）

- [ ] **Step 4: Commit**

```bash
cd /Users/admin/Documents/OpenCode/Learning\ AI
git add types/course.ts
git commit -m "feat: add question event type and BlueprintSubmission interface"
```

---

## Task 6: 更新前端处理新的 question 事件

**Files:**
- Modify: `contexts/CourseContext.tsx`

- [ ] **Step 1: 找到 SSE 事件处理逻辑**

搜索 `submitOutlineMessage` 函数，查看如何处理 SSE 事件。

- [ ] **Step 2: 添加 question 事件处理**

在 SSE 事件处理 switch 语句中，添加：

```typescript
case 'question':
  // 新事件类型：逐个问题
  onQuestion?.(event.question);
  break;
```

- [ ] **Step 3: 确保 ask_question tool 不返回 content**

由于 `ask_question` 执行函数返回空字符串，后端会 yield thinking 事件，前端会显示"正在搜索"类似的提示。需要确认这种行为是否符合预期。

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit contexts/CourseContext.tsx 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add contexts/CourseContext.tsx
git commit -m "feat: handle new question event in outline SSE processing"
```

---

## Task 7: 集成测试

**Files:**
- 测试文件: `.worktrees/agent-feature/python-agent/tests/test_outline_agent.py`（如不存在则创建）

- [ ] **Step 1: 编写 tool call 处理测试**

```python
def test_handle_single_tool_call_ask_question():
    """测试只处理第一个 ask_question tool call"""
    from services.outline_agent import _handle_single_tool_call

    tool_call = {
        "function": {
            "name": "ask_question",
            "arguments": json.dumps({"question": "你的学习目标是？"})
        }
    }
    events = list(_handle_single_tool_call(tool_call, "test-session"))
    assert len(events) == 1
    assert events[0]["type"] == "question"
    assert events[0]["question"] == "你的学习目标是？"


def test_handle_single_tool_call_submit_blueprint():
    """测试 submit_blueprint tool call"""
    from services.outline_agent import _handle_single_tool_call

    tool_call = {
        "function": {
            "name": "submit_blueprint",
            "arguments": json.dumps({
                "learning_direction": "AI Agent 开发",
                "keypoint": "掌握 Agent 核心概念",
                "goal": "能够独立开发 Agent 应用",
                "estimated_level": "beginner",
                "background_summary": "有 Python 基础",
                "skip_basics": []
            })
        }
    }
    events = list(_handle_single_tool_call(tool_call, "test-session"))
    assert len(events) == 1
    assert events[0]["type"] == "confirmation"
    assert events[0]["blueprint"]["learningDirection"] == "AI Agent 开发"
```

- [ ] **Step 2: 运行测试**

```bash
cd .worktrees/agent-feature/python-agent && python -m pytest tests/test_outline_agent.py -v
```

- [ ] **Step 3: Commit**

```bash
cd .worktrees/agent-feature/python-agent
git add tests/test_outline_agent.py
git commit -m "test: add tool call handling tests"
```

---

## 风险与验证

| 风险 | 验证方式 |
|------|---------|
| 模型不遵守"每次一个 tool" | 集成测试验证只处理第一个 |
| MiniMax API tool_calls 行为差异 | 本地测试 tool call 流程 |
| 前端兼容性问题 | TypeScript 编译验证 |

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-04-12-outline-tool-calling-implementation.md`**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
