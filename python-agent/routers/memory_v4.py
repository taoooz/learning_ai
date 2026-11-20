"""Memory V4 用户 API：画像导入、Episode、摘要、删除和场景上下文。"""
import asyncio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from services.memory_v4_store import MemoryV4Store
from services.memory_context_v4 import resolve_memory_context
from services.memory_summary_service import rebuild_learning_summary
from services.chat_memory_service import build_server_chat_summary
from services.user_data_store import OptimisticLockConflict

router = APIRouter(prefix="/api/user/memory")


def _store() -> MemoryV4Store:
    return MemoryV4Store()


def _account(request: Request) -> str | None:
    return request.headers.get("X-Account-Id")


def _unauthorized() -> JSONResponse:
    return JSONResponse(status_code=401, content={
        "ok": False, "code": "UNAUTHORIZED", "message": "缺少账户身份", "retryable": False,
    })


@router.get("")
async def memory_get(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    store = _store().load_store(account)
    return {"ok": True, "store": store}


@router.post("/profile-ingest")
async def memory_profile_ingest(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    try:
        body = await request.json()
        profile = body.get("profile")
        if not isinstance(profile, dict):
            return JSONResponse(status_code=422, content={
                "ok": False, "code": "INVALID_REQUEST", "message": "缺少 profile", "retryable": False,
            })
        result = _store().ingest_profile(account, profile)
        return {
            "ok": True,
            "changed": result["changed"],
            "ingestion": result["ingestion"],
            "revision": result["store"].get("revision", 0),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"[MemoryV4] profile ingestion failed: {exc}")
        return JSONResponse(status_code=500, content={
            "ok": False, "code": "STORAGE_ERROR", "message": "画像记忆导入失败", "retryable": True,
        })


@router.get("/profile")
async def memory_profile_get(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    return {"ok": True, "profile": _store().load_profile(account)}


@router.post("/context")
async def memory_context(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    try:
        body = await request.json()
        scene = body.get("scene")
        topic = str(body.get("topic") or "")
        focus = str(body.get("focus") or "")
        course_id = body.get("courseId")
        table = _store()
        if scene not in {"course_planning", "chapter_planning", "task_teaching", "chat", "review", "checkpoint_generation", "checkpoint_evaluation"}:
            return JSONResponse(status_code=422, content={
                "ok": False, "code": "INVALID_SCENE", "message": "不支持的 Memory 场景", "retryable": False,
            })
        context = resolve_memory_context(table, account, {
            "scene": scene,
            "topic": topic,
            "courseId": course_id,
            "conceptKeys": body.get("conceptKeys") or [],
            "queryText": focus or body.get("queryText") or "",
        })
        return {"ok": True, "scene": scene, "context": context}
    except Exception as exc:  # noqa: BLE001
        print(f"[MemoryV4] context failed: {exc}")
        return JSONResponse(status_code=500, content={
            "ok": False, "code": "MEMORY_CONTEXT_ERROR", "message": "Memory 上下文生成失败", "retryable": True,
        })


@router.delete("/records/{memory_id}")
async def memory_record_delete(memory_id: str, request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    reason = request.query_params.get("reason") or "user_forget"
    try:
        result = _store().tombstone_record(account, memory_id, reason)
        return {"ok": True, "tombstone": result["tombstone"], "revision": result["store"].get("revision", 0)}
    except Exception as exc:  # noqa: BLE001
        print(f"[MemoryV4] delete failed: {exc}")
        return JSONResponse(status_code=500, content={
            "ok": False, "code": "STORAGE_ERROR", "message": "记忆删除失败", "retryable": True,
        })


@router.patch("/records/{memory_id}")
async def memory_record_patch(memory_id: str, request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    try:
        body = await request.json()
        patch = body.get("patch")
        if not isinstance(patch, dict):
            return JSONResponse(status_code=422, content={
                "ok": False, "code": "INVALID_REQUEST", "message": "缺少 patch", "retryable": False,
            })
        result = _store().update_record(account, memory_id, patch)
        if result is None:
            return JSONResponse(status_code=404, content={
                "ok": False, "code": "MEMORY_NOT_FOUND", "message": "记忆不存在或已删除", "retryable": False,
            })
        return {
            "ok": True,
            "record": result["record"],
            "revision": result["store"].get("revision", 0),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"[MemoryV4] update failed: {exc}")
        return JSONResponse(status_code=500, content={
            "ok": False, "code": "STORAGE_ERROR", "message": "记忆更新失败", "retryable": True,
        })


@router.post("/chat-summary")
async def memory_chat_summary_post(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    try:
        body = await request.json()
        course_id = body.get("courseId")
        if not course_id:
            return JSONResponse(status_code=422, content={
                "ok": False, "code": "INVALID_REQUEST", "message": "缺少 courseId", "retryable": False,
            })
        store = _store()
        summary = build_server_chat_summary(store, account, str(course_id))
        if not summary:
            return JSONResponse(status_code=409, content={
                "ok": False,
                "code": "CHAT_TRANSCRIPT_EMPTY",
                "message": "尚无可生成摘要的服务端对话记录",
                "retryable": True,
            })
        result = store.upsert_chat_summary(account, str(course_id), summary)
        return {
            "ok": True,
            "summary": summary,
            "revision": result["store"].get("revision", 0),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"[MemoryV4] chat summary failed: {exc}")
        return JSONResponse(status_code=500, content={
            "ok": False, "code": "STORAGE_ERROR", "message": "对话摘要保存失败", "retryable": True,
        })


@router.get("/chat-summary")
async def memory_chat_summary_get(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    course_id = request.query_params.get("courseId")
    if not course_id:
        return JSONResponse(status_code=422, content={
            "ok": False, "code": "INVALID_REQUEST", "message": "缺少 courseId", "retryable": False,
        })
    return {"ok": True, "summary": _store().get_chat_summary(account, course_id)}


@router.get("/topics")
async def memory_topics_get(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    store = _store().load_store(account)
    topic_states = (store.get("projections") or {}).get("topicStates", [])
    return {
        "ok": True,
        "topics": [
            {"topic": state.get("topic"), "confidence": state.get("confidence", 0)}
            for state in topic_states[:5]
        ],
    }


@router.get("/candidates")
async def memory_candidates_get(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    return {"ok": True, "candidates": _store().load_candidates(account)}


@router.post("/consolidate")
async def memory_consolidate_post(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    try:
        result = _store().consolidate_candidates(account)
        return {
            "ok": True,
            "applied": result["applied"],
            "rejected": result["rejected"],
            "pending": result["pending"],
            "revision": result["store"].get("revision", 0),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"[MemoryV4] consolidate failed: {exc}")
        return JSONResponse(status_code=500, content={
            "ok": False, "code": "STORAGE_ERROR", "message": "Memory 整理失败", "retryable": True,
        })


@router.post("/chapter-episode")
async def memory_chapter_episode_post(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    try:
        body = await request.json()
        required = ["courseId", "chapterId"]
        missing = [key for key in required if not body.get(key)]
        if missing:
            return JSONResponse(status_code=422, content={
                "ok": False, "code": "INVALID_REQUEST",
                "message": f"缺少必填字段：{', '.join(missing)}", "retryable": False,
            })
        store = _store()
        snapshot = store.load_chapter_recap_snapshot(
            account,
            str(body["courseId"]),
            str(body["chapterId"]),
        )
        if not snapshot:
            return JSONResponse(status_code=404, content={
                "ok": False,
                "code": "RECAP_SNAPSHOT_NOT_FOUND",
                "message": "未找到服务端章节小结快照，本次不写入章节经验",
                "retryable": True,
            })
        result = store.upsert_chapter_episode(
            account,
            course_id=str(snapshot["courseId"]),
            chapter_id=str(snapshot["chapterId"]),
            topic=str(snapshot.get("topic") or ""),
            chapter_title=str(snapshot.get("chapterTitle") or ""),
            teaching_goal=str(snapshot.get("teachingGoal") or ""),
            recap=snapshot.get("recap") if isinstance(snapshot.get("recap"), dict) else {},
        )
        if result.get("episode") is None:
            return {
                "ok": True,
                "skipped": True,
                "reason": "tombstoned_by_user",
                "revision": result["store"].get("revision", 0),
            }

        async def rebuild_summary_background():
            try:
                await rebuild_learning_summary(store, account)
            except Exception as exc:  # noqa: BLE001
                print(f"[MemorySummary] background rebuild failed: {exc}")

        asyncio.get_running_loop().create_task(rebuild_summary_background())
        return {
            "ok": True,
            "episodeId": result["episode"].get("memoryId"),
            "revision": result["store"].get("revision", 0),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"[MemoryV4] chapter episode failed: {exc}")
        return JSONResponse(status_code=500, content={
            "ok": False, "code": "STORAGE_ERROR", "message": "章节经验保存失败", "retryable": True,
        })


@router.post("/summary/rebuild")
async def memory_summary_rebuild(request: Request):
    account = _account(request)
    if not account:
        return _unauthorized()
    try:
        summary = await rebuild_learning_summary(_store(), account)
        return {"ok": True, "summary": summary}
    except Exception as exc:  # noqa: BLE001
        print(f"[MemorySummary] manual rebuild failed: {exc}")
        return JSONResponse(status_code=500, content={
            "ok": False, "code": "SUMMARY_ERROR", "message": "学习摘要生成失败", "retryable": True,
        })
