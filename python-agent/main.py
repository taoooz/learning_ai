import asyncio
import json
import os
import threading
import time
from pathlib import Path
from contextlib import asynccontextmanager
import hmac
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
from services.outline_agent import (
    stream_outline_with_tools,
    stream_answer_with_tools,
)
from services.toc_agent import stream_toc_with_tools
from services.chat_agent import stream_chat_with_tools, build_chat_system_prompt
from routers.learning_v2 import router as learning_v2_router
from routers.user_data import router as user_data_router
from routers.memory_v4 import router as memory_v4_router
from routers.prompt_lab import router as prompt_lab_router
from services.memory_v4_store import MemoryV4Store
from services.memory_context_v4 import (
    resolve_memory_context,
    safe_resolve_memory_context,
    to_chat_prompt_payload,
    to_planning_prompt_payload,
)
from services.memory_candidate_service import extract_memory_candidates, should_extract_memory_candidates
from services.memory_summary_service import rebuild_learning_summary
from services.chat_memory_service import assistant_message_id, normalize_chat_messages

session_store = get_session_store()

INTERNAL_TOKEN_HEADER = "X-Internal-Token"


async def _extract_and_consolidate_memory(
    account_id: str,
    course_id: str,
    course_topic: str,
    messages: list[dict],
) -> None:
    """聊天结束后的后台候选提取；任何失败都不得影响主对话。"""
    try:
        if not should_extract_memory_candidates(messages):
            return
        store = MemoryV4Store()
        candidates = await extract_memory_candidates(
            account_id=account_id,
            course_id=course_id,
            topic=course_topic,
            messages=messages,
            memory_store=store.load_store(account_id),
        )
        for candidate in candidates:
            store.append_candidate(account_id, candidate)
        if candidates:
            result = store.consolidate_candidates(account_id)
            if result.get("applied", 0) > 0:
                await rebuild_learning_summary(store, account_id)
    except Exception as exc:  # noqa: BLE001 后台记忆任务失败静默
        print(f"[MemoryCandidate] background extraction failed: {exc}")


def _dispatch_memory_extraction(
    account_id: str,
    course_id: str,
    course_topic: str,
    messages: list[dict],
) -> None:
    """从同步流式生成器启动后台异步任务，不能依赖当前线程有 running loop。"""
    def run() -> None:
        try:
            asyncio.run(_extract_and_consolidate_memory(
                account_id,
                course_id,
                course_topic,
                messages,
            ))
        except Exception as exc:  # noqa: BLE001 后台任务失败不影响主对话
            print(f"[MemoryCandidate] background dispatch failed: {exc}")

    threading.Thread(target=run, daemon=True).start()

# 会话过期与清理策略（可用环境变量覆盖）：
# 持久化后会话只增不减，需定期清理过期会话，防止磁盘/内存缓慢膨胀
SESSION_MAX_AGE_SECONDS = int(os.getenv("SESSION_MAX_AGE_SECONDS", "86400"))
SESSION_CLEANUP_INTERVAL_SECONDS = int(os.getenv("SESSION_CLEANUP_INTERVAL_SECONDS", "3600"))


async def _session_cleanup_loop() -> None:
    """后台定期清理过期会话；单次清理失败不中断循环"""
    while True:
        await asyncio.sleep(SESSION_CLEANUP_INTERVAL_SECONDS)
        try:
            removed = session_store.cleanup_old(max_age_seconds=SESSION_MAX_AGE_SECONDS)
            if removed:
                print(f"[INFO] 定期清理过期会话 {removed} 个")
        except Exception as e:  # noqa: BLE001 清理是后台维护任务，任何异常都不应影响主服务
            print(f"[WARN] 清理过期会话失败: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Agent 服务启动")
    # 启动时先清一次历史遗留的过期会话（重启前已过期的文件）
    try:
        removed = session_store.cleanup_old(max_age_seconds=SESSION_MAX_AGE_SECONDS)
        if removed:
            print(f"[INFO] 启动清理过期会话 {removed} 个")
    except Exception as e:  # noqa: BLE001 启动清理失败不阻断服务启动
        print(f"[WARN] 启动清理过期会话失败: {e}")
    cleanup_task = asyncio.create_task(_session_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        print("Agent 服务关闭")


app = FastAPI(title="Agent Outline Generator", version="1.0.0", lifespan=lifespan)
app.include_router(learning_v2_router)
app.include_router(user_data_router)
app.include_router(memory_v4_router)
app.include_router(prompt_lab_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_internal_token(request: Request, call_next):
    """BFF → Agent 服务间认证。

    配置 PYTHON_INTERNAL_TOKEN 后，所有 /api/* 都必须携带该令牌；
    /health 保持开放，便于部署探活。令牌不落日志、不进入错误响应。
    """
    expected_token = os.getenv("PYTHON_INTERNAL_TOKEN")
    if expected_token:
        provided_token = request.headers.get(INTERNAL_TOKEN_HEADER)
        if not provided_token or not hmac.compare_digest(provided_token, expected_token):
            return JSONResponse(
                status_code=401,
                content={"ok": False, "code": "UNAUTHORIZED", "message": "缺少服务访问凭证", "retryable": False},
            )
    return await call_next(request)


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


@app.post("/api/agents/outline/generate_agent")
async def generate_outline_agent(req: OutlineRequest, request: Request):
    """Agent 版 outline 生成（带搜索能力，流式）"""
    account = request.headers.get("X-Account-Id")
    if account:
        memory_store = MemoryV4Store()
        context = safe_resolve_memory_context(memory_store, account, {
            "scene": "course_planning",
            "topic": req.topic,
        })
        planning = to_planning_prompt_payload(memory_store, account, context) if context else {
            "userProfile": {},
            "planningMemory": {},
        }
        req.userProfile = planning.get("userProfile") or {}
        req.planningMemory = planning.get("planningMemory") or {}
    def event_generator():
        try:
            yield from stream_outline_with_tools(
                topic=req.topic,
                user_profile=req.userProfile,
                planning_memory=req.planningMemory,
                account_id=account,
            )
        except Exception as e:
            print(f"[Outline Agent API] Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/outline/answer_agent")
async def answer_outline_agent(req: OutlineAnswerRequest, request: Request):
    """Agent 版 outline 多轮回答（带搜索能力，流式）"""
    def event_generator():
        try:
            yield from stream_answer_with_tools(
                session_id=req.sessionId,
                answer=req.answer or "",
                answers=[item.model_dump() for item in req.answers] or None,
                account_id=request.headers.get("X-Account-Id"),
            )
        except Exception as e:
            print(f"[Outline Answer Agent API] Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/toc/generate_agent")
async def generate_toc_agent_route(request: Request):
    """Agent 版 TOC 生成（带搜索能力，流式）"""
    body = await request.json()
    account = request.headers.get("X-Account-Id")
    blueprint = body.get('blueprint', {})
    planning_payload = body.get('planningPayload')
    user_profile = body.get('userProfile')
    if account:
        memory_store = MemoryV4Store()
        context = safe_resolve_memory_context(memory_store, account, {
            "scene": "course_planning",
            "topic": blueprint.get('topic', ''),
        })
        planning = to_planning_prompt_payload(memory_store, account, context) if context else {
            "userProfile": {},
            "planningMemory": {},
        }
        planning_payload = planning.get("planningMemory") or {}
        user_profile = planning.get("userProfile") or {}

    def event_generator():
        try:
            yield from stream_toc_with_tools(
                blueprint,
                planning_payload,
                user_profile,
                account_id=account,
            )
        except Exception as e:
            print(f"[TOC Agent API] Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/chat/generate")
async def chat_agent_route(request: Request):
    """Agent 版学习对话（带搜索能力，流式 SSE）"""
    body = await request.json()
    if (
        not isinstance(body, dict)
        or not str(body.get("courseTopic") or "").strip()
        or not isinstance(body.get("messages"), list)
        or not body.get("messages")
    ):
        raise HTTPException(status_code=422, detail="chat/generate 需要 courseTopic 与非空 messages")
    account = request.headers.get("X-Account-Id")

    def event_generator():
        try:
            raw_messages = body["messages"]
            max_tokens = body.get('maxTokens', 1500)
            course_topic = str(body["courseTopic"]).strip()
            chat_memory = body.get('chatMemory')
            context_info = body.get('contextInfo')
            conversation_summary = body.get('conversationSummary')
            if account:
                question_context = (context_info or {}).get('questionContext') or {}
                focus = (context_info or {}).get('currentNodeTitle') or question_context.get('question') or ''
                memory_store = MemoryV4Store()
                context = safe_resolve_memory_context(memory_store, account, {
                    "scene": "chat",
                    "topic": course_topic,
                    "courseId": body.get("courseId"),
                    "queryText": focus,
                })
                chat_memory = to_chat_prompt_payload(context) if context else None
                try:
                    conversation_summary = memory_store.get_chat_summary(
                        account,
                        str(body.get("courseId") or ""),
                    )
                except Exception as exc:  # noqa: BLE001
                    print(f"[MemoryContext] chat summary unavailable: {exc}")
                    conversation_summary = None

            system_prompt = build_chat_system_prompt(
                course_topic=course_topic,
                context_info=context_info,
                conversation_summary=conversation_summary,
                chat_memory=chat_memory,
                memory_search_enabled=bool(account),
            )
            messages = [{"role": "system", "content": system_prompt}]
            authoritative_messages = normalize_chat_messages(
                str(body.get("courseId") or ""),
                raw_messages,
                turn_id=str(body.get("turnId") or ""),
            )
            messages.extend([
                {"role": item["role"], "content": item["content"]}
                for item in authoritative_messages
            ])

            assistant_parts: list[str] = []
            for chunk in stream_chat_with_tools(
                messages=messages, max_tokens=max_tokens, memory_account_id=account
            ):
                yield chunk
                if chunk.startswith("data: ") and chunk[6:].strip() != "[DONE]":
                    try:
                        payload = json.loads(chunk[6:].strip())
                        content = ((payload.get("choices") or [{}])[0].get("delta") or {}).get("content")
                        if content:
                            assistant_parts.append(str(content))
                    except Exception:
                        pass
            if account and raw_messages:
                assistant_text = "".join(assistant_parts)
                assistant_item = {
                    "messageId": assistant_message_id(
                        str(body.get("courseId") or ""),
                        str(body.get("turnId") or ""),
                        assistant_text,
                    ),
                    "role": "assistant",
                    "content": assistant_text,
                    "createdAt": int(time.time() * 1000),
                }
                refine_messages = [*authoritative_messages, assistant_item]
                try:
                    MemoryV4Store().append_chat_transcript(
                        account,
                        str(body.get("courseId") or ""),
                        refine_messages,
                    )
                except Exception as exc:  # noqa: BLE001 transcript 失败不阻断对话
                    print(f"[Chat Memory] transcript save failed: {exc}")
                _dispatch_memory_extraction(
                    account,
                    str(body.get("courseId") or ""),
                    str(course_topic or ""),
                    refine_messages,
                )
        except Exception as e:
            print(f"[Chat Agent API] Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
