import asyncio
import json
import os
import time
from pathlib import Path
from contextlib import asynccontextmanager
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
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
from services.chat_agent import stream_chat_with_tools, build_chat_system_prompt
from services.memory_refine_service import refine_memory
from schemas.learning_v2 import ChapterPlanRequest, ChapterRecapRequest, TaskStreamRequest
from schemas.tutor import InlineTutorRequest
from services.chapter_plan_service import generate_chapter_plan
from services.chapter_recap_service import generate_chapter_recap
from services.task_content_service import stream_task_events
from services.inline_tutor_service import (
    TutorRequestDataError,
    extract_tutor_envelope_ids,
    stream_tutor_events,
)
from services.learning_v2_errors import (
    BlueprintDataError,
    ChapterNotFoundError,
    LLM_ERROR_STATUS,
    PlanValidationError,
    RecapValidationError,
    classify_llm_error,
)

session_store = get_session_store()

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
        state = make_initial_state(req.topic, req.userProfile, req.planningMemory)
        system_prompt = build_initial_prompt(req.topic, req.userProfile, req.planningMemory)
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
                planning_memory=req.planningMemory,
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
            # 支持两种调用方式：
            # 1. 直接传 messages（向后兼容）
            # 2. 传结构化数据（courseTopic + messages），由 Python Agent 构建 prompt
            raw_messages = request.get('messages')
            max_tokens = request.get('maxTokens', 1500)
            course_topic = request.get('courseTopic')

            if course_topic:
                # 新模式：接收结构化数据，构建 prompt
                chat_memory = request.get('chatMemory')
                context_info = request.get('contextInfo')
                conversation_summary = request.get('conversationSummary')

                system_prompt = build_chat_system_prompt(
                    course_topic=course_topic,
                    context_info=context_info,
                    conversation_summary=conversation_summary,
                    chat_memory=chat_memory,
                )
                messages = [
                    {"role": "system", "content": system_prompt},
                    *[{"role": m.get("role", "user"), "content": m.get("content", "")} for m in (raw_messages or [])],
                ]
            else:
                messages = raw_messages or []

            yield from stream_chat_with_tools(messages=messages, max_tokens=max_tokens)
        except Exception as e:
            print(f"[Chat Agent API] Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/agents/memory/refine")
async def memory_refine_route(request: dict):
    """LLM 驱动的记忆精炼 — 分析对话和事件，返回结构化洞察"""
    try:
        recent_messages = request.get("recentMessages", [])
        current_summary = request.get("currentSummary")
        concept_count = request.get("conceptCount", 0)
        topic_count = request.get("topicCount", 0)
        recent_events_summary = request.get("recentEventsSummary", "")

        result = refine_memory(
            recent_messages=recent_messages,
            current_summary=current_summary,
            concept_count=concept_count,
            topic_count=topic_count,
            recent_events_summary=recent_events_summary,
        )
        return result
    except Exception as e:
        print(f"[Memory Refine API] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def _learning_v2_invalid_request(message: str):
    """V2 学习流请求参数/数据校验失败的 422 响应体"""
    return JSONResponse(
        status_code=422,
        content={"ok": False, "code": "INVALID_REQUEST", "message": message, "retryable": False},
    )


async def _validate_learning_v2_request(request: Request, schema_cls):
    """读取请求体并按 pydantic 模型校验；失败返回 (None, 422响应)，成功返回 (模型实例, None)"""
    try:
        body = await request.json()
    except Exception:
        return None, _learning_v2_invalid_request("请求体必须是合法 JSON")
    try:
        return schema_cls.model_validate(body), None
    except ValidationError as exc:
        details = []
        for err in exc.errors():
            loc = ".".join(str(part) for part in err.get("loc", ()))
            details.append(f"{loc}: {err.get('msg', '')}" if loc else err.get("msg", ""))
        return None, _learning_v2_invalid_request("请求参数校验失败：" + "；".join(details))


@app.post("/api/learning/v2/chapters/plan")
async def learning_v2_chapters_plan(request: Request):
    """V2 章节计划生成（同步 JSON）：把章节拆成 3～7 个短任务"""
    req, error_response = await _validate_learning_v2_request(request, ChapterPlanRequest)
    if error_response is not None:
        return error_response

    try:
        plan = await generate_chapter_plan(req)
        return {"ok": True, "plan": plan}
    except (ChapterNotFoundError, BlueprintDataError) as exc:
        print(f"[Learning V2 Plan] 请求数据无效: {exc}")
        return _learning_v2_invalid_request(str(exc))
    except PlanValidationError as exc:
        print(f"[Learning V2 Plan] 计划校验失败: {exc.errors}")
        return JSONResponse(
            status_code=502,
            content={
                "ok": False,
                "code": "PLAN_VALIDATION_FAILED",
                "message": "章节计划未通过校验，请重试",
                "retryable": False,
                "errors": exc.errors,
            },
        )
    except Exception as exc:  # noqa: BLE001 LLM 调用异常统一分类为错误码
        code, message = classify_llm_error(exc)
        print(f"[Learning V2 Plan] LLM 调用失败 code={code}: {exc}")
        return JSONResponse(
            status_code=LLM_ERROR_STATUS.get(code, 502),
            content={"ok": False, "code": code, "message": message, "retryable": True},
        )


@app.post("/api/learning/v2/tasks/stream")
async def learning_v2_tasks_stream(request: Request):
    """V2 任务内容流式生成（SSE）：事件遵循 LearningSseEvent 外壳"""
    req, error_response = await _validate_learning_v2_request(request, TaskStreamRequest)
    if error_response is not None:
        return error_response  # 流尚未开始，直接返回 422 JSON

    async def event_generator():
        fallback_request_id = f"req-{uuid4().hex[:12]}"
        try:
            async for event in stream_task_events(req):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001 最后兜底：意外异常也要补齐协议序列再结束
            print(f"[Learning V2 Stream] 意外异常: {exc}")
            import traceback
            traceback.print_exc()
            common = {
                "requestId": fallback_request_id,
                "type": "request_error",
                "courseId": req.courseId,
                "chapterId": req.chapterId,
                "taskId": req.taskId,
                "planVersion": req.planVersion,
                "timestamp": time.time_ns() // 1_000_000,
            }
            yield f"data: {json.dumps({**common, 'eventId': f'{fallback_request_id}:1', 'sequence': 1, 'payload': {'code': 'UPSTREAM_ERROR', 'message': '内容生成出现异常，请稍后重试', 'retryable': True}}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({**common, 'eventId': f'{fallback_request_id}:2', 'sequence': 2, 'type': 'request_completed', 'payload': {'requestId': fallback_request_id, 'status': 'failed', 'errorCode': 'UPSTREAM_ERROR'}}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/learning/v2/tutor/stream")
async def learning_v2_tutor_stream(request: Request):
    """V2 流内答疑流式生成（SSE）：tutor_started → tutor_block_started → N×tutor_block_delta
    → tutor_block_completed → tutor_completed → request_completed"""
    req, error_response = await _validate_learning_v2_request(request, InlineTutorRequest)
    if error_response is not None:
        return error_response  # 流尚未开始，直接返回 422 JSON

    try:
        chapter_id, plan_version = extract_tutor_envelope_ids(req)
    except TutorRequestDataError as exc:
        return _learning_v2_invalid_request(str(exc))

    async def event_generator():
        fallback_request_id = f"req-{uuid4().hex[:12]}"

        def fallback_event(sequence: int, event_type: str, payload: dict) -> dict:
            return {
                "eventId": f"{fallback_request_id}:{sequence}",
                "requestId": fallback_request_id,
                "type": event_type,
                "courseId": "",
                "chapterId": chapter_id,
                "taskId": req.task.taskId,
                "questionId": req.question.questionId,
                "planVersion": plan_version,
                "sequence": sequence,
                "timestamp": time.time_ns() // 1_000_000,
                "payload": payload,
            }

        try:
            async for event in stream_tutor_events(req, chapter_id, plan_version):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001 最后兜底：意外异常也要补齐协议序列再结束
            print(f"[Learning V2 Tutor] 意外异常: {exc}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps(fallback_event(1, 'request_error', {'code': 'UPSTREAM_ERROR', 'message': '内容生成出现异常，请稍后重试', 'retryable': True}), ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps(fallback_event(2, 'request_completed', {'requestId': fallback_request_id, 'status': 'failed', 'errorCode': 'UPSTREAM_ERROR'}), ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/learning/v2/chapters/recap")
async def learning_v2_chapters_recap(request: Request):
    """V2 章节 Recap 生成（同步 JSON）：章节全部任务完成后的小结
    证据红线（画像文档 §7.1）：三个掌握度证据字段由服务端确定性填空数组"""
    req, error_response = await _validate_learning_v2_request(request, ChapterRecapRequest)
    if error_response is not None:
        return error_response

    try:
        recap = await generate_chapter_recap(req)
        return {"ok": True, "recap": recap}
    except RecapValidationError as exc:
        print(f"[Learning V2 Recap] 小结校验失败: {exc.errors}")
        return JSONResponse(
            status_code=502,
            content={
                "ok": False,
                "code": "RECAP_VALIDATION_FAILED",
                "message": "章节小结未通过校验，请重试",
                "retryable": False,
                "errors": exc.errors,
            },
        )
    except Exception as exc:  # noqa: BLE001 LLM 调用异常统一分类为错误码
        code, message = classify_llm_error(exc)
        print(f"[Learning V2 Recap] LLM 调用失败 code={code}: {exc}")
        return JSONResponse(
            status_code=LLM_ERROR_STATUS.get(code, 502),
            content={"ok": False, "code": code, "message": message, "retryable": True},
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


@app.post("/api/learning/v2/checkpoints/generate")
async def learning_v2_checkpoints_generate(request: Request):
    """P3a 生成结构化 Checkpoint（同步 JSON）"""
    from schemas.checkpoint import CheckpointDefinitionModel
    from services.checkpoint_service import generate_checkpoint

    try:
        body = await request.json()
        course_topic = body["courseTopic"]
        chapter_title = body["chapter"]["title"]
        teaching_goal = body["chapter"]["teachingGoal"]
        task_id = body["task"]["taskId"]
        task_title = body["task"]["title"]
        task_goal = body["task"]["taskGoal"]
        objective_id = body["objectiveId"]
        task_content_summary = body["taskContentSummary"]
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=422, content={
            "ok": False, "code": "INVALID_REQUEST",
            "message": f"请求参数校验失败：{exc}", "retryable": False,
        })

    try:
        checkpoint = await generate_checkpoint(
            course_topic=course_topic,
            chapter_title=chapter_title,
            teaching_goal=teaching_goal,
            task_id=task_id,
            task_title=task_title,
            task_goal=task_goal,
            objective_id=objective_id,
            task_content_summary=task_content_summary,
        )
        return {"ok": True, "checkpoint": checkpoint.model_dump()}
    except Exception as exc:  # noqa: BLE001
        code, message = classify_llm_error(exc)
        print(f"[Learning V2 Checkpoint] 生成失败 code={code}: {exc}")
        return JSONResponse(
            status_code=LLM_ERROR_STATUS.get(code, 502),
            content={"ok": False, "code": code, "message": message, "retryable": True},
        )


@app.post("/api/learning/v2/checkpoints/evaluate")
async def learning_v2_checkpoints_evaluate(request: Request):
    """P3a 结构化 Checkpoint 程序判分（不经模型，确定性结果）"""
    from schemas.checkpoint import CheckpointEvaluateRequest
    from services.checkpoint_service import evaluate_checkpoint

    try:
        body = await request.json()
        req = CheckpointEvaluateRequest(**body)
        definition = req.checkpoint
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=422, content={
            "ok": False, "code": "INVALID_REQUEST",
            "message": f"请求参数校验失败：{exc}", "retryable": False,
        })

    # P3b：开放式题型路由 LLM Rubric 评分
    # 回归样本一致率 83% ≥ 80% 阈值（2026-09-19 达标），默认启用；env 置 falsy 可紧急关闭
    import os
    if definition.kind in ("self_explanation", "micro_practice"):
        if os.getenv("ENABLE_OPEN_ENDED_CHECKPOINTS", "true").lower() not in ("0", "false", "no"):
            from services.checkpoint_service import evaluate_open_ended
            evaluation = await evaluate_open_ended(definition, str(req.answer))
            return {"ok": True, "evaluation": evaluation.model_dump()}
        return JSONResponse(status_code=422, content={
            "ok": False, "code": "OPEN_ENDED_DISABLED",
            "message": "开放式题型尚未启用（回归验证未通过或未开启）", "retryable": False,
        })

    evaluation = evaluate_checkpoint(definition, req.answer, req.attempt)
    return {"ok": True, "evaluation": evaluation.model_dump()}


@app.post("/api/learning/v2/checkpoints/remediate")
async def learning_v2_checkpoints_remediate(request: Request):
    """P3a 补救内容生成：LLM 生成补救段落 + 等价不同题的新检查"""
    from services.checkpoint_service import generate_remediation

    try:
        body = await request.json()
        required = ["courseTopic", "chapterTitle", "taskId", "taskTitle", "taskGoal",
                    "originalPrompt", "userAnswer", "correctAnswer", "originalHint",
                    "taskContentSummary", "idempotencyKey"]
        missing = [k for k in required if not body.get(k)]
        if missing:
            return JSONResponse(status_code=422, content={
                "ok": False, "code": "INVALID_REQUEST",
                "message": f"缺少必填字段：{', '.join(missing)}", "retryable": False,
            })
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=422, content={
            "ok": False, "code": "INVALID_REQUEST",
            "message": f"请求体解析失败：{exc}", "retryable": False,
        })

    try:
        result = await generate_remediation(
            course_topic=body["courseTopic"],
            chapter_title=body["chapterTitle"],
            task_id=body["taskId"],
            task_title=body["taskTitle"],
            task_goal=body["taskGoal"],
            original_prompt=body["originalPrompt"],
            user_answer=str(body["userAnswer"]),
            correct_answer=str(body["correctAnswer"]),
            original_hint=body["originalHint"],
            task_content_summary=body["taskContentSummary"],
        )
        return {"ok": True, "remediationContent": result["remediationContent"], "newCheckpoint": result["newCheckpoint"]}
    except ValueError as exc:
        return JSONResponse(status_code=502, content={
            "ok": False, "code": "REMEDIATION_FORMAT_ERROR",
            "message": str(exc), "retryable": True,
        })
    except Exception as exc:  # noqa: BLE001
        code, message = classify_llm_error(exc)
        print(f"[Learning V2 Checkpoint Remediate] 生成失败 code={code}: {exc}")
        return JSONResponse(
            status_code=LLM_ERROR_STATUS.get(code, 502),
            content={"ok": False, "code": code, "message": message, "retryable": True},
        )


@app.post("/api/learning/v2/plan-patch/generate")
async def learning_v2_plan_patch_generate(request: Request):
    """P4 动态调度：基于证据信号生成计划补丁建议（客户端再过 canApplyPatch 校验）"""
    from schemas.plan_patch import GeneratePlanPatchRequest
    from services.plan_patch_service import generate_plan_patch

    req, error_response = await _validate_learning_v2_request(request, GeneratePlanPatchRequest)
    if error_response is not None:
        return error_response

    try:
        patch = await generate_plan_patch(
            course_topic=req.courseTopic,
            chapter_title=req.chapterTitle,
            teaching_goal=req.teachingGoal,
            plan_version=req.planVersion,
            remaining_tasks=req.remainingTasks,
            evidence_summary=req.evidenceSummary,
        )
        return {"ok": True, "patch": patch.model_dump()}
    except Exception as exc:  # noqa: BLE001
        code, message = classify_llm_error(exc)
        print(f"[Learning V2 PlanPatch] 生成失败 code={code}: {exc}")
        return JSONResponse(
            status_code=LLM_ERROR_STATUS.get(code, 502),
            content={"ok": False, "code": code, "message": message, "retryable": True},
        )
