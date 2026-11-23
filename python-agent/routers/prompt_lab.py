"""Course Prompt Lab 调试路由。"""
from fastapi import APIRouter
from starlette.responses import StreamingResponse

from schemas.prompt_lab import PromptLabCompileRequest, PromptLabRunRequest
from services.prompt_lab_service import compile_prompt_lab_stage, run_prompt_lab_stream


router = APIRouter(prefix="/api/debug/course-pipeline", tags=["prompt-lab"])


@router.post("/compile")
async def compile_prompt(req: PromptLabCompileRequest):
    return compile_prompt_lab_stage(req.stage, req.inputs)


@router.post("/run")
async def run_prompt(req: PromptLabRunRequest):
    def event_generator():
        yield from run_prompt_lab_stream(req)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
