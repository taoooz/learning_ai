# python-agent/routers/learning_v2.py
# V2 章节学习流 API：计划、任务流、答疑、总结、检查点与调度建议。
# 服务间认证仍在 main.py 的全局中间件处理。

import hashlib
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
from services.memory_v4_store import (
    CourseMemoryDeleted,
    EvidenceAttemptOrderConflict,
    EvidenceIdempotencyConflict,
    MemoryV4Store,
)
from services.memory_context_v4 import safe_resolve_memory_context
from services.learning_v2_authority import (
    LearningAuthorityError,
    authoritative_checkpoint_context,
    validate_checkpoint_still_current,
)

# 连续补救轮次上限（规格：最多连续两轮，不伪造掌握）
MAX_REMEDIATION_ROUNDS = 2

router = APIRouter(prefix="/api/learning/v2")


def _account_from_request(request: Request) -> str | None:
    return request.headers.get("X-Account-Id")


def _unauthorized():
    return JSONResponse(status_code=401, content={
        "ok": False, "code": "UNAUTHORIZED", "message": "缺少账户身份", "retryable": False,
    })


def _stable_evidence_key(
    account_id: str,
    checkpoint_id: str,
    attempt: int,
    answer: str | list[str],
    evaluation_version: str,
) -> str:
    payload = json.dumps(
        {"account": account_id, "checkpoint": checkpoint_id, "attempt": attempt, "answer": answer, "evaluator": evaluation_version},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _learning_v2_invalid_request(message: str):
    """V2 学习流请求参数/数据校验失败的 422 响应体"""
    return JSONResponse(
        status_code=422,
        content={"ok": False, "code": "INVALID_REQUEST", "message": message, "retryable": False},
    )


def _learning_authority_error_response(exc: LearningAuthorityError):
    return JSONResponse(status_code=exc.status_code, content={
        "ok": False,
        "code": exc.code,
        "message": exc.message,
        "retryable": exc.retryable,
    })


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
    """V2 章节计划生成（同步 JSON）：按认知增量拆成 2～7 个短任务"""
    req, error_response = await _validate_learning_v2_request(request, ChapterPlanRequest)
    if error_response is not None:
        return error_response

    try:
        memory_context = None
        account = _account_from_request(request)
        if account:
            blueprint = req.blueprint or {}
            chapter = next((item for item in blueprint.get("chapters", []) if item.get("chapterId") == req.chapterId), {})
            objective_ids = set(chapter.get("objectiveIds") or [])
            concept_keys = [
                key for objective in (blueprint.get("courseObjectives") or [])
                if objective.get("objectiveId") in objective_ids
                for key in (objective.get("conceptKeys") or [])
            ]
            memory_context = safe_resolve_memory_context(MemoryV4Store(), account, {
                "scene": "chapter_planning",
                "courseId": req.courseId,
                "topic": blueprint.get("topic", ""),
                "conceptKeys": concept_keys,
                "queryText": chapter.get("teachingGoal", ""),
            })
        plan = await generate_chapter_plan(req, memory_context=memory_context)
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

    account = _account_from_request(request)
    memory_context = None
    if account:
        memory_context = safe_resolve_memory_context(MemoryV4Store(), account, {
            "scene": "task_teaching",
            "courseId": req.courseId,
            "topic": req.courseTopic,
            "conceptKeys": req.task.conceptKeys,
            "queryText": f"{req.chapter.teachingGoal} {req.task.taskGoal}",
        })

    async def event_generator():
        fallback_request_id = f"req-{uuid4().hex[:12]}"
        try:
            async for event in stream_task_events(req, memory_context=memory_context):
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

    account = _account_from_request(request)
    memory_context = None
    if account:
        memory_context = safe_resolve_memory_context(MemoryV4Store(), account, {
            "scene": "chat",
            "courseId": req.courseId,
            "topic": req.courseTopic,
            "queryText": req.question.text,
        })

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
            async for event in stream_tutor_events(req, chapter_id, plan_version, memory_context=memory_context):
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
    account = _account_from_request(request)

    async def event_generator():
        try:
            async for event in stream_chapter_recap_events(req):
                if account and event.get("type") == "recap_completed":
                    recap = (event.get("payload") or {}).get("recap")
                    if isinstance(recap, dict):
                        try:
                            MemoryV4Store().save_chapter_recap_snapshot(
                                account,
                                course_id=req.courseId,
                                chapter_id=req.chapterId,
                                topic=req.courseTopic,
                                chapter_title=req.chapter.title,
                                teaching_goal=req.chapter.teachingGoal,
                                recap=recap,
                            )
                        except Exception as exc:  # noqa: BLE001
                            print(f"[Learning V2 Recap] snapshot save failed: {exc}")
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
    """P3a 生成结构化 Checkpoint：教学范围只从服务端权威数据反查。"""
    from schemas.checkpoint import CheckpointGenerateRequest
    from schemas.checkpoint import CheckpointDefinitionModel
    from services.checkpoint_service import generate_checkpoint

    account = _account_from_request(request)
    if not account:
        return _unauthorized()

    try:
        body = await request.json()
        req = CheckpointGenerateRequest(**body)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=422, content={
            "ok": False, "code": "INVALID_REQUEST",
            "message": f"请求参数校验失败：{exc}", "retryable": False,
        })

    try:
        context = authoritative_checkpoint_context(
            account,
            req.courseId,
            req.chapterId,
            req.taskId,
        )
    except LearningAuthorityError as exc:
        return _learning_authority_error_response(exc)

    course_topic = context["courseTopic"]
    chapter_title = context["chapterTitle"]
    teaching_goal = context["teachingGoal"]
    task_id = context["taskId"]
    task_title = context["taskTitle"]
    task_goal = context["taskGoal"]
    objective_id = context["objectiveId"]
    task_content_summary = context["taskContentSummary"]
    course_id = context["courseId"]
    chapter_id = context["chapterId"]

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
            course_mission=context.get("courseMission"),
            evidence=evidence,
            sources=sources,
        )
        checkpoint.conceptKeys = context.get("taskConceptKeys") or [objective_id]

        meta = {
            **context,
            "generationIdempotencyKey": req.idempotencyKey,
        }
        try:
            MemoryV4Store().save_checkpoint_definition(account, checkpoint.model_dump(), meta)
        except CourseMemoryDeleted:
            return JSONResponse(status_code=410, content={
                "ok": False, "code": "COURSE_DELETED",
                "message": "课程已删除，不能继续生成检查题", "retryable": False,
            })
        return {"ok": True, "checkpoint": MemoryV4Store.sanitize_checkpoint_definition(checkpoint.model_dump())}
    except Exception as exc:  # noqa: BLE001
        code, message = classify_llm_error(exc)
        print(f"[Learning V2 Checkpoint] 生成失败 code={code}: {exc}")
        return JSONResponse(
            status_code=LLM_ERROR_STATUS.get(code, 502),
            content={"ok": False, "code": code, "message": message, "retryable": True},
        )


@router.post("/checkpoints/evaluate")
async def learning_v2_checkpoints_evaluate(request: Request):
    """Checkpoint 判分：题目定义由服务端持有，判分成功后立即追加 Evidence。"""
    from schemas.checkpoint import CheckpointEvaluateRequest
    from schemas.checkpoint import CheckpointDefinitionModel
    from services.checkpoint_service import evaluate_checkpoint

    account = _account_from_request(request)
    if not account:
        return _unauthorized()

    try:
        body = await request.json()
        req = CheckpointEvaluateRequest(**body)
        store = MemoryV4Store()
        sealed = store.load_checkpoint(account, req.checkpointId)
        if not sealed:
            return JSONResponse(status_code=404, content={
                "ok": False, "code": "CHECKPOINT_NOT_FOUND",
                "message": "检查题定义不存在或已失效，请重新生成", "retryable": True,
            })
        meta = sealed.get("meta") or {}
        try:
            validate_checkpoint_still_current(account, meta)
        except LearningAuthorityError as exc:
            return _learning_authority_error_response(exc)
        if not meta.get("courseTopic") or not meta.get("planVersion"):
            return JSONResponse(status_code=403, content={
                "ok": False, "code": "CHECKPOINT_META_INVALID",
                "message": "检查题缺少服务端权威范围", "retryable": False,
            })
        definition = CheckpointDefinitionModel(**sealed["definition"])
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=422, content={
            "ok": False, "code": "INVALID_REQUEST",
            "message": f"请求参数校验失败：{exc}", "retryable": False,
        })

    rows = store.load_evidence(account)
    existing = next(
        (row for row in rows if row.get("idempotencyKey") == req.idempotencyKey),
        None,
    )
    if existing and existing.get("checkpointId") != req.checkpointId:
        return JSONResponse(status_code=409, content={
            "ok": False, "code": "IDEMPOTENCY_CONFLICT",
            "message": "幂等键已绑定其他检查题", "retryable": False,
        })
    if existing:
        attempt = int(existing.get("attempt") or 1)
    else:
        attempts = [
            int(row.get("attempt") or 0)
            for row in rows
            if row.get("checkpointId") == req.checkpointId and not row.get("invalidReason")
        ]
        attempt = max(attempts, default=0) + 1
    if attempt > 3:
        return JSONResponse(status_code=409, content={
            "ok": False, "code": "ATTEMPT_EXHAUSTED",
            "message": "本题已达到最大尝试次数，请继续学习或重新生成检查题", "retryable": False,
        })

    # P3b：开放式题型路由 LLM Rubric 评分
    # 回归样本一致率 83% ≥ 80% 阈值（2026-09-19 达标），默认启用；env 置 falsy 可紧急关闭
    import os
    evaluator = "rule"
    evaluation_version = "checkpoint-rule-v1"
    if definition.kind in ("self_explanation", "micro_practice"):
        if os.getenv("ENABLE_OPEN_ENDED_CHECKPOINTS", "true").lower() not in ("0", "false", "no"):
            from services.checkpoint_service import evaluate_open_ended
            evaluation = await evaluate_open_ended(definition, str(req.answer))
            evaluator = "model"
            evaluation_version = "checkpoint-open-v1"
        else:
            return JSONResponse(status_code=422, content={
                "ok": False, "code": "OPEN_ENDED_DISABLED",
                "message": "开放式题型尚未启用（回归验证未通过或未开启）", "retryable": False,
            })
    else:
        evaluation = evaluate_checkpoint(definition, req.answer, attempt)

    # 低置信模型评估不能让不确定结果进入长期证据账本。
    if evaluator == "model" and evaluation.confidence < 0.5:
        store = MemoryV4Store()
        return {
            "ok": True,
            "evaluation": evaluation.model_dump(),
            "evidenceId": None,
            "memoryRevision": store.load_store(account).get("revision", 0),
            "evidenceSkipped": True,
            "evidenceSkipReason": "LOW_CONFIDENCE",
        }

    now = int(time.time() * 1000)
    evidence_key = _stable_evidence_key(account, req.checkpointId, attempt, req.answer, evaluation_version)
    remediation_id = meta.get("remediationId")
    evidence = {
        "evidenceId": f"ev-{evidence_key[:16]}",
        "evidenceKey": evidence_key,
        "idempotencyKey": req.idempotencyKey,
        "accountId": account,
        "protocolVersion": 4,
        "courseId": meta.get("courseId"),
        "chapterId": meta.get("chapterId"),
        "courseTopic": meta.get("courseTopic"),
        "topic": meta.get("courseTopic"),
        "objectiveId": definition.objectiveId,
        "conceptKeys": definition.conceptKeys or [definition.objectiveId],
        "taskId": meta.get("taskId"),
        "checkpointId": req.checkpointId,
        "remediationId": remediation_id,
        "kind": definition.kind,
        "outcome": evaluation.outcome,
        "strength": "strong" if definition.kind in ("self_explanation", "micro_practice") and evaluation.confidence >= 0.8 else "moderate",
        "score": evaluation.score,
        "confidence": evaluation.confidence,
        "attempt": attempt,
        "hintLevel": "none" if attempt == 1 else "light",
        "isRemediationAttempt": bool(remediation_id),
        "sourceItemId": req.checkpointId,
        "planVersion": int(meta.get("planVersion") or 0),
        "evaluator": evaluator,
        "evaluationVersion": evaluation_version,
        "answerDigest": hashlib.sha256(json.dumps(req.answer, ensure_ascii=False).encode("utf-8")).hexdigest()[:24],
        "misconceptionCodes": [] if evaluation.correct else [str(evaluation.feedback)[:120]],
        "createdAt": now,
    }
    store = MemoryV4Store()
    try:
        result = store.append_evidence(account, evidence)
    except CourseMemoryDeleted:
        return JSONResponse(status_code=410, content={
            "ok": False, "code": "COURSE_DELETED",
            "message": "课程已删除，检查结果不会写入学习记录", "retryable": False,
        })
    except EvidenceIdempotencyConflict as exc:
        return JSONResponse(status_code=409, content={
            "ok": False, "code": "IDEMPOTENCY_CONFLICT",
            "message": str(exc), "retryable": False,
        })
    except EvidenceAttemptOrderConflict as exc:
        return JSONResponse(status_code=409, content={
            "ok": False, "code": "ATTEMPT_ORDER_CONFLICT",
            "message": "该检查题已有并发提交，请刷新后重试", "retryable": True,
        })
    if remediation_id:
        outcome = "helped" if evaluation.outcome == "demonstrated" else "partially_helped" if evaluation.outcome == "partial" else "not_helped"
        store.update_remediation_after_evidence(account, str(remediation_id), evidence["evidenceId"], outcome)
    return {
        "ok": True,
        "evaluation": evaluation.model_dump(),
        "evidenceId": result["evidence"].get("evidenceId"),
        "memoryRevision": result["store"].get("revision", 0),
    }


@router.post("/checkpoints/remediate")
async def learning_v2_checkpoints_remediate(request: Request):
    """P3a 补救内容生成：LLM 生成补救段落 + 等价不同题的新检查"""
    from schemas.checkpoint import CheckpointRemediateRequest
    from schemas.checkpoint import CheckpointDefinitionModel
    from services.checkpoint_service import generate_remediation
    from services.evidence_store import evidence_to_prompt, get_chapter_evidence

    account = _account_from_request(request)
    if not account:
        return _unauthorized()

    try:
        body = await request.json()
        req = CheckpointRemediateRequest(**body)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=422, content={
            "ok": False, "code": "INVALID_REQUEST",
            "message": "缺少必填字段或包含非法字段：必须提供 checkpointId、userAnswer、idempotencyKey", "retryable": False,
        })

    store = MemoryV4Store()
    sealed = store.load_checkpoint(account, req.checkpointId)
    if not sealed:
        return JSONResponse(status_code=404, content={
            "ok": False, "code": "CHECKPOINT_NOT_FOUND",
            "message": "检查题定义不存在或已失效，请重新生成", "retryable": True,
        })
    definition = CheckpointDefinitionModel(**sealed["definition"])
    meta = sealed.get("meta") or {}
    try:
        validate_checkpoint_still_current(account, meta)
    except LearningAuthorityError as exc:
        return _learning_authority_error_response(exc)
    task_content_summary = str(meta.get("taskContentSummary") or "").strip()
    if not task_content_summary:
        return JSONResponse(status_code=409, content={
            "ok": False, "code": "CHECKPOINT_META_INVALID",
            "message": "检查题缺少服务端任务内容，请重新生成", "retryable": True,
        })
    before_evidence = store.latest_evidence_for_checkpoint(account, req.checkpointId)
    if not before_evidence:
        return JSONResponse(status_code=409, content={
            "ok": False, "code": "EVIDENCE_NOT_FOUND",
            "message": "尚未找到本次检查的评估证据，无法进入补救", "retryable": True,
        })
    # 只有未达标（partial / not_demonstrated）才允许补救；答对后请求补救属于客户端误用
    if str(before_evidence.get("outcome") or "") == "demonstrated":
        return JSONResponse(status_code=409, content={
            "ok": False, "code": "REMEDIATION_NOT_NEEDED",
            "message": "本次检查已达标，无需补救", "retryable": False,
        })
    # 在调用 LLM 之前封顶，避免浪费生成预算。
    # 注意：补救链每轮换新题 ID，须按整条链计数；命名仍按单题轮次（与前端一致）。
    next_round = store.next_remediation_round(account, req.checkpointId)
    if store.remediation_chain_depth(account, req.checkpointId) >= MAX_REMEDIATION_ROUNDS:
        return JSONResponse(status_code=409, content={
            "ok": False, "code": "REMEDIATION_LIMIT",
            "message": f"补救已达上限（{MAX_REMEDIATION_ROUNDS} 轮），请继续后续学习", "retryable": False,
        })

    evidence = None
    sources = None
    try:
        evidence, sources = evidence_to_prompt(
            get_chapter_evidence(meta.get("courseId"), meta.get("chapterId"))
        )
    except Exception as exc:  # noqa: BLE001 补救不因证据读取失败阻塞
        print(f"[Learning V2 Checkpoint Remediate] 证据包读取失败: {exc}")

    try:
        result = await generate_remediation(
            course_topic=meta.get("courseTopic", ""),
            chapter_title=meta.get("chapterTitle", ""),
            task_id=meta.get("taskId", ""),
            task_title=meta.get("taskTitle", ""),
            task_goal=meta.get("taskGoal", ""),
            original_prompt=definition.prompt,
            user_answer=req.userAnswer,
            correct_answer=str(definition.correctAnswer),
            original_hint=definition.remediationHint,
            task_content_summary=task_content_summary,
            evidence=evidence,
            sources=sources,
        )
        round_number = next_round
        new_checkpoint_id = f"{definition.checkpointId}-r{round_number}"
        remediation_id = f"rem-{definition.checkpointId}-{round_number}"
        new_definition = CheckpointDefinitionModel(
            checkpointId=new_checkpoint_id,
            objectiveId=definition.objectiveId,
            taskId=definition.taskId,
            conceptKeys=definition.conceptKeys,
            kind=result["newCheckpoint"]["kind"],
            prompt=result["newCheckpoint"]["prompt"],
            rubric=result["newCheckpoint"].get("rubric"),
            options=result["newCheckpoint"].get("options"),
            sequenceItems=result["newCheckpoint"].get("sequenceItems"),
            correctAnswer=result["newCheckpoint"]["correctAnswer"],
            remediationHint=result["newCheckpoint"]["remediationHint"],
            estimatedSeconds=45,
            sourceRefs=result["newCheckpoint"].get("sourceRefs") or [],
        )
        new_meta = {
            **meta,
            "remediationId": remediation_id,
            "remediationRound": round_number,
            "previousCheckpointId": definition.checkpointId,
        }
        store.save_checkpoint_definition(account, new_definition.model_dump(), new_meta)
        store.append_remediation(account, {
            "remediationId": remediation_id,
            "accountId": account,
            "originCheckpointId": definition.checkpointId,
            "idempotencyKey": req.idempotencyKey,
            "conceptKeys": definition.conceptKeys or [definition.objectiveId],
            "triggerEvidenceId": before_evidence.get("evidenceId"),
            "beforeEvidenceId": before_evidence.get("evidenceId"),
            "afterEvidenceId": None,
            "strategyKey": "llm-remediation-v1",
            "strategyVersion": "1",
            "round": round_number,
            "outcome": "pending",
            "createdAt": int(time.time() * 1000),
        })
        return {
            "ok": True,
            "remediationContent": result["remediationContent"],
            "newCheckpoint": store.sanitize_checkpoint_definition(new_definition.model_dump()),
            "remediationId": remediation_id,
        }
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
