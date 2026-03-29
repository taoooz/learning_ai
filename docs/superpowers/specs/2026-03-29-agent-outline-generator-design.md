# Agent Outline Generator 设计文档

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** 引入 LangGraph Agent 框架，实现流式问答的课程纲要生成服务，为后续全产品 Agent 化奠定基础

**Architecture:** 独立 Python 服务 (FastAPI + LangGraph)，通过 SSE 与 Next.js 前端通信，MCP 协议接入搜索工具，支持多 Agent 协作

**Tech Stack:** Python 3.11+, FastAPI, LangGraph, MCP (Model Context Protocol), MiniMax API

---

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端 (Next.js)                          │
│  /generate/confirm/page.tsx                                      │
│  - 展示问题/确认卡片                                             │
│  - 用户选择答案                                                  │
│  - SSE 流式接收响应                                              │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP/SSE
┌─────────────────────────▼───────────────────────────────────────┐
│                    Python Agent 服务                              │
│  端口: 8000                                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ FastAPI Router                                               ││
│  │  - POST /api/agents/outline/generate                        ││
│  │  - POST /api/agents/outline/answer                          ││
│  │  - GET  /api/agents/outline/stream                          ││
│  │  - (未来) POST /api/agents/chat/message                     ││
│  │  - (未来) POST /api/agents/review/generate                  ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Agent Supervisor (未来)                                      ││
│  │  - 任务分发                                                   ││
│  │  - Agent 协作编排                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Agents                                                       ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         ││
│  │  │OutlineAgent │  │ ChatAgent   │  │ ReviewAgent │         ││
│  │  │  (当前)      │  │  (阶段2)    │  │  (阶段3)    │         ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘         ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ MCP Layer                                                    ││
│  │  - ToolRegistry (全局工具注册)                               ││
│  │  - MCP Servers (搜索、知识库等)                              ││
│  └─────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. 目录结构

```
python-agent/
├── main.py                      # FastAPI 入口，路由注册
├── requirements.txt
│
├── agents/                      # Agent 核心层
│   ├── __init__.py
│   ├── base.py                 # Agent 基类
│   ├── router.py               # Agent 请求路由
│   │
│   ├── outline/                # 课程纲要 Agent (当前)
│   │   ├── __init__.py
│   │   ├── agent.py           # OutlineAgent
│   │   ├── graph.py           # LangGraph 定义
│   │   ├── state.py           # OutlineState TypedDict
│   │   ├── nodes.py           # 节点逻辑
│   │   └── prompts.py         # Prompt 模板
│   │
│   ├── chat/                   # AI 助教 Agent (阶段2)
│   │   ├── __init__.py
│   │   ├── agent.py
│   │   ├── graph.py
│   │   └── prompts.py
│   │
│   └── review/                 # 复习规划 Agent (阶段3)
│       ├── __init__.py
│       ├── agent.py
│       ├── graph.py
│       └── prompts.py
│
├── mcp/                        # MCP 协议层
│   ├── __init__.py
│   ├── registry.py             # 工具注册中心
│   ├── server.py               # MCP Server 基类
│   ├── protocol.py             # MCP 协议实现
│   │
│   └── tools/                  # MCP 工具
│       ├── __init__.py
│       ├── base.py             # 工具基类
│       ├── search.py           # 搜索工具 (当前)
│       ├── knowledge.py        # 知识库工具 (阶段2)
│       └── user_db.py          # 用户数据库工具 (阶段2)
│
├── memory/                     # 记忆层
│   ├── __init__.py
│   ├── session.py              # Session 管理
│   └── checkpoint.py           # LangGraph Checkpoint 持久化
│
├── lib/                        # 公共库
│   ├── __init__.py
│   ├── minimax.py             # MiniMax API 封装
│   └── json_parser.py         # JSON 解析工具
│
└── schemas/                    # Pydantic 模型
    ├── __init__.py
    ├── base.py                 # 基础模型
    ├── outline.py             # Outline 相关
    └── chat.py                # Chat 相关 (阶段2)
```

---

## 3. API 接口

### 3.1 POST /api/agents/outline/generate

**描述:** 启动 outline 生成（首次调用）

**请求体:**
```json
{
  "topic": "React 状态管理",
  "userProfile": {
    "name": "张三",
    "background": "前端开发 2 年",
    "goals": ["深入理解状态管理"]
  },
  "userMemory": {
    "extractedInsights": {
      "knowledgeGaps": [],
      "conceptMastery": []
    }
  }
}
```

**响应 (SSE):**
```
event: question
data: {"id": "q1", "question": "你的 React 经验是？", "options": ["6个月以下", "6-12个月", "1-2年", "2年以上"]}

event: question
data: {"id": "q2", "question": "你使用过哪些状态管理方案？", "options": ["Redux", "Zustand", "Jotai", "Context API"]}

event: done
data: {"type": "confirmation", "blueprint": {...}}
```

### 3.2 POST /api/agents/outline/answer

**描述:** 提交问题答案，继续生成流程

**请求体:**
```json
{
  "sessionId": "uuid-xxx",
  "answer": "1-2年"
}
```

**响应 (SSE):**
同 3.1

### 3.3 GET /api/agents/outline/stream

**描述:** SSE 流式监听（用于实时显示思考过程）

**查询参数:** `sessionId`

---

## 4. Agent 基类设计 (扩展性核心)

```python
# agents/base.py
from abc import ABC, abstractmethod
from typing import Generic, TypeVar, TypedDict
from langgraph.graph import StateGraph

StateType = TypeVar("StateType", bound=TypedDict)

class BaseAgent(ABC, Generic[StateType]):
    """Agent 基类，所有 Agent 必须继承"""

    def __init__(self, name: str):
        self.name = name
        self.graph: StateGraph | None = None

    @abstractmethod
    def create_graph(self) -> StateGraph:
        """创建 Agent 的 LangGraph"""
        pass

    @abstractmethod
    def get_system_prompt(self) -> str:
        """获取 Agent 的 system prompt"""
        pass

    @abstractmethod
    def get_initial_state(self, **kwargs) -> StateType:
        """获取初始状态"""
        pass

    def invoke(self, state: StateType, **kwargs) -> StateType:
        """同步调用"""
        if not self.graph:
            raise ValueError("Graph not initialized")
        return self.graph.invoke(state, **kwargs)

    async def ainvoke(self, state: StateType, **kwargs) -> StateType:
        """异步调用"""
        if not self.graph:
            raise ValueError("Graph not initialized")
        return await self.graph.ainvoke(state, **kwargs)

    def stream(self, state: StateType, **kwargs):
        """流式调用"""
        if not self.graph:
            raise ValueError("Graph not initialized")
        return self.graph.stream(state, **kwargs)
```

### 4.1 OutlineAgent 实现

```python
# agents/outline/agent.py
from agents.base import BaseAgent
from .graph import create_outline_graph
from .state import OutlineState
from .prompts import OUTLINE_SYSTEM_PROMPT

class OutlineAgent(BaseAgent[OutlineState]):
    """课程纲要 Agent"""

    def __init__(self):
        super().__init__("outline_agent")

    def create_graph(self) -> StateGraph:
        return create_outline_graph()

    def get_system_prompt(self) -> str:
        return OUTLINE_SYSTEM_PROMPT

    def get_initial_state(self, topic: str, user_profile: dict, user_memory: dict, session_id: str) -> OutlineState:
        return OutlineState(
            session_id=session_id,
            topic=topic,
            user_profile=user_profile,
            user_memory=user_memory,
            messages=[],
            current_question=None,
            question_count=0,
            questions_asked=[],
            answers=[],
            blueprint=None,
            status="initial",
            needs_tools=False,
        )
```

---

## 5. LangGraph State 定义 (支持 Checkpoint)

```python
# agents/outline/state.py
from typing import TypedDict, Optional, Annotated
from langgraph.graph import add_messages

class OutlineState(TypedDict):
    # 核心标识
    session_id: str
    agent_type: str                   # "outline"

    # 输入
    topic: str
    user_profile: dict
    user_memory: dict

    # 对话历史 (Checkpoint 关键)
    messages: Annotated[list[dict], add_messages]

    # 业务状态
    current_question: Optional[dict]     # {id, question, options}
    question_count: int                  # 已问问题数，最多 3
    questions_asked: list[str]           # 已问问题的 ID 列表
    answers: list[str]                   # 用户回答
    blueprint: Optional[dict]            # 最终 blueprint

    # 状态机状态
    status: str                          # initial/asking/confirming/reconsidering

    # 工具调用标记
    needs_tools: bool                    # 是否需要调用工具
    tool_calls: list[dict]               # 待执行的工具调用
```

---

## 6. LangGraph 节点

### 6.1 节点定义

```python
# agents/outline/nodes.py

def initial_node(state: OutlineState) -> OutlineState:
    """初始节点：调用模型，判断是提问还是确认"""
    # 调用 MiniMax，传入完整上下文
    # 返回需要调用的工具或最终结果
    pass

def ask_question_node(state: OutlineState) -> OutlineState:
    """提问节点：从模型输出提取问题"""
    last_msg = state.messages[-1]
    question = extract_question(last_msg)
    return {
        **state,
        "current_question": question,
        "question_count": state.question_count + 1,
        "questions_asked": state.questions_asked + [question["id"]],
        "status": "asking",
    }

def receive_answer_node(state: OutlineState) -> OutlineState:
    """接收答案节点：存储答案，继续循环"""
    last_msg = state.messages[-1]
    answer = extract_answer(last_msg)
    return {
        **state,
        "answers": state.answers + [answer],
        "current_question": None,
        "status": "initial",
    }

def confirm_node(state: OutlineState) -> OutlineState:
    """确认节点：生成最终 blueprint"""
    last_msg = state.messages[-1]
    blueprint = extract_blueprint(last_msg)
    return {
        **state,
        "blueprint": blueprint,
        "status": "confirming",
    }

def reconsider_node(state: OutlineState) -> OutlineState:
    """重新思考节点"""
    return {
        **state,
        "status": "reconsidering",
    }

def tool_calling_node(state: OutlineState) -> OutlineState:
    """工具调用节点：执行 MCP 工具"""
    # 执行搜索等工具
    # 将结果添加到 messages
    pass

def should_continue(state: OutlineState) -> str:
    """边路由：判断下一步"""
    if state.status == "reconsidering":
        return "reconsider"
    if state.current_question is not None:
        return "ask_question"
    if state.blueprint is not None:
        return "confirm"
    if state.needs_tools:
        return "tool_calling"
    return "initial"
```

### 6.2 边路由

```python
# agents/outline/graph.py
from langgraph.graph import StateGraph, END

def create_outline_graph():
    builder = StateGraph(OutlineState)

    # 添加节点
    builder.add_node("initial", initial_node)
    builder.add_node("ask_question", ask_question_node)
    builder.add_node("receive_answer", receive_answer_node)
    builder.add_node("confirm", confirm_node)
    builder.add_node("reconsider", reconsider_node)
    builder.add_node("tool_calling", tool_calling_node)

    # 设置边
    builder.set_entry_point("initial")

    # 条件边
    builder.add_conditional_edges(
        "initial",
        should_continue,
        {
            "ask_question": "ask_question",
            "confirm": "confirm",
            "tool_calling": "tool_calling",
            "reconsider": "reconsider",
        }
    )

    builder.add_edge("ask_question", END)           # 等待用户回答
    builder.add_edge("receive_answer", "initial")    # 回到初始
    builder.add_edge("tool_calling", "initial")     # 工具执行完继续
    builder.add_edge("confirm", END)
    builder.add_edge("reconsider", END)

    return builder.compile()
```

---

## 7. MCP 工具注册中心

```python
# mcp/registry.py
from typing import Protocol
from .tools.base import MCPTool

class ToolRegistry:
    """全局工具注册中心，支持多 Agent 共享工具"""
    _tools: dict[str, MCPTool] = {}
    _agent_tools: dict[str, list[str]] = {}  # agent_name -> tool_names

    @classmethod
    def register(cls, name: str, tool: MCPTool, agents: list[str] | None = None):
        """注册工具，可指定可用的 Agent 列表"""
        cls._tools[name] = tool
        if agents:
            for agent in agents:
                if agent not in cls._agent_tools:
                    cls._agent_tools[agent] = []
                cls._agent_tools[agent].append(name)

    @classmethod
    def get(cls, name: str) -> MCPTool:
        return cls._tools.get(name)

    @classmethod
    def get_for_agent(cls, agent_name: str) -> list[MCPTool]:
        """获取指定 Agent 可用的工具"""
        tool_names = cls._agent_tools.get(agent_name, [])
        return [cls._tools[name] for name in tool_names if name in cls._tools]

    @classmethod
    def list_all(cls) -> list[dict]:
        return [{"name": n, **t.get_schema()} for n, t in cls._tools.items()]

    @classmethod
    def execute_tool(cls, name: str, parameters: dict) -> dict:
        """执行工具"""
        tool = cls._tools.get(name)
        if not tool:
            raise ValueError(f"Tool {name} not found")
        return tool.execute(parameters)
```

### 7.1 工具基类

```python
# mcp/tools/base.py
from abc import ABC, abstractmethod
from typing import Any

class MCPTool(ABC):
    """MCP 工具基类"""

    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description

    @abstractmethod
    def get_schema(self) -> dict:
        """返回工具的 JSON Schema"""
        pass

    @abstractmethod
    async def execute(self, parameters: dict) -> Any:
        """执行工具"""
        pass

    def to_langchain_tool(self):
        """转换为 LangChain Tool"""
        from langchain_core.tools import tool
        @tool
        def _tool(**kwargs):
            return self.execute(kwargs)
        _tool.name = self.name
        _tool.description = self.description
        return _tool
```

### 7.2 搜索工具实现

```python
# mcp/tools/search.py
import httpx
from .base import MCPTool

class SearchWebTool(MCPTool):
    """网页搜索工具"""

    def __init__(self):
        super().__init__(
            name="search_web",
            description="搜索互联网获取最新信息"
        )

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索查询"
                    }
                },
                "required": ["query"]
            }
        }

    async def execute(self, parameters: dict) -> dict:
        query = parameters.get("query")
        # 实现搜索逻辑
        # 可选: Serper API / DuckDuckGo / Google Search API
        results = await self._search(query)
        return {
            "query": query,
            "results": results,
            "summary": self._summarize(results)
        }

    async def _search(self, query: str) -> list[dict]:
        # TODO: 实现搜索
        pass
```

---

## 8. Session 管理

```python
# memory/session.py
from typing import Optional
import time

class SessionStore:
    """内存 Session 存储（未来可扩展为 Redis）"""

    def __init__(self):
        self._sessions: dict[str, dict] = {}

    def create(self, session_id: str, initial_state: dict) -> dict:
        self._sessions[session_id] = {
            "state": initial_state,
            "created_at": int(time.time()),
            "updated_at": int(time.time()),
        }
        return self._sessions[session_id]

    def get(self, session_id: str) -> Optional[dict]:
        return self._sessions.get(session_id)

    def update(self, session_id: str, state: dict) -> None:
        if session_id in self._sessions:
            self._sessions[session_id]["state"] = state
            self._sessions[session_id]["updated_at"] = int(time.time())

    def delete(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def cleanup_old(self, max_age_seconds: int = 3600) -> None:
        """清理超过 max_age 的 session"""
        now = int(time.time())
        expired = [
            sid for sid, s in self._sessions.items()
            if now - s["updated_at"] > max_age_seconds
        ]
        for sid in expired:
            del self._sessions[sid]
```

---

## 9. Checkpoint 持久化 (LangGraph)

```python
# memory/checkpoint.py
from langgraph.checkpoint import CheckpointSaver, MemorySaver

class AgentCheckpoint(MemorySaver):
    """Agent 状态检查点，支持断点恢复"""

    def __init__(self):
        super().__init__()

    def save(self, config: dict, state: dict) -> None:
        """保存检查点"""
        thread_id = config.get("configurable", {}).get("thread_id")
        if thread_id:
            super().save(config, state)

    async def aget(self, config: dict) -> dict | None:
        """获取检查点"""
        return super().aget(config)
```

---

## 10. API 路由

```python
# main.py
from fastapi import APIRouter, HTTPException
from .agents.router import agent_router
from .schemas.outline import OutlineRequest, OutlineAnswerRequest

app = FastAPI()

# 注册 Agent 路由
app.include_router(agent_router, prefix="/api/agents")

# SSE 流式端点
@app.get("/api/agents/outline/stream")
async def outline_stream(sessionId: str):
    # 返回 SSE 流
    pass

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return {"error": str(exc)}, 500
```

### 10.1 Agent 路由

```python
# agents/router.py
from fastapi import APIRouter

agent_router = APIRouter()

@agent_router.post("/outline/generate")
async def generate_outline(req: OutlineRequest):
    # 启动 OutlineAgent
    pass

@agent_router.post("/outline/answer")
async def answer_question(req: OutlineAnswerRequest):
    # 继续 OutlineAgent
    pass
```

---

## 11. 数据模型

### 11.1 OutlineBlueprint

```python
# schemas/outline.py
from pydantic import BaseModel, Field
from typing import Literal

class LearnerPositioning(BaseModel):
    estimatedLevel: Literal["novice", "beginner", "intermediate", "advanced"]
    difficultySummary: str
    backgroundSummary: str
    skipBasics: list[str]
    whyThisCourseFits: str

class OutlineBlueprint(BaseModel):
    learningDirection: str
    learningGoal: str
    learnerPositioning: LearnerPositioning

class ClarificationQuestion(BaseModel):
    id: str
    question: str
    options: list[str]

class OutlineResponse(BaseModel):
    type: Literal["confirmation", "questions", "reconsider"]
    blueprint: OutlineBlueprint | None = None
    questions: list[ClarificationQuestion] | None = None
    message: str | None = None
```

---

## 12. 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| MiniMax API 超时 | 重试 3 次，失败返回 error |
| MCP 工具调用失败 | 降级，跳过工具继续执行 |
| Session 不存在 | 返回 404 |
| 流式连接断开 | 清理 session 状态 |
| Agent 未初始化 | 返回 500 |
| 状态流转异常 | 回到初始状态，记录日志 |

---

## 13. 与现有系统集成

### 13.1 Next.js 端改动

```
阶段 1: Next.js 代理到 Python 服务
  - 现有 /api/generate/outline → 代理到 localhost:8000/api/agents/outline/generate

阶段 2: 前端直接调用 Python 服务
  - 使用 EventSource 接收 SSE
  - 前端适配新的 API 格式

阶段 3: 移除 Next.js outline API
```

### 13.2 渐进迁移

```
当前: Next.js API Routes 直接调用 MiniMax
  ↓
阶段1: Python Agent 服务独立运行
  - FastAPI 端口 8000
  - Next.js 通过 HTTP 代理调用
  - 新功能用 Agent，旧功能保持
  ↓
阶段2: 接入 MCP 工具
  - 搜索工具上线
  - Agent 调用工具增强
  ↓
阶段3: 扩展多 Agent
  - Chat Agent 上线
  - Review Agent 上线
  - Supervisor 协调
```

---

## 14. 后续扩展路线

### 14.1 阶段 2: AI 助教答疑

```
ChatAgent:
- 输入: 用户问题 + 课程上下文
- 输出: 回答 (SSE 流式)
- 工具: 课程知识库搜索
- 状态: 对话历史持久化
```

### 14.2 阶段 3: 个性化复习规划

```
ReviewAgent:
- 输入: 用户学习数据
- 输出: 复习计划
- 工具: 用户数据库、课程进度
```

### 14.3 阶段 4: Supervisor Agent

```
SupervisorAgent:
- 意图识别: 用户想要什么
- 任务分发: 路由到合适的 Agent
- 结果整合: 汇总多 Agent 输出
```
