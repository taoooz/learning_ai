"""Course Prompt Lab 调试路由。"""
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.responses import StreamingResponse

from schemas.prompt_lab import PromptLabCompileRequest, PromptLabRunRequest
from services.memory_context_v4 import safe_resolve_memory_context, to_planning_prompt_payload
from services.memory_v4_store import MemoryV4Store
from services.prompt_lab_service import compile_prompt_lab_stage, run_prompt_lab_stream


def _require_prompt_lab_enabled() -> None:
    """与 BFF 同语义的纵深防御门禁：非 production 默认开放，production 需显式 ENABLE_PROMPT_DEBUGGER=1。

    BFF（lib/prompt-lab/config.ts）已有同款检查；此处保证 Python 服务被直连时
    生产环境也不能读取真实 Memory 或运行生产 prompt。生产部署须设置 ENV=production。
    """
    enabled = (
        os.getenv("ENABLE_PROMPT_DEBUGGER", "") == "1"
        or os.getenv("ENV", "development") != "production"
    )
    if not enabled:
        raise HTTPException(status_code=404, detail="Prompt Lab 未启用")


router = APIRouter(
    prefix="/api/debug/course-pipeline",
    tags=["prompt-lab"],
    dependencies=[Depends(_require_prompt_lab_enabled)],
)



@router.post("/memory-snapshot")
async def memory_snapshot(request: Request):
    """只读返回正式 Memory V4 在课程规划场景下会使用的画像与 planning payload。"""
    account = request.headers.get("X-Account-Id")
    if not account:
        return JSONResponse(status_code=401, content={"ok": False, "message": "缺少账户标识"})
    body = await request.json()
    topic = str(body.get("topic") or "")
    store = MemoryV4Store()
    context = safe_resolve_memory_context(store, account, {
        "scene": "course_planning",
        "topic": topic,
    })
    if not context:
        return {"ok": True, "source": "unavailable", "userProfile": None, "planningMemory": {}}
    planning = to_planning_prompt_payload(store, account, context)
    return {
        "ok": True,
        "source": "server_memory_v4",
        "userProfile": planning.get("userProfile") or {},
        "planningMemory": planning.get("planningMemory") or {},
    }


@router.post("/compile")
async def compile_prompt(req: PromptLabCompileRequest):
    return compile_prompt_lab_stage(req.stage, req.inputs)


@router.post("/run")
async def run_prompt(req: PromptLabRunRequest, request: Request):
    account = request.headers.get("X-Account-Id")

    def event_generator():
        yield from run_prompt_lab_stream(req, account_id=account)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
