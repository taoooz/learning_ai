import json
import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse

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
from services.toc_service import generate_toc, stream_toc_events
from services.cards_service import generate_cards
from services.questions_service import generate_questions
from services.outline_agent import stream_outline_with_tools, stream_answer_with_tools
from services.toc_agent import stream_toc_with_tools
from services.cards_agent import generate_cards_with_tools
from services.questions_agent import generate_questions_with_tools
from services.chat_agent import stream_chat_with_tools

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
    from services.outline_agent import _user_friendly_error
    return JSONResponse(
        status_code=500,
        content={"error": _user_friendly_error(exc)}
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    body = await request.body()
    print(f"[422 VALIDATION ERROR] path={request.url.path}")
    print(f"  body={body.decode('utf-8', errors='replace')[:500]}")
    print(f"  errors={exc.errors()}")
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.post("/api/agents/outline/generate")
async def generate_outline(req: OutlineRequest):
    """启动 outline 生成（流式）"""
    async def event_generator():
        state = make_initial_state(req.topic, req.userProfile, req.userMemory)
        system_prompt = build_initial_prompt(req.topic, req.userProfile, req.userMemory)
        session_id = None

        try:
            async for event in stream_llm_and_parse(system_prompt):
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

                        # 发送前端期望的 question_start + questions 事件
                        yield f"data: {json.dumps({'type': 'question_start', 'questionNumber': state['question_count'] + 1}, ensure_ascii=False)}\n\n"
                        yield f"data: {json.dumps({'type': 'questions', 'questions': [q], 'sessionId': session_id}, ensure_ascii=False)}\n\n"

                    if parsed.get("outline"):
                        outline = parsed["outline"]
                        blueprint = {
                            "learningDirection": outline.get("learningDirection", ""),
                            "learningKeypoint": outline.get("learningKeypoint", ""),
                            "learningGoal": outline.get("learningGoal", ""),
                            "learnerPositioning": {
                                "estimatedLevel": outline.get("estimatedLevel", "beginner"),
                                "difficultySummary": "",
                                "backgroundSummary": outline.get("backgroundSummary", ""),
                                "skipBasics": outline.get("skipBasics", []),
                                "whyThisCourseFits": "",
                            },
                        }
                        state["blueprint"] = blueprint

                        # 发送前端期望的 blueprint 事件序列
                        yield f"data: {json.dumps({'type': 'blueprint_start'}, ensure_ascii=False)}\n\n"
                        for field in ["learningDirection", "learningGoal", "learnerPositioning"]:
                            yield f"data: {json.dumps({'type': 'blueprint_field', 'field': field, 'value': blueprint[field]}, ensure_ascii=False)}\n\n"
                        yield f"data: {json.dumps({'type': 'confirmation', 'blueprint': blueprint, 'sessionId': session_id}, ensure_ascii=False)}\n\n"

                    # 保存首次 messages 到 llm_messages，后续回答时用于构建多轮对话
                    ai_reply = event.get("content", "")
                    state["llm_messages"] = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": "请开始。"},
                        {"role": "assistant", "content": ai_reply},
                    ]

                    session_store.update(session.session_id, state)
                else:
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            print(f"[Outline Generate] Error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"

        # 流式结束后发送 sessionId（如果还没发过）
        if session_id:
            yield f"data: {json.dumps({'type': 'session_created', 'sessionId': session_id}, ensure_ascii=False)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/outline/answer")
async def answer_question(req: OutlineAnswerRequest):
    """提交问题答案（流式）"""
    async def event_generator():
        session = session_store.get(req.sessionId)
        if not session:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Session not found'}, ensure_ascii=False)}\n\n"
            return

        state = session.state
        state["answers"].append(req.answer)
        state["question_count"] += 1

        # 构建多轮 messages：历史对话 + 本轮用户回答
        llm_messages = list(state.get("llm_messages", []))
        llm_messages.append({"role": "user", "content": req.answer})

        try:
            async for event in stream_llm_and_parse(llm_messages, max_tokens=1500):
                if event["type"] == "__full_content__":
                    # 流式完成，解析并保存到 session
                    parsed = event.get("parsed", {})

                    if parsed.get("questions"):
                        q = parsed["questions"][0]
                        state["questions_asked"].append(q["question"])
                        state["current_question"] = q

                        # 发送前端期望的 question_start + questions 事件
                        yield f"data: {json.dumps({'type': 'question_start', 'questionNumber': state['question_count'] + 1}, ensure_ascii=False)}\n\n"
                        yield f"data: {json.dumps({'type': 'questions', 'questions': [q], 'sessionId': req.sessionId}, ensure_ascii=False)}\n\n"

                    if parsed.get("outline"):
                        outline = parsed["outline"]
                        blueprint = {
                            "learningDirection": outline.get("learningDirection", ""),
                            "learningKeypoint": outline.get("learningKeypoint", ""),
                            "learningGoal": outline.get("learningGoal", ""),
                            "learnerPositioning": {
                                "estimatedLevel": outline.get("estimatedLevel", "beginner"),
                                "difficultySummary": "",
                                "backgroundSummary": outline.get("backgroundSummary", ""),
                                "skipBasics": outline.get("skipBasics", []),
                                "whyThisCourseFits": "",
                            },
                        }
                        state["blueprint"] = blueprint

                        # 发送前端期望的 blueprint 事件序列
                        yield f"data: {json.dumps({'type': 'blueprint_start'}, ensure_ascii=False)}\n\n"
                        for field in ["learningDirection", "learningGoal", "learnerPositioning"]:
                            yield f"data: {json.dumps({'type': 'blueprint_field', 'field': field, 'value': blueprint[field]}, ensure_ascii=False)}\n\n"
                        yield f"data: {json.dumps({'type': 'confirmation', 'blueprint': blueprint, 'sessionId': req.sessionId}, ensure_ascii=False)}\n\n"

                    # 保存 AI 回复到 llm_messages
                    ai_reply = event.get("content", "")
                    llm_messages.append({"role": "assistant", "content": ai_reply})
                    state["llm_messages"] = llm_messages

                    # 更新 session
                    session_store.update(req.sessionId, state)
                else:
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            print(f"[Outline Answer] Error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/outline/generate_agent")
async def generate_outline_agent(req: OutlineRequest):
    """Agent 版 outline 生成（带搜索能力，流式）"""
    def event_generator():
        try:
            yield from stream_outline_with_tools(
                topic=req.topic,
                user_profile=req.userProfile,
                user_memory=req.userMemory,
            )
        except Exception as e:
            print(f"[Outline Agent API] Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/outline/answer_agent")
async def answer_outline_agent(req: OutlineAnswerRequest):
    """Agent 版 outline 多轮回答（带搜索能力，流式）"""
    def event_generator():
        try:
            yield from stream_answer_with_tools(
                session_id=req.sessionId,
                answer=req.answer,
            )
        except Exception as e:
            print(f"[Outline Answer Agent API] Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/toc/generate")
async def generate_toc_route(request: dict):
    """生成 TOC（流式）"""
    async def event_generator():
        try:
            blueprint = request.get('blueprint', {})
            planning_payload = request.get('planningPayload')
            user_profile = request.get('userProfile')

            async for event in stream_toc_events(blueprint, planning_payload, user_profile):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            print(f"[TOC API] Error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


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


@app.post("/api/agents/toc/generate_agent")
async def generate_toc_agent_route(request: dict):
    """Agent 版 TOC 生成（带搜索能力，流式）"""
    def event_generator():
        try:
            blueprint = request.get('blueprint', {})
            planning_payload = request.get('planningPayload')
            user_profile = request.get('userProfile')

            yield from stream_toc_with_tools(blueprint, planning_payload, user_profile)
        except Exception as e:
            print(f"[TOC Agent API] Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/cards/generate_agent")
async def generate_cards_agent_route(request: dict):
    """Agent 版 Cards 生成（带搜索能力）"""
    try:
        topic = request.get('topic', '')
        payload = request.get('payload', {})

        result = generate_cards_with_tools(topic, payload)
        return result
    except Exception as e:
        print(f"[Cards Agent API] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/agents/questions/generate_agent")
async def generate_questions_agent_route(request: dict):
    """Agent 版 Questions 生成（带搜索能力）"""
    try:
        topic = request.get('topic', '')
        cards = request.get('cards', [])
        payload = request.get('payload', {})

        result = generate_questions_with_tools(topic, cards, payload)
        return result
    except Exception as e:
        print(f"[Questions Agent API] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/agents/chat/generate")
async def chat_agent_route(request: dict):
    """Agent 版学习对话（带搜索能力，流式 SSE）"""
    def event_generator():
        try:
            messages = request.get('messages', [])
            max_tokens = request.get('maxTokens', 1500)

            yield from stream_chat_with_tools(messages=messages, max_tokens=max_tokens)
        except Exception as e:
            print(f"[Chat Agent API] Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
