# Agent Outline Generator 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建独立 Python Agent 服务，实现流式问答的课程纲要生成

**Architecture:** FastAPI + LangGraph + MCP，Python 服务独立运行，通过 SSE 与 Next.js 前端通信

**Tech Stack:** Python 3.11+, FastAPI, LangGraph, MCP, MiniMax API

---

## 项目初始化

### Task 1: 创建 Python Agent 项目结构

**Files:**
- Create: `python-agent/requirements.txt`
- Create: `python-agent/.env.example`
- Create: `python-agent/README.md`

- [ ] **Step 1: 创建 requirements.txt**

```
fastapi>=0.115.0
uvicorn>=0.30.0
langgraph>=0.2.0
langchain-core>=0.3.0
pydantic>=2.0.0
httpx>=0.27.0
python-dotenv>=1.0.0
sse-starlette>=2.0.0
```

- [ ] **Step 2: 创建 .env.example**

```
MINIMAX_API_KEY=your_api_key_here
MINIMAX_API_BASE=https://api.minimaxi.com/v1
SEARCH_API_KEY=your_search_api_key  # 可选: Serper API
```

- [ ] **Step 3: 创建 README.md**

```markdown
# Python Agent 服务

## 快速开始

```bash
cd python-agent
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 添加 API Key
uvicorn main:app --reload --port 8000
```

## API 文档

- http://localhost:8000/docs - Swagger UI
- http://localhost:8000/redoc - ReDoc
```

- [ ] **Step 4: Commit**

```bash
git add python-agent/
git commit -m "feat(agent): 初始化 Python Agent 项目结构
- 添加 requirements.txt
- 添加 .env.example
- 添加 README.md

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 创建 MCP 工具基类和注册中心

**Files:**
- Create: `python-agent/mcp/__init__.py`
- Create: `python-agent/mcp/tools/__init__.py`
- Create: `python-agent/mcp/tools/base.py`
- Create: `python-agent/mcp/registry.py`

- [ ] **Step 1: 创建 mcp/tools/base.py**

```python
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
```

- [ ] **Step 2: 创建 mcp/tools/__init__.py**

```python
from .base import MCPTool

__all__ = ["MCPTool"]
```

- [ ] **Step 3: 创建 mcp/registry.py**

```python
from typing import Optional
from .tools.base import MCPTool


class ToolRegistry:
    """全局工具注册中心，支持多 Agent 共享工具"""

    _tools: dict[str, MCPTool] = {}
    _agent_tools: dict[str, list[str]] = {}

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
    def get(cls, name: str) -> Optional[MCPTool]:
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
    async def execute_tool(cls, name: str, parameters: dict) -> dict:
        """执行工具"""
        tool = cls._tools.get(name)
        if not tool:
            raise ValueError(f"Tool {name} not found")
        return await tool.execute(parameters)
```

- [ ] **Step 4: 创建 mcp/__init__.py**

```python
from .registry import ToolRegistry
from .tools.base import MCPTool

__all__ = ["ToolRegistry", "MCPTool"]
```

- [ ] **Step 5: Commit**

```bash
git add python-agent/mcp/
git commit -m "feat(agent): 添加 MCP 工具基类和注册中心
- MCPTool 抽象基类
- ToolRegistry 全局工具注册
- 支持按 Agent 分配工具

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 创建搜索工具实现

**Files:**
- Create: `python-agent/mcp/tools/search.py`

- [ ] **Step 1: 创建 mcp/tools/search.py**

```python
import httpx
from typing import Any
from .base import MCPTool


class SearchWebTool(MCPTool):
    """网页搜索工具（使用 DuckDuckGo 搜索）"""

    def __init__(self):
        super().__init__(
            name="search_web",
            description="搜索互联网获取最新信息"
        )
        self._base_url = "https://api.duckduckgo.com/"

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
        query = parameters.get("query", "")
        results = await self._search(query)
        return {
            "query": query,
            "results": results,
            "summary": self._summarize(results)
        }

    async def _search(self, query: str) -> list[dict]:
        """执行搜索"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    self._base_url,
                    params={
                        "q": query,
                        "format": "json",
                        "no_redirect": 1,
                        "no_html": 1,
                    },
                    timeout=10.0,
                )
                response.raise_for_status()
                data = response.json()

                results = []
                for topic in data.get("RelatedTopics", [])[:5]:
                    if "Text" in topic:
                        results.append({
                            "title": topic.get("Text", "")[:100],
                            "url": topic.get("URL", ""),
                        })
                return results
        except Exception as e:
            return [{"error": str(e)}]

    def _summarize(self, results: list[dict]) -> str:
        """生成搜索结果摘要"""
        if not results:
            return "未找到相关结果"
        return " | ".join([r.get("title", "")[:50] for r in results[:3]])
```

- [ ] **Step 2: 注册工具到全局注册中心（创建后立即使用）**

在 `mcp/__init__.py` 中添加自动注册：

```python
from .registry import ToolRegistry
from .tools.base import MCPTool
from .tools.search import SearchWebTool

# 自动注册默认工具
_search_tool = SearchWebTool()
ToolRegistry.register("search_web", _search_tool, agents=["outline_agent"])

__all__ = ["ToolRegistry", "MCPTool"]
```

- [ ] **Step 3: Commit**

```bash
git add python-agent/mcp/
git commit -m "feat(agent): 添加搜索工具实现
- SearchWebTool 使用 DuckDuckGo API
- 自动注册到 ToolRegistry

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 创建 MiniMax API 封装

**Files:**
- Create: `python-agent/lib/__init__.py`
- Create: `python-agent/lib/minimax.py`

- [ ] **Step 1: 创建 lib/__init__.py**

```python
from .minimax import MiniMaxClient, parse_json_response

__all__ = ["MiniMaxClient", "parse_json_response"]
```

- [ ] **Step 2: 创建 lib/minimax.py**

```python
import os
import json
import httpx
from typing import AsyncIterator


class MiniMaxClient:
    """MiniMax API 客户端"""

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or os.getenv("MINIMAX_API_KEY", "")
        self.base_url = base_url or os.getenv("MINIMAX_API_BASE", "https://api.minimaxi.com/v1")

    def _get_headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def chat(
        self,
        messages: list[dict],
        model: str = "MiniMax-M2.7",
        max_tokens: int = 1500,
    ) -> dict:
        """同步调用 chat API"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=self._get_headers(),
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": max_tokens,
                },
                timeout=60.0,
            )
            response.raise_for_status()
            return response.json()

    async def stream_chat(
        self,
        messages: list[dict],
        model: str = "MiniMax-M2.7",
        max_tokens: int = 1500,
    ) -> AsyncIterator[dict]:
        """流式调用 chat API"""
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=self._get_headers(),
                json={
                    "model": model,
                    "messages": messages,
                    "stream": True,
                    "max_tokens": max_tokens,
                },
                timeout=60.0,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        yield json.loads(data)


def parse_json_response(content: str) -> dict:
    """解析 JSON 响应，处理 markdown 代码块"""
    content = content.strip()

    # 移除 markdown 代码块
    if content.startswith("```json"):
        content = content[7:]
    if content.startswith("```"):
        content = content[3:]

    # 找到第一个 {
    first_brace = content.find("{")
    if first_brace == -1:
        raise ValueError(f"No JSON found in response: {content[:200]}")

    # 尝试解析
    json_str = content[first_brace:]

    # 处理不完整的 JSON（找最后一个 }）
    last_brace = json_str.rfind("}")
    if last_brace != -1:
        json_str = json_str[:last_brace + 1]

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}, content: {json_str[:200]}")
```

- [ ] **Step 3: Commit**

```bash
git add python-agent/lib/
git commit -m "feat(agent): 添加 MiniMax API 客户端
- MiniMaxClient 同步/流式调用
- parse_json_response JSON 解析工具

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 创建 Session 管理和状态定义

**Files:**
- Create: `python-agent/memory/__init__.py`
- Create: `python-agent/memory/session.py`

- [ ] **Step 1: 创建 memory/__init__.py**

```python
from .session import SessionStore, Session

__all__ = ["SessionStore", "Session"]
```

- [ ] **Step 2: 创建 memory/session.py`

```python
import time
import uuid
from typing import Optional, Any
from dataclasses import dataclass, field


@dataclass
class Session:
    """Session 数据结构"""
    session_id: str
    agent_type: str
    state: dict
    created_at: int = field(default_factory=lambda: int(time.time()))
    updated_at: int = field(default_factory=lambda: int(time.time()))


class SessionStore:
    """内存 Session 存储"""

    def __init__(self):
        self._sessions: dict[str, Session] = {}

    def create(self, agent_type: str, initial_state: dict) -> Session:
        """创建新 Session"""
        session_id = str(uuid.uuid4())
        session = Session(
            session_id=session_id,
            agent_type=agent_type,
            state=initial_state,
        )
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> Optional[Session]:
        """获取 Session"""
        return self._sessions.get(session_id)

    def update(self, session_id: str, state: dict) -> None:
        """更新 Session 状态"""
        if session_id in self._sessions:
            self._sessions[session_id].state = state
            self._sessions[session_id].updated_at = int(time.time())

    def delete(self, session_id: str) -> None:
        """删除 Session"""
        self._sessions.pop(session_id, None)

    def cleanup_old(self, max_age_seconds: int = 3600) -> int:
        """清理过期 Session，返回清理数量"""
        now = int(time.time())
        expired = [
            sid for sid, s in self._sessions.items()
            if now - s.updated_at > max_age_seconds
        ]
        for sid in expired:
            del self._sessions[sid]
        return len(expired)


# 全局 Session Store 实例
_global_store: Optional[SessionStore] = None


def get_session_store() -> SessionStore:
    """获取全局 Session Store"""
    global _global_store
    if _global_store is None:
        _global_store = SessionStore()
    return _global_store
```

- [ ] **Step 3: Commit**

```bash
git add python-agent/memory/
git commit -m "feat(agent): 添加 Session 管理
- Session 数据结构
- SessionStore 内存存储
- get_session_store 全局单例

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 创建 OutlineAgent State 和 Prompts

**Files:**
- Create: `python-agent/agents/__init__.py`
- Create: `python-agent/agents/outline/__init__.py`
- Create: `python-agent/agents/outline/state.py`
- Create: `python-agent/agents/outline/prompts.py`

- [ ] **Step 1: 创建 agents/__init__.py**

```python
from .base import BaseAgent

__all__ = ["BaseAgent"]
```

- [ ] **Step 2: 创建 agents/outline/state.py**

```python
from typing import TypedDict, Optional, Annotated
from langgraph.graph import add_messages


class OutlineState(TypedDict):
    """Outline Agent 状态"""

    # 核心标识
    session_id: str
    agent_type: str  # "outline"

    # 输入
    topic: str
    user_profile: dict
    user_memory: dict

    # 对话历史
    messages: Annotated[list[dict], add_messages]

    # 业务状态
    current_question: Optional[dict]  # {"id": "q1", "question": "...", "options": [...]}
    question_count: int  # 已问问题数，最多 3
    questions_asked: list[str]  # 已问问题的 ID 列表
    answers: list[str]  # 用户回答
    blueprint: Optional[dict]  # 最终 blueprint

    # 状态机状态
    status: str  # initial/asking/confirming/reconsidering

    # 工具调用标记
    needs_tools: bool
    tool_results: list[dict]
```

- [ ] **Step 3: 创建 agents/outline/prompts.py**

```python
OUTLINE_SYSTEM_PROMPT = """你是 AI 导师，请基于用户背景生成课程纲要。

## 决策规则
- 信息足够 → 直接生成确认
- 有不确定且影响课程质量的信息 → 生成选择题（最多3道，必须是选择题）
- 用户发消息要求重新思考 → type: "reconsider"

## 输出格式

### 确认时
{
  "type": "confirmation",
  "blueprint": {
    "learningDirection": "学习方向描述（一句话）",
    "learningGoal": "学习目标描述",
    "learnerPositioning": {
      "estimatedLevel": "novice|beginner|intermediate|advanced",
      "difficultySummary": "难度描述",
      "backgroundSummary": "背景总结",
      "skipBasics": ["已跳过1", "已跳过2"],
      "whyThisCourseFits": "为什么适合"
    }
  }
}

### 提问时
{
  "type": "questions",
  "questions": [
    {"id": "q1", "question": "问题1", "options": ["A", "B", "C", "D"]}
  ]
}

### 重新思考时
{
  "type": "reconsider",
  "message": "重新思考的原因或说明"
}

只返回 JSON，不要其他内容。"""

OUTLINE_INITIAL_PROMPT = """## 用户信息
{user_profile}

## 记忆信息
{memory_info}

## 用户补充
{user_message}

## 主题
{topic}

请根据以上信息，判断是否需要向用户提问以获取更多信息。
如果需要提问，只问最关键的 1 个问题（选择题）。
如果信息足够，直接生成课程纲要。

只返回 JSON。"""

OUTLINE_CONTINUE_PROMPT = """## 用户之前的问题和回答
{previous_qa}

## 主题
{topic}

基于用户的回答，判断：
1. 是否还需要问更多问题？（最多再问1个）
2. 还是信息已经足够，可以生成课程纲要？

只返回 JSON。"""
```

- [ ] **Step 4: 创建 agents/outline/__init__.py**

```python
from .state import OutlineState
from .prompts import OUTLINE_SYSTEM_PROMPT

__all__ = ["OutlineState", "OUTLINE_SYSTEM_PROMPT"]
```

- [ ] **Step 5: Commit**

```bash
git add python-agent/agents/
git commit -m "feat(agent): 添加 OutlineAgent State 和 Prompts
- OutlineState TypedDict 定义
- OUTLINE_SYSTEM_PROMPT 模板
- 状态和消息历史支持 Checkpoint

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 创建 LangGraph 节点和边

**Files:**
- Create: `python-agent/agents/outline/nodes.py`
- Create: `python-agent/agents/outline/graph.py`

- [ ] **Step 1: 创建 agents/outline/nodes.py**

```python
import json
from typing import Literal
from ..outline.state import OutlineState
from ...lib.minimax import MiniMaxClient, parse_json_response


# 全局 MiniMax 客户端
_minimax_client: MiniMaxClient | None = None


def get_minimax_client() -> MiniMaxClient:
    global _minimax_client
    if _minimax_client is None:
        _minimax_client = MiniMaxClient()
    return _minimax_client


def extract_json_from_response(response: dict) -> dict:
    """从 MiniMax 响应中提取 JSON"""
    content = response.get("choices", [{}])[0].get("message", {}).get("content", "{}")
    return parse_json_response(content)


def initial_node(state: OutlineState) -> OutlineState:
    """初始节点：调用模型判断"""
    client = get_minimax_client()

    # 构建 prompt
    user_profile = state.get("user_profile", {})
    user_memory = state.get("user_memory", {})
    topic = state.get("topic", "")
    messages = state.get("messages", [])

    # 构建用户信息字符串
    profile_str = f"背景: {user_profile.get('background', '未提供')}"
    memory_str = json.dumps(user_memory, ensure_ascii=False)

    # 如果有之前的问答，加入上下文
    if state.get("answers"):
        qa_pairs = []
        for i, (q, a) in enumerate(zip(state.get("questions_asked", []), state["answers"])):
            qa_pairs.append(f"Q{i+1}: {q}\nA{i+1}: {a}")
        previous_qa = "\n".join(qa_pairs)
        prompt = f"""## 用户之前的问题和回答
{previous_qa}

## 主题
{topic}

基于用户的回答，判断是否还需要问更多问题，还是信息已经足够。
只返回 JSON。"""
    else:
        prompt = f"""## 用户信息
{profile_str}

## 记忆信息
{memory_str}

## 主题
{topic}

请判断是否需要向用户提问以获取更多信息。如果需要，只问最关键的1个问题。
只返回 JSON。"""

    # 调用模型
    response = client.chat(
        messages=[
            {"role": "system", "content": ""},
            {"role": "user", "content": prompt}
        ],
        max_tokens=1000,
    )

    result = extract_json_from_response(response)

    # 根据响应类型更新状态
    if result.get("type") == "questions":
        questions = result.get("questions", [])
        if questions:
            return {
                **state,
                "messages": state["messages"] + [{"role": "assistant", "content": json.dumps(result)}],
                "current_question": questions[0],
                "question_count": state["question_count"] + 1,
                "questions_asked": state["questions_asked"] + [questions[0]["id"]],
                "status": "asking",
                "needs_tools": False,
            }
    elif result.get("type") == "confirmation":
        return {
            **state,
            "messages": state["messages"] + [{"role": "assistant", "content": json.dumps(result)}],
            "blueprint": result.get("blueprint"),
            "status": "confirming",
            "current_question": None,
            "needs_tools": False,
        }
    elif result.get("type") == "reconsider":
        return {
            **state,
            "messages": state["messages"] + [{"role": "assistant", "content": json.dumps(result)}],
            "status": "reconsidering",
            "current_question": None,
            "needs_tools": False,
        }

    return state


def ask_question_node(state: OutlineState) -> OutlineState:
    """提问节点：等待用户回答"""
    # 这个节点会返回当前问题，等待用户通过 API 回答
    return {
        **state,
        "status": "asking",
    }


def receive_answer_node(state: OutlineState, answer: str) -> OutlineState:
    """接收答案节点：存储答案，继续循环"""
    return {
        **state,
        "messages": state["messages"] + [{"role": "user", "content": answer}],
        "answers": state["answers"] + [answer],
        "current_question": None,
        "status": "initial",
    }


def confirm_node(state: OutlineState) -> OutlineState:
    """确认节点：最终 blueprint 已生成"""
    return {
        **state,
        "status": "confirming",
    }


def reconsider_node(state: OutlineState) -> OutlineState:
    """重新思考节点"""
    return {
        **state,
        "status": "reconsidering",
    }
```

- [ ] **Step 2: 创建 agents/outline/graph.py**

```python
from langgraph.graph import StateGraph, END
from ..outline.state import OutlineState
from .nodes import initial_node, ask_question_node, confirm_node, reconsider_node


def should_continue(state: OutlineState) -> str:
    """边路由：判断下一步"""
    # 如果是重新思考，直接结束让用户重试
    if state.get("status") == "reconsidering":
        return "reconsider"

    # 如果有当前问题，返回提问节点
    if state.get("current_question") is not None:
        return "ask_question"

    # 如果有 blueprint，返回确认节点
    if state.get("blueprint") is not None:
        return "confirm"

    # 如果需要工具调用
    if state.get("needs_tools"):
        return "tool_calling"

    # 默认回到初始节点
    return "initial"


def create_outline_graph():
    """创建 Outline Agent 的 LangGraph"""
    builder = StateGraph(OutlineState)

    # 添加节点
    builder.add_node("initial", initial_node)
    builder.add_node("ask_question", ask_question_node)
    builder.add_node("confirm", confirm_node)
    builder.add_node("reconsider", reconsider_node)

    # 设置入口点
    builder.set_entry_point("initial")

    # 条件边：从 initial 出发
    builder.add_conditional_edges(
        "initial",
        should_continue,
        {
            "ask_question": "ask_question",
            "confirm": "confirm",
            "reconsider": "reconsider",
            "tool_calling": "tool_calling",
            "initial": "initial",  # 循环回到 initial
        }
    )

    # 边：从 ask_question 结束，等待用户回答（通过外部 API）
    builder.add_edge("ask_question", END)

    # 边：其他节点结束
    builder.add_edge("confirm", END)
    builder.add_edge("reconsider", END)

    return builder.compile()
```

- [ ] **Step 3: Commit**

```bash
git add python-agent/agents/outline/
git commit -m "feat(agent): 添加 LangGraph 节点和边
- initial_node 调用 MiniMax 判断
- ask_question_node 等待用户
- 条件边路由逻辑
- create_outline_graph 构建图

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 创建 Pydantic Schema

**Files:**
- Create: `python-agent/schemas/__init__.py`
- Create: `python-agent/schemas/outline.py`

- [ ] **Step 1: 创建 schemas/__init__.py**

```python
from .outline import (
    OutlineRequest,
    OutlineAnswerRequest,
    OutlineResponse,
    LearnerPositioning,
    OutlineBlueprint,
    ClarificationQuestion,
)

__all__ = [
    "OutlineRequest",
    "OutlineAnswerRequest",
    "OutlineResponse",
    "LearnerPositioning",
    "OutlineBlueprint",
    "ClarificationQuestion",
]
```

- [ ] **Step 2: 创建 schemas/outline.py**

```python
from pydantic import BaseModel, Field
from typing import Literal, Optional


class LearnerPositioning(BaseModel):
    """用户定位"""
    estimatedLevel: Literal["novice", "beginner", "intermediate", "advanced"]
    difficultySummary: str
    backgroundSummary: str
    skipBasics: list[str] = Field(default_factory=list)
    whyThisCourseFits: str


class OutlineBlueprint(BaseModel):
    """课程纲要 Blueprint"""
    learningDirection: str
    learningGoal: str
    learnerPositioning: LearnerPositioning


class ClarificationQuestion(BaseModel):
    """澄清问题"""
    id: str
    question: str
    options: list[str] = Field(default_factory=list)


class OutlineResponse(BaseModel):
    """Outline 响应"""
    type: Literal["confirmation", "questions", "reconsider"]
    blueprint: Optional[OutlineBlueprint] = None
    questions: Optional[list[ClarificationQuestion]] = None
    message: Optional[str] = None
    sessionId: Optional[str] = None


class OutlineRequest(BaseModel):
    """生成 Outline 请求"""
    topic: str = Field(..., description="课程主题")
    userProfile: dict = Field(default_factory=dict, description="用户画像")
    userMemory: dict = Field(default_factory=dict, description="用户记忆")


class OutlineAnswerRequest(BaseModel):
    """提交问题答案请求"""
    sessionId: str = Field(..., description="Session ID")
    answer: str = Field(..., description="用户答案")
```

- [ ] **Step 3: Commit**

```bash
git add python-agent/schemas/
git commit -m "feat(agent): 添加 Pydantic Schema
- OutlineRequest, OutlineAnswerRequest
- OutlineBlueprint, LearnerPositioning
- ClarificationQuestion

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 创建 FastAPI 主入口和路由

**Files:**
- Create: `python-agent/main.py`

- [ ] **Step 1: 创建 main.py**

```python
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from agents.outline.graph import create_outline_graph
from agents.outline.state import OutlineState
from agents.outline.nodes import receive_answer_node
from memory.session import get_session_store
from lib.minimax import MiniMaxClient
from schemas.outline import OutlineRequest, OutlineAnswerRequest


# 全局组件
outline_graph = create_outline_graph()
session_store = get_session_store()
minimax_client = MiniMaxClient()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期"""
    # 启动时
    print("Agent 服务启动")
    yield
    # 关闭时
    print("Agent 服务关闭")


app = FastAPI(
    title="Agent Outline Generator",
    description="AI 课程纲要生成 Agent",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "ok"}


@app.post("/api/agents/outline/generate")
async def generate_outline(req: OutlineRequest):
    """启动 outline 生成"""
    # 创建初始状态
    initial_state: OutlineState = {
        "session_id": "",
        "agent_type": "outline",
        "topic": req.topic,
        "user_profile": req.userProfile,
        "user_memory": req.userMemory,
        "messages": [],
        "current_question": None,
        "question_count": 0,
        "questions_asked": [],
        "answers": [],
        "blueprint": None,
        "status": "initial",
        "needs_tools": False,
        "tool_results": [],
    }

    # 调用 graph
    result = outline_graph.invoke(initial_state)

    # 创建 session
    session = session_store.create("outline", result)

    # 构建响应
    response_data = {
        "sessionId": session.session_id,
        "type": result.get("status", "initial"),
    }

    if result.get("current_question"):
        response_data["question"] = result["current_question"]
    if result.get("blueprint"):
        response_data["blueprint"] = result["blueprint"]
    if result.get("status") == "reconsidering":
        response_data["message"] = "请重试"

    return response_data


@app.post("/api/agents/outline/answer")
async def answer_question(req: OutlineAnswerRequest):
    """提交问题答案"""
    # 获取 session
    session = session_store.get(req.sessionId)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    state = session.state

    # 添加用户回答
    state = receive_answer_node(state, req.answer)
    state["session_id"] = req.sessionId

    # 继续调用 graph
    result = outline_graph.invoke(state)

    # 更新 session
    session_store.update(req.sessionId, result)

    # 构建响应
    response_data = {
        "sessionId": req.sessionId,
        "type": result.get("status", "initial"),
    }

    if result.get("current_question"):
        response_data["question"] = result["current_question"]
    if result.get("blueprint"):
        response_data["blueprint"] = result["blueprint"]
    if result.get("status") == "reconsidering":
        response_data["message"] = "请重试"

    return response_data


@app.get("/api/agents/outline/stream")
async def stream_outline(sessionId: str):
    """SSE 流式监听（简化版，返回当前状态）"""
    session = session_store.get(sessionId)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_generator():
        state = session.state

        # 发送当前状态
        yield {
            "event": "status",
            "data": json.dumps({
                "status": state.get("status"),
                "question": state.get("current_question"),
                "blueprint": state.get("blueprint"),
            }),
        }

    return EventSourceResponse(event_generator())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

- [ ] **Step 2: Commit**

```bash
git add python-agent/main.py
git commit -m "feat(agent): 添加 FastAPI 主入口
- POST /api/agents/outline/generate
- POST /api/agents/outline/answer
- GET /api/agents/outline/stream (SSE)
- CORS 中间件配置

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: 集成测试和验证

**Files:**
- Create: `python-agent/tests/__init__.py`
- Create: `python-agent/tests/test_outline.py`

- [ ] **Step 1: 创建 tests/__init__.py**

```python
# Test package
```

- [ ] **Step 2: 创建 tests/test_outline.py**

```python
import pytest
from schemas.outline import OutlineRequest, LearnerPositioning, OutlineBlueprint


def test_learner_positioning_schema():
    """测试 LearnerPositioning Schema"""
    positioning = LearnerPositioning(
        estimatedLevel="beginner",
        difficultySummary="适合前端开发者",
        backgroundSummary="有 React 基础",
        skipBasics=["React 基础"],
        whyThisCourseFits="深入理解状态管理",
    )
    assert positioning.estimatedLevel == "beginner"
    assert "React" in positioning.backgroundSummary


def test_outline_blueprint_schema():
    """测试 OutlineBlueprint Schema"""
    blueprint = OutlineBlueprint(
        learningDirection="深入学习 React 状态管理",
        learningGoal="掌握 Redux、Zustand 等状态管理方案",
        learnerPositioning=LearnerPositioning(
            estimatedLevel="intermediate",
            difficultySummary="中等难度",
            backgroundSummary="有 2 年前端经验",
            skipBasics=[],
            whyThisCourseFits="想深入理解状态管理",
        ),
    )
    assert "React" in blueprint.learningDirection
    assert blueprint.learnerPositioning.estimatedLevel == "intermediate"


def test_outline_request_schema():
    """测试 OutlineRequest Schema"""
    req = OutlineRequest(
        topic="React 状态管理",
        userProfile={"background": "前端开发"},
        userMemory={"extractedInsights": {}},
    )
    assert req.topic == "React 状态管理"
    assert req.userProfile["background"] == "前端开发"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
```

- [ ] **Step 3: 安装测试依赖并运行**

```bash
cd python-agent
pip install pytest pytest-asyncio
pytest tests/ -v
```

- [ ] **Step 4: Commit**

```bash
git add python-agent/tests/
git commit -m "test(agent): 添加单元测试
- LearnerPositioning Schema 测试
- OutlineBlueprint Schema 测试
- OutlineRequest Schema 测试

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 实现总结

### 已创建文件

```
python-agent/
├── main.py                      # FastAPI 入口
├── requirements.txt
├── .env.example
├── README.md
├── agents/
│   ├── __init__.py
│   └── outline/
│       ├── __init__.py
│       ├── state.py           # OutlineState
│       ├── prompts.py         # Prompt 模板
│       ├── nodes.py           # LangGraph 节点
│       └── graph.py           # LangGraph 图
├── mcp/
│   ├── __init__.py
│   ├── registry.py            # 工具注册中心
│   └── tools/
│       ├── __init__.py
│       ├── base.py            # MCPTool 基类
│       └── search.py          # 搜索工具
├── memory/
│   ├── __init__.py
│   └── session.py             # Session 管理
├── lib/
│   ├── __init__.py
│   └── minimax.py             # MiniMax API
├── schemas/
│   ├── __init__.py
│   └── outline.py             # Pydantic 模型
└── tests/
    ├── __init__.py
    └── test_outline.py        # 单元测试
```

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/agents/outline/generate` | POST | 启动 outline 生成 |
| `/api/agents/outline/answer` | POST | 提交问题答案 |
| `/api/agents/outline/stream` | GET | SSE 流式监听 |
