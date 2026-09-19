"""
V2 章节计划生成服务
把章节目标拆成 3～7 个短任务，产出与 types/learning-v2/chapter-plan.ts 对齐的 ChapterPlan
"""
import time
from uuid import uuid4

from lib.minimax import MiniMaxClient, extract_usage, parse_json_response
from prompts import build_prompt
from schemas.learning_v2 import ChapterPlanRequest
from services.learning_v2_errors import (
    BlueprintDataError,
    ChapterNotFoundError,
    PlanValidationError,
)

PROMPT_VERSION = "chapter-plan-v1"

# 教学模式枚举（对齐 chapter-plan.ts TaskTeachingPattern），值为中文释义
TEACHING_PATTERNS = {
    "explain": "概念讲解",
    "worked_example": "例题示范",
    "compare": "对比辨析",
    "process": "操作步骤",
    "derive": "原理推导",
    "practice": "练习巩固",
    "case_analysis": "案例分析",
    "recap": "总结回顾",
}

# 校验错误码，镜像 TS lib/learning-v2/validators.ts 的 PLAN_VALIDATION_CODES
PLAN_VALIDATION_CODES = {
    "CHAPTER_OBJECTIVE_MISSING": "CHAPTER_OBJECTIVE_MISSING",
    "OBJECTIVE_NOT_COVERED": "OBJECTIVE_NOT_COVERED",
    "UNKNOWN_OBJECTIVE": "UNKNOWN_OBJECTIVE",
    "DUPLICATE_TASK_ID": "DUPLICATE_TASK_ID",
    "DUPLICATE_TASK_ORDER": "DUPLICATE_TASK_ORDER",
    "PREREQ_TASK_NOT_FOUND": "PREREQ_TASK_NOT_FOUND",
    "PREREQ_CYCLE": "PREREQ_CYCLE",
    "EMPTY_TASK_FIELD": "EMPTY_TASK_FIELD",
    "TASK_COUNT_OUT_OF_RANGE": "TASK_COUNT_OUT_OF_RANGE",
    "SINGLE_TEACHING_PATTERN": "SINGLE_TEACHING_PATTERN",
    "TITLE_REPEATS_CHAPTER": "TITLE_REPEATS_CHAPTER",
    "INVALID_JSON": "INVALID_JSON",
}

_LEVEL_LABELS = {"beginner": "初级", "intermediate": "中级", "advanced": "高级"}


def _format_objectives(objectives: list[dict]) -> str:
    """把章节课程目标格式化为可读文本"""
    lines = []
    for obj in objectives:
        objective_id = obj.get("objectiveId", "")
        description = obj.get("description", "")
        outcome = obj.get("observableOutcome", "")
        lines.append(f"- {objective_id}：{description}（可观察结果：{outcome}）")
    return "\n".join(lines) if lines else "无"


def _format_learner(starting_point: dict) -> str:
    """把学习者起点格式化为可读文本"""
    parts = []
    level = (starting_point or {}).get("estimatedLevel", "")
    if level:
        parts.append(f"当前水平：{_LEVEL_LABELS.get(level, level)}")
    known = (starting_point or {}).get("confirmedKnowledge", [])
    if known:
        parts.append(f"已确认掌握：{'、'.join(known)}")
    gaps = (starting_point or {}).get("likelyGaps", [])
    if gaps:
        parts.append(f"潜在缺口：{'、'.join(gaps)}")
    return "\n".join(parts) if parts else "无"


def build_chapter_plan_prompt(topic: str, chapter: dict, objectives: list[dict], learner: dict) -> str:
    """构建章节计划 system prompt"""
    return build_prompt(
        "chapter_plan",
        topic=topic,
        chapter_title=chapter.get("title", ""),
        teaching_goal=chapter.get("teachingGoal", ""),
        objectives_section=_format_objectives(objectives),
        learner_section=_format_learner(learner),
    )


def _resolve_chapter(blueprint: dict, chapter_id: str) -> tuple[dict, list[dict]]:
    """从蓝图中定位章节与其课程目标；找不到时抛业务错误"""
    chapters = blueprint.get("chapters", [])
    chapter = next((c for c in chapters if c.get("chapterId") == chapter_id), None)
    if chapter is None:
        raise ChapterNotFoundError(f"蓝图中未找到章节 {chapter_id}")

    objectives_by_id = {o.get("objectiveId"): o for o in blueprint.get("courseObjectives", [])}
    objectives = []
    for objective_id in chapter.get("objectiveIds", []):
        objective = objectives_by_id.get(objective_id)
        if objective is None:
            raise BlueprintDataError(f"章节 {chapter_id} 引用了不存在的课程目标：{objective_id}")
        objectives.append(objective)
    if not objectives:
        raise BlueprintDataError(f"章节 {chapter_id} 未绑定任何课程目标，无法生成任务计划")
    return chapter, objectives


def _to_int(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_task(raw: dict, index: int) -> dict:
    """补齐/归一化单个任务字段，输出与 PlannedTask 逐字段对齐"""
    order = _to_int(raw.get("order"), index + 1)
    task_id = str(raw.get("taskId") or "").strip() or f"t{order}"
    pattern = raw.get("teachingPattern")
    if pattern not in TEACHING_PATTERNS:
        pattern = "explain"
    minutes = max(2, min(6, _to_int(raw.get("expectedMinutes"), 3)))

    concept_keys = raw.get("conceptKeys")
    concept_keys = [str(k).strip() for k in concept_keys if str(k).strip()] if isinstance(concept_keys, list) else []

    prereqs = raw.get("prerequisiteTaskIds")
    prereqs = [str(p).strip() for p in prereqs if str(p).strip()] if isinstance(prereqs, list) else []

    return {
        "taskId": task_id,
        "order": order,
        "title": str(raw.get("title") or "").strip(),
        "objectiveId": str(raw.get("objectiveId") or "").strip(),
        "taskGoal": str(raw.get("taskGoal") or "").strip(),
        "observableOutcome": str(raw.get("observableOutcome") or "").strip(),
        "conceptKeys": concept_keys,
        "prerequisiteTaskIds": prereqs,
        "teachingPattern": pattern,
        "expectedMinutes": minutes,
        # 固定字段由服务端强制写入，避免模型输出漂移
        "evidencePolicy": "none",
        "origin": "initial",
        "status": "planned",
    }


def _normalize_prereqs(tasks: list[dict]) -> None:
    """前置依赖引用无效（不存在/自引用）时退化为按 order 的线性链，保证前端可逐任务推进"""
    task_id_set = {t["taskId"] for t in tasks}
    for index, task in enumerate(tasks):
        prereqs = task["prerequisiteTaskIds"]
        if any(p not in task_id_set or p == task["taskId"] for p in prereqs):
            task["prerequisiteTaskIds"] = [tasks[index - 1]["taskId"]] if index > 0 else []


def _find_task_cycle(tasks: list[dict]) -> list[str] | None:
    """迭代 DFS 查找任务依赖环（镜像 TS findTaskCycle），返回环路径，无环返回 None"""
    adjacency = {t["taskId"]: t["prerequisiteTaskIds"] for t in tasks}
    visited: set[str] = set()
    for start in adjacency:
        if start in visited:
            continue
        on_path = {start}
        path = [start]
        stack = [(start, iter(adjacency.get(start, [])))]
        while stack:
            node, it = stack[-1]
            descended = False
            for prereq in it:
                if prereq not in adjacency:
                    continue  # 不存在的依赖由校验单独报出，环检测跳过
                if prereq in on_path:
                    return path[path.index(prereq):] + [prereq]
                if prereq not in visited:
                    on_path.add(prereq)
                    path.append(prereq)
                    stack.append((prereq, iter(adjacency.get(prereq, []))))
                    descended = True
                    break
            if not descended:
                stack.pop()
                path.pop()
                on_path.discard(node)
                visited.add(node)
    return None


def validate_plan_tasks(tasks: list[dict], objective_ids: list[str]) -> tuple[list[dict], list[dict]]:
    """计划结构校验，镜像 TS validateChapterPlan 的 error 项；返回 (errors, warnings)"""
    errors: list[dict] = []
    warnings: list[dict] = []
    codes = PLAN_VALIDATION_CODES

    if len(tasks) < 1:
        errors.append({"code": codes["TASK_COUNT_OUT_OF_RANGE"], "message": f"任务数为 {len(tasks)}，至少需要 1 个任务。"})
        return errors, warnings

    plan_objective_ids = set(objective_ids)
    task_id_set = {t["taskId"] for t in tasks}
    seen_task_ids: set[str] = set()
    seen_orders: set[int] = set()

    for task in tasks:
        if not task["taskId"] or not task["title"] or not task["taskGoal"]:
            errors.append({
                "code": codes["EMPTY_TASK_FIELD"],
                "taskId": task["taskId"] or None,
                "message": "任务缺少 taskId、标题或目标描述。",
            })
        if task["taskId"] in seen_task_ids:
            errors.append({"code": codes["DUPLICATE_TASK_ID"], "taskId": task["taskId"], "message": f"任务 ID 重复：{task['taskId']}"})
        seen_task_ids.add(task["taskId"])

        if task["order"] in seen_orders:
            errors.append({"code": codes["DUPLICATE_TASK_ORDER"], "taskId": task["taskId"], "message": f"任务顺序重复：{task['order']}"})
        seen_orders.add(task["order"])

        if task["objectiveId"] not in plan_objective_ids:
            errors.append({"code": codes["UNKNOWN_OBJECTIVE"], "taskId": task["taskId"], "message": f"任务绑定了计划外的目标：{task['objectiveId']}"})

        for prereq in task["prerequisiteTaskIds"]:
            if prereq not in task_id_set:
                errors.append({"code": codes["PREREQ_TASK_NOT_FOUND"], "taskId": task["taskId"], "message": f"任务依赖不存在：{prereq}"})

    # 每个计划目标至少被一个任务覆盖
    covered = {t["objectiveId"] for t in tasks}
    for objective_id in objective_ids:
        if objective_id not in covered:
            errors.append({"code": codes["OBJECTIVE_NOT_COVERED"], "message": f"计划目标未被任何任务覆盖：{objective_id}"})

    cycle = _find_task_cycle(tasks)
    if cycle:
        errors.append({"code": codes["PREREQ_CYCLE"], "message": f"任务依赖存在循环：{' → '.join(cycle)}"})

    # 软约束：3～7 个任务、教学模式多样化（只告警不拦截）
    if not (3 <= len(tasks) <= 7):
        warnings.append({"code": codes["TASK_COUNT_OUT_OF_RANGE"], "message": f"任务数量 {len(tasks)} 超出建议范围 3～7。"})
    if len(tasks) >= 2 and len({t["teachingPattern"] for t in tasks}) == 1:
        warnings.append({"code": codes["SINGLE_TEACHING_PATTERN"], "message": f"全章使用同一教学模式：{tasks[0]['teachingPattern']}"})

    return errors, warnings


def _format_repair_notes(errors: list[dict]) -> str:
    """把校验错误拼成给模型的修复提示"""
    lines = []
    for error in errors:
        line = f"- [{error['code']}] {error['message']}"
        if error.get("taskId"):
            line += f"（任务：{error['taskId']}）"
        lines.append(line)
    return "\n".join(lines)


async def generate_chapter_plan(request: ChapterPlanRequest, client: MiniMaxClient | None = None) -> dict:
    """生成章节计划；校验失败带修复提示重试一次，仍失败抛 PlanValidationError"""
    client = client or MiniMaxClient()
    blueprint = request.blueprint or {}
    chapter, objectives = _resolve_chapter(blueprint, request.chapterId)
    objective_ids = list(chapter.get("objectiveIds", []))

    system_prompt = build_chapter_plan_prompt(
        topic=blueprint.get("topic", ""),
        chapter=chapter,
        objectives=objectives,
        learner=blueprint.get("learnerStartingPoint", {}),
    )

    started = time.monotonic()
    last_errors: list[dict] = []
    repair_notes: str | None = None

    for _round in range(2):
        user_message = "请为这个章节生成任务计划。"
        if repair_notes:
            user_message += f"\n\n上一版输出存在以下问题，请修正后重新输出完整 JSON：\n{repair_notes}"

        response = await client.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            max_tokens=3000,
        )
        content = (response.get("choices") or [{}])[0].get("message", {}).get("content", "")

        try:
            parsed = parse_json_response(content)
        except ValueError as exc:
            last_errors = [{"code": PLAN_VALIDATION_CODES["INVALID_JSON"], "message": f"输出不是合法 JSON：{exc}"}]
            repair_notes = _format_repair_notes(last_errors)
            continue

        raw_tasks = parsed.get("tasks")
        raw_tasks = raw_tasks if isinstance(raw_tasks, list) else []
        tasks = [_normalize_task(raw, index) for index, raw in enumerate(raw_tasks) if isinstance(raw, dict)]
        tasks.sort(key=lambda t: t["order"])
        _normalize_prereqs(tasks)

        errors, warnings = validate_plan_tasks(tasks, objective_ids)
        for warning in warnings:
            print(f"[章节计划] 软约束告警：{warning['code']} {warning['message']}")
        if not errors:
            now_ms = time.time_ns() // 1_000_000
            return {
                "chapterId": request.chapterId,
                "planId": f"plan-{uuid4().hex[:12]}",
                "planVersion": 1,
                "objectiveIds": objective_ids,
                "tasks": tasks,
                "status": "active",
                "createdAt": now_ms,
                "updatedAt": now_ms,
                "generationMeta": {
                    "promptVersion": PROMPT_VERSION,
                    "modelVersion": getattr(client, "model", None) or "unknown",
                    "generatedAt": now_ms,
                    "durationMs": int((time.monotonic() - started) * 1000),
                    "degraded": False,
                    **({"tokenUsage": usage} if (usage := extract_usage(response)) else {}),
                },
            }

        last_errors = errors
        repair_notes = _format_repair_notes(errors)

    raise PlanValidationError(last_errors)
