import json
import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

# 加载 .env
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ.setdefault(key, value)

from memory.session import get_session_store
from schemas.outline import OutlineRequest, OutlineAnswerRequest
from services.outline_service import (
    build_initial_prompt,
    stream_llm_and_parse, stream_blueprint_fields, make_initial_state
)
from services.toc_service import generate_toc
from services.cards_service import generate_cards
from services.questions_service import generate_questions

session_store = get_session_store()


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Agent 服务启动")
    yield
    print("Agent 服务关闭")


app = FastAPI(title="Agent Outline Generator", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    from fastapi.responses import JSONResponse
    print(f"[ERROR] Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": "服务器内部错误，请稍后重试"}
    )


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.post("/api/agents/outline/generate")
async def generate_outline(req: OutlineRequest):
    """启动 outline 生成（流式）"""
    async def event_generator():
        state = make_initial_state(req.topic, req.userProfile, req.userMemory)
        prompt = build_initial_prompt(req.topic, req.userProfile, req.userMemory)
        session_id = None

        async for event in stream_llm_and_parse(prompt):
            if event["type"] == "__full_content__":
                # 流式完成，解析并保存到 session
                parsed = event.get("parsed", {})
                
                # 创建 session
                session = session_store.create("outline", state)
                state["session_id"] = session.session_id
                session_id = session.session_id
                
                if parsed.get("questions"):
                    q = parsed["questions"][0]
                    state["questions_asked"].append(q["question"])
                    state["current_question"] = q

                # 保存首次 messages 到 llm_messages，后续回答时用于构建多轮对话
                ai_reply = event.get("content", "")
                state["llm_messages"] = [
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": ai_reply},
                ]

                session_store.update(session.session_id, state)
            else:
                yield f"data: {json.dumps(event)}\n\n"
        
        # 流式结束后发送 sessionId
        if session_id:
            yield f"data: {json.dumps({'type': 'session_created', 'sessionId': session_id})}\n\n"
        
        yield "data: [DONE]\n\n"

    return EventSourceResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/outline/answer")
async def answer_question(req: OutlineAnswerRequest):
    """提交问题答案（流式）"""
    async def event_generator():
        session = session_store.get(req.sessionId)
        if not session:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Session not found'})}\n\n"
            return

        state = session.state
        state["answers"].append(req.answer)
        state["question_count"] += 1

        # 构建多轮 messages：历史对话 + 本轮用户回答
        llm_messages = list(state.get("llm_messages", []))
        llm_messages.append({"role": "user", "content": req.answer})

        async for event in stream_llm_and_parse(llm_messages, max_tokens=1500):
            if event["type"] == "__full_content__":
                # 流式完成，解析并保存到 session
                parsed = event.get("parsed", {})

                if parsed.get("questions"):
                    q = parsed["questions"][0]
                    state["questions_asked"].append(q["question"])
                    state["current_question"] = q

                # 保存 AI 回复到 llm_messages
                ai_reply = event.get("content", "")
                llm_messages.append({"role": "assistant", "content": ai_reply})
                state["llm_messages"] = llm_messages

                # 更新 session
                session_store.update(req.sessionId, state)
            else:
                yield f"data: {json.dumps(event)}\n\n"

        yield "data: [DONE]\n\n"

    return EventSourceResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/toc/generate")
async def generate_toc_route(request: dict):
    """生成 TOC"""
    try:
        blueprint = request.get('blueprint', {})
        planning_payload = request.get('planningPayload')
        
        result = await generate_toc(blueprint, planning_payload)
        return result
    except Exception as e:
        print(f"[TOC API] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/agents/cards/generate")
async def generate_cards_route(request: dict):
    """生成 Cards"""
    try:
        topic = request.get('topic', '')
        payload = request.get('payload', {})
        
        result = await generate_cards(topic, payload)
        return result
    except Exception as e:
        print(f"[Cards API] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/agents/questions/generate")
async def generate_questions_route(request: dict):
    """生成 Questions"""
    try:
        topic = request.get('topic', '')
        cards = request.get('cards', [])
        payload = request.get('payload', {})
        
        result = await generate_questions(topic, cards, payload)
        return result
    except Exception as e:
        print(f"[Questions API] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
