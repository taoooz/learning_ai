# Agent Outline Generator 设计文档

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** 引入 LangGraph Agent 框架，实现流式问答的课程纲要生成服务

**Architecture:** 独立 Python 服务 (FastAPI + LangGraph)，通过 SSE 与 Next.js 前端通信，MCP 协议接入搜索工具

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
│  │ FastAPI                                                      ││
│  │  - POST /generate/outline      启动 outline 生成             ││
│  │  - POST /generate/outline/answer  提交问题答案               ││
│  │  - GET  /generate/outline/stream  SSE 流式监听              ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ LangGraph StateMachine                                       ││
│  │  initial → asking → confirming/reconsidering                ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ MCP Tools                                                    ││
│  │  - search: 网页搜索工具                                       ││
│  └─────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. 目录结构

```
python-agent/
├── main.py                 # FastAPI 入口，SSE 端点
├── agent/
│   ├── __init__.py
│   ├── graph.py           # LangGraph 定义（状态、节点、边）
│   ├── state.py           # OutlineState TypedDict
│   ├── nodes.py           # 各节点逻辑实现
│   └── prompts.py         # Prompt 模板
├── mcp/
│   ├── __init__.py
│   ├── server.py          # MCP Server 实现
│   └── tools/
│       ├── __init__.py
│       └── search.py      # 搜索工具 (Serper/DDGS)
├── schemas/
│   ├── __init__.py
│   └── outline.py         # Pydantic 请求/响应模型
├── lib/
│   ├── __init__.py
│   └── minimax.py         # MiniMax API 封装
└── requirements.txt
```

---

## 3. API 接口

### 3.1 POST /generate/outline

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

### 3.2 POST /generate/outline/answer

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

### 3.3 GET /generate/outline/stream

**描述:** SSE 流式监听（可选，用于实时显示思考过程）

**查询参数:** `sessionId`

---

## 4. LangGraph State 定义

```python
from typing import TypedDict, Optional
from langgraph.graph import add_messages

class OutlineState(TypedDict):
    topic: str
    user_profile: dict
    user_memory: dict
    messages: list[dict]           # [{role, content}]
    current_question: Optional[dict]  # {id, question, options}
    question_count: int           # 已问问题数，最多 3
    questions_asked: list[str]    # 已问问题的 ID 列表
    answers: list[str]            # 用户回答
    blueprint: Optional[dict]      # 最终 blueprint
    status: str                   # initial/asking/confirming/reconsidering
    session_id: str               # 会话 ID
```

---

## 5. LangGraph 节点

### 5.1 nodes.py

```python
# 节点定义

def initial_node(state: OutlineState) -> OutlineState:
    """初始节点：调用模型判断"""
    pass

def ask_question_node(state: OutlineState) -> OutlineState:
    """提问节点：提取问题，更新状态"""
    pass

def receive_answer_node(state: OutlineState) -> OutlineState:
    """接收答案节点：存储答案，继续循环"""
    pass

def confirm_node(state: OutlineState) -> OutlineState:
    """确认节点：生成最终 blueprint"""
    pass

def reconsider_node(state: OutlineState) -> OutlineState:
    """重新思考节点：返回消息让用户重试"""
    pass
```

### 5.2 边逻辑

```python
# 边路由

def should_ask_more(state: OutlineState) -> str:
    """判断是否继续提问"""
    if state.question_count >= 3:
        return "confirm"
    if state.current_question is None:
        return "confirm"
    return "ask"

def route_after_answer(state: OutlineState) -> str:
    """答案后路由"""
    return "initial"  # 回到初始节点让模型判断
```

---

## 6. MCP 搜索工具

### 6.1 工具定义

```json
{
  "name": "search_web",
  "description": "搜索互联网获取最新信息",
  "input_schema": {
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
```

### 6.2 实现

- 使用 Serper API 或 DuckDuckGo Search
- 返回搜索结果摘要
- 模型根据结果补充知识缺口

---

## 7. 数据模型

### 7.1 OutlineBlueprint (最终输出)

```python
class OutlineBlueprint(BaseModel):
    learningDirection: str = Field(description="学习方向，一句话概括")
    learningGoal: str = Field(description="学习目标")
    learnerPositioning: LearnerPositioning = Field(description="用户定位")

class LearnerPositioning(BaseModel):
    estimatedLevel: Literal["novice", "beginner", "intermediate", "advanced"]
    difficultySummary: str = Field(description="难度描述")
    backgroundSummary: str = Field(description="背景总结")
    skipBasics: list[str] = Field(description="可跳过内容")
    whyThisCourseFits: str = Field(description="为什么适合")
```

### 7.2 ClarificationQuestion

```python
class ClarificationQuestion(BaseModel):
    id: str = Field(description="问题 ID")
    question: str = Field(description="问题文本")
    options: list[str] = Field(description="选项列表")
```

---

## 8. 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| MiniMax API 超时 | 重试 3 次，失败返回 error |
| MCP 工具调用失败 | 降级，跳过工具继续执行 |
| Session 不存在 | 返回 404 |
| 流式连接断开 | 清理 session 状态 |

---

## 9. 与现有系统集成

### 9.1 Next.js 端改动

- `app/generate/confirm/page.tsx` 改为调用 Python 服务
- 使用 EventSource 接收 SSE 流
- 或保持现有 `/api/generate/outline` 代理到 Python 服务

### 9.2 渐进迁移策略

```
阶段 1: Python 服务独立运行，端口 8000
阶段 2: Next.js 通过 HTTP 代理调用
阶段 3: 移除 Next.js outline API，完整迁移
```

---

## 10. 后续扩展

### 10.1 AI 助教答疑 (阶段 2)
- 新增 `/api/chat` 端点
- 复用同一 Agent 框架，不同 system prompt

### 10.2 个性化复习规划 (阶段 3)
- 新增复习规划 Agent
- 调用课程知识库获取学习数据

### 10.3 MCP 工具扩展
- 添加课程知识库工具
- 添加用户数据库工具
