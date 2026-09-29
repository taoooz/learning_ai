# python-agent/routers/learning_v2.py
# V2 章节学习流 API：计划、任务流、答疑、总结、检查点与调度建议。
# 服务间认证仍在 main.py 的全局中间件处理。

import json
import time
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.responses import StreamingResponse

from schemas.learning_v2 import ChapterPlanRequest, ChapterRecapRequest, TaskStreamRequest
from schemas.tutor import InlineTutorRequest
from services.chapter_plan_service import generate_chapter_plan
from services.chapter_recap_service import generate_chapter_recap, stream_chapter_recap_events
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

router = APIRouter(prefix="/api/learning/v2")


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


@router.post("/chapters/plan")
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


@router.post("/tasks/stream")
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


@router.post("/tutor/stream")
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


@router.post("/chapters/recap/stream")
async def learning_v2_chapters_recap_stream(request: Request):
    """V2 章节 Recap 流式生成：started → N×takeaway → completed → request_completed"""
    req, error_response = await _validate_learning_v2_request(request, ChapterRecapRequest)
    if error_response is not None:
        return error_response

    async def event_generator():
        try:
            async for event in stream_chapter_recap_events(req):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001 服务内部兜底，保证流一定收尾
            print(f"[Learning V2 Recap Stream] 意外异常: {exc}")
            yield f"data: {json.dumps({'eventId':'fallback:error','requestId':'req-fallback','type':'request_error','courseId':req.courseId,'chapterId':req.chapterId,'planVersion':req.planVersion,'sequence':1,'timestamp':time.time_ns() // 1_000_000,'payload':{'code':'UPSTREAM_ERROR','message':'小结服务异常，请稍后重试','retryable':True}}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'eventId':'fallback:completed','requestId':'req-fallback','type':'request_completed','courseId':req.courseId,'chapterId':req.chapterId,'planVersion':req.planVersion,'sequence':2,'timestamp':time.time_ns() // 1_000_000,'payload':{'requestId':'req-fallback'}}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/chapters/recap")
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


@router.post("/checkpoints/generate")
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
        course_id = body["courseId"]
        chapter_id = body["chapterId"]
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=422, content={
            "ok": False, "code": "INVALID_REQUEST",
            "message": f"请求参数校验失败：{exc}", "retryable": False,
        })

    from services.evidence_store import evidence_to_prompt, get_chapter_evidence

    evidence = None
    sources = None
    try:
        evidence, sources = evidence_to_prompt(get_chapter_evidence(course_id, chapter_id))
    except Exception as exc:  # noqa: BLE001 检查题不因证据读取失败阻塞
        print(f"[Learning V2 Checkpoint] 证据包读取失败: {exc}")

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
            evidence=evidence,
            sources=sources,
        )
        return {"ok": True, "checkpoint": checkpoint.model_dump()}
    except Exception as exc:  # noqa: BLE001
        code, message = classify_llm_error(exc)
        print(f"[Learning V2 Checkpoint] 生成失败 code={code}: {exc}")
        return JSONResponse(
            status_code=LLM_ERROR_STATUS.get(code, 502),
            content={"ok": False, "code": code, "message": message, "retryable": True},
        )


@router.post("/checkpoints/evaluate")
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


@router.post("/checkpoints/remediate")
async def learning_v2_checkpoints_remediate(request: Request):
    """P3a 补救内容生成：LLM 生成补救段落 + 等价不同题的新检查"""
    from services.checkpoint_service import generate_remediation
    from services.evidence_store import evidence_to_prompt, get_chapter_evidence

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

    evidence = None
    sources = None
    try:
        evidence, sources = evidence_to_prompt(
            get_chapter_evidence(body.get("courseId"), body.get("chapterId"))
        )
    except Exception as exc:  # noqa: BLE001 补救不因证据读取失败阻塞
        print(f"[Learning V2 Checkpoint Remediate] 证据包读取失败: {exc}")

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
            evidence=evidence,
            sources=sources,
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


@router.post("/plan-patch/generate")
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
