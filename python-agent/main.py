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