"""V2 学习链路服务端权威上下文。

客户端只提交课程/章节/任务/Checkpoint ID；教学目标和题目输入从服务端
课程蓝图与章节学习容器反查，避免客户端伪造评分范围或 Evidence 元数据。
"""
from __future__ import annotations

import json
from typing import Any

from services.user_data_store import UserDataStore


class LearningAuthorityError(Exception):
    def __init__(self, code: str, message: str, *, status_code: int = 409, retryable: bool = False):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
        super().__init__(message)


def _find_course(account_id: str, course_id: str) -> dict[str, Any]:
    course = next(
        (item for item in UserDataStore().load_courses(account_id) if item.get("courseId") == course_id),
        None,
    )
    if not course:
        raise LearningAuthorityError("COURSE_NOT_FOUND", "课程不存在或已被删除", status_code=404)
    return course


def _find_chapter(blueprint: dict[str, Any], chapter_id: str) -> dict[str, Any]:
    chapter = next(
        (item for item in blueprint.get("chapters", []) if item.get("chapterId") == chapter_id),
        None,
    )
    if not chapter:
        raise LearningAuthorityError("CHAPTER_NOT_FOUND", "章节不存在或不属于当前课程", status_code=404)
    return chapter


def _task_content_summary(lesson: dict[str, Any], task_id: str) -> str:
    item = next(
        (
            stream_item
            for stream_item in lesson.get("streamItems", [])
            if stream_item.get("type") == "task_content" and stream_item.get("taskId") == task_id
        ),
        None,
    )
    if not item:
        raise LearningAuthorityError(
            "TASK_CONTENT_NOT_READY",
            "服务端尚未保存该任务内容，不能生成理解检查",
            status_code=409,
            retryable=True,
        )
    parts: list[str] = []
    for block in item.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "markdown":
            value = block.get("markdown")
        elif block_type == "key_point":
            value = "\n".join([
                str(block.get("title") or ""),
                *[str(point) for point in block.get("points") or []],
            ])
        elif block_type == "example":
            value = "\n".join([
                str(block.get("title") or ""),
                str(block.get("context") or ""),
                str(block.get("content") or ""),
                str(block.get("takeaway") or ""),
            ])
        else:
            value = ""
        if value.strip():
            parts.append(value.strip())
    summary = "\n\n".join(parts)[:2400].strip()
    if not summary:
        raise LearningAuthorityError("TASK_CONTENT_EMPTY", "服务端任务内容为空，不能生成理解检查")
    return summary


def authoritative_checkpoint_context(
    account_id: str,
    course_id: str,
    chapter_id: str,
    task_id: str,
) -> dict[str, Any]:
    """从服务端课程与章节容器构造 Checkpoint 输入，不采信客户端教学字段。"""
    course = _find_course(account_id, course_id)
    blueprint = course.get("blueprint") or {}
    chapter = _find_chapter(blueprint, chapter_id)
    lesson = UserDataStore().load_lesson(account_id, course_id, chapter_id)
    if not lesson:
        raise LearningAuthorityError("LESSON_NOT_FOUND", "章节学习记录不存在，请先完成当前任务", status_code=404)
    plan = lesson.get("chapterPlan") or {}
    if plan.get("chapterId") != chapter_id:
        raise LearningAuthorityError("PLAN_SCOPE_MISMATCH", "章节计划与服务端范围不一致")
    task = next((item for item in plan.get("tasks", []) if item.get("taskId") == task_id), None)
    if not task:
        raise LearningAuthorityError("TASK_NOT_FOUND", "任务不存在或不属于当前章节计划", status_code=404)
    objective_id = str(task.get("objectiveId") or "")
    if objective_id not in (chapter.get("objectiveIds") or []):
        raise LearningAuthorityError("OBJECTIVE_SCOPE_MISMATCH", "任务目标不属于当前章节")
    completed_task_ids = (lesson.get("runtime") or {}).get("completedTaskIds") or []
    is_completed = task_id in completed_task_ids
    if not is_completed:
        raise LearningAuthorityError("TASK_NOT_COMPLETED", "任务尚未完成，不能生成理解检查", retryable=True)

    objective = next(
        (item for item in blueprint.get("courseObjectives", []) if item.get("objectiveId") == objective_id),
        None,
    )
    if not objective:
        raise LearningAuthorityError("OBJECTIVE_NOT_FOUND", "课程目标不存在")

    summary = _task_content_summary(lesson, task_id)
    concept_keys = [str(key).strip() for key in task.get("conceptKeys") or [] if str(key).strip()]
    return {
        "accountId": account_id,
        "courseId": course_id,
        "chapterId": chapter_id,
        "taskId": task_id,
        "objectiveId": objective_id,
        "courseTopic": str(blueprint.get("topic") or "").strip(),
        "courseMission": blueprint.get("mission") or {},
        "chapterTitle": str(chapter.get("title") or "").strip(),
        "teachingGoal": str(chapter.get("teachingGoal") or "").strip(),
        "taskTitle": str(task.get("title") or "").strip(),
        "taskGoal": str(task.get("taskGoal") or "").strip(),
        "observableOutcome": str(task.get("observableOutcome") or objective.get("observableOutcome") or "").strip(),
        "taskConceptKeys": concept_keys,
        "taskContentSummary": summary,
        "taskContentDigest": __import__("hashlib").sha256(summary.encode("utf-8")).hexdigest()[:32],
        "planId": str(plan.get("planId") or "").strip(),
        "planVersion": int(plan.get("planVersion") or 0),
    }


def validate_checkpoint_still_current(account_id: str, meta: dict[str, Any]) -> None:
    """拒绝旧 planVersion 或已从计划中移除的任务继续产出 Evidence。"""
    course_id = str(meta.get("courseId") or "")
    chapter_id = str(meta.get("chapterId") or "")
    task_id = str(meta.get("taskId") or "")
    sealed_plan_id = str(meta.get("planId") or "")
    sealed_plan_version = int(meta.get("planVersion") or 0)
    if not all((course_id, chapter_id, task_id, sealed_plan_id, sealed_plan_version)):
        raise LearningAuthorityError("CHECKPOINT_META_INVALID", "检查题缺少服务端权威元数据")
    lesson = UserDataStore().load_lesson(account_id, course_id, chapter_id)
    if not lesson:
        raise LearningAuthorityError("LESSON_NOT_FOUND", "章节学习记录不存在", status_code=404)
    plan = lesson.get("chapterPlan") or {}
    if plan.get("planId") != sealed_plan_id or int(plan.get("planVersion") or 0) != sealed_plan_version:
        raise LearningAuthorityError("PLAN_VERSION_STALE", "章节计划已更新，请重新生成理解检查")
    task = next((item for item in plan.get("tasks", []) if item.get("taskId") == task_id), None)
    if not task:
        raise LearningAuthorityError("PLAN_VERSION_STALE", "任务已从当前章节计划中移除")
