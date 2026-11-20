# python-agent/routers/user_data.py
# P5.1 服务端用户数据 API：课程 / 章节学习容器 / 参与信号。
# 身份由 Next 代理注入 X-Account-Id；服务间认证仍在 main.py 的全局中间件处理。

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from services.user_data_store import OptimisticLockConflict, UserDataStore

router = APIRouter(prefix="/api/user")


def _get_user_store() -> UserDataStore:
    return UserDataStore()


def _account_id_from_request(request: Request) -> str | None:
    return request.headers.get("X-Account-Id")


@router.get("/courses")
async def user_courses_get(request: Request):
    account = _account_id_from_request(request)
    if not account:
        return JSONResponse(status_code=401, content={"ok": False, "code": "UNAUTHORIZED", "message": "缺少账户身份", "retryable": False})
    return {"ok": True, "courses": _get_user_store().load_courses(account)}


@router.post("/courses")
async def user_courses_post(request: Request):
    account = _account_id_from_request(request)
    if not account:
        return JSONResponse(status_code=401, content={"ok": False, "code": "UNAUTHORIZED", "message": "缺少账户身份", "retryable": False})
    try:
        body = await request.json()
        courses = body.get("courses")
        if not isinstance(courses, list):
            return JSONResponse(status_code=422, content={"ok": False, "code": "INVALID_REQUEST", "message": "courses 必须是数组", "retryable": False})
        _get_user_store().save_courses(account, courses)
        return {"ok": True, "count": len(courses)}
    except Exception as exc:  # noqa: BLE001
        print(f"[UserDataStore] courses 保存失败: {exc}")
        return JSONResponse(status_code=500, content={"ok": False, "code": "STORAGE_ERROR", "message": "课程数据保存失败", "retryable": True})


@router.delete("/courses")
async def user_courses_delete(request: Request):
    account = _account_id_from_request(request)
    if not account:
        return JSONResponse(status_code=401, content={"ok": False, "code": "UNAUTHORIZED", "message": "缺少账户身份", "retryable": False})
    course_id = request.query_params.get("courseId")
    if not course_id:
        return JSONResponse(status_code=422, content={"ok": False, "code": "INVALID_REQUEST", "message": "缺少 courseId", "retryable": False})
    try:
        existed = _get_user_store().delete_course(account, course_id)
        return {"ok": True, "existed": existed}
    except Exception as exc:  # noqa: BLE001
        print(f"[UserDataStore] course delete failed: {exc}")
        return JSONResponse(status_code=503, content={
            "ok": False, "code": "DELETE_INCOMPLETE",
            "message": "课程数据尚未完整删除，请稍后重试", "retryable": True,
        })


@router.get("/lessons")
async def user_lesson_get(request: Request):
    account = _account_id_from_request(request)
    if not account:
        return JSONResponse(status_code=401, content={"ok": False, "code": "UNAUTHORIZED", "message": "缺少账户身份", "retryable": False})
    course_id = request.query_params.get("courseId")
    chapter_id = request.query_params.get("chapterId")
    if not course_id or not chapter_id:
        return JSONResponse(status_code=422, content={"ok": False, "code": "INVALID_REQUEST", "message": "缺少 courseId/chapterId", "retryable": False})
    lesson = _get_user_store().load_lesson(account, course_id, chapter_id)
    return {"ok": True, "lesson": lesson}


@router.put("/lessons")
async def user_lesson_put(request: Request):
    account = _account_id_from_request(request)
    if not account:
        return JSONResponse(status_code=401, content={"ok": False, "code": "UNAUTHORIZED", "message": "缺少账户身份", "retryable": False})
    try:
        body = await request.json()
        course_id = body.get("courseId")
        chapter_id = body.get("chapterId")
        lesson = body.get("lesson")
        expect_at = body.get("expectUpdatedAt")
        if not course_id or not chapter_id or not isinstance(lesson, dict):
            return JSONResponse(status_code=422, content={"ok": False, "code": "INVALID_REQUEST", "message": "缺少 courseId/chapterId/lesson", "retryable": False})
        result = _get_user_store().save_lesson(
            account, course_id, chapter_id, lesson,
            expect_updated_at=int(expect_at) if isinstance(expect_at, (int, float)) else None,
        )
        return {"ok": True, **result}
    except OptimisticLockConflict as exc:
        return JSONResponse(status_code=409, content={
            "ok": False, "code": "CONFLICT",
            "message": "服务端数据比本地更新（可能在其他设备有改动）",
            "retryable": False, "serverUpdatedAt": exc.server_updated_at,
        })
    except Exception as exc:  # noqa: BLE001
        print(f"[UserDataStore] lesson 保存失败: {exc}")
        return JSONResponse(status_code=500, content={"ok": False, "code": "STORAGE_ERROR", "message": "学习数据保存失败", "retryable": True})


@router.post("/engagement")
async def user_engagement_post(request: Request):
    account = _account_id_from_request(request)
    if not account:
        return JSONResponse(status_code=401, content={"ok": False, "code": "UNAUTHORIZED", "message": "缺少账户身份", "retryable": False})
    try:
        body = await request.json()
        course_id = body.get("courseId")
        events = body.get("events")
        if not course_id or not isinstance(events, list):
            return JSONResponse(status_code=422, content={"ok": False, "code": "INVALID_REQUEST", "message": "缺少 courseId/events", "retryable": False})
        count = _get_user_store().append_engagement(account, course_id, events)
        return {"ok": True, "count": count}
    except Exception as exc:  # noqa: BLE001
        print(f"[UserDataStore] engagement 追加失败: {exc}")
        return JSONResponse(status_code=500, content={"ok": False, "code": "STORAGE_ERROR", "message": "参与信号写入失败", "retryable": True})
