"""
V2 章节计划生成服务
按认知增量把章节目标拆成 2～7 个短任务，产出与 types/learning-v2/chapter-plan.ts 对齐的 ChapterPlan
"""
import asyncio
import json
import os
import time
from uuid import uuid4

from lib.minimax_agent import AgentClient
from lib.minimax import MiniMaxClient, extract_usage, parse_json_response
from lib.tools.search_tools import SEARCH_TOOLS
from prompts import build_prompt
from schemas.learning_v2 import ChapterPlanRequest
from services.evidence_store import evidence_to_prompt, get_chapter_evidence, task_evidence_coverage
from services.learning_v2_errors import (
    BlueprintDataError,
    ChapterNotFoundError,
    PlanValidationError,
)
from services.search_evidence import ChapterEvidenceCollector, format_search_decision_policy
from services.memory_context_v4 import format_memory_context_for_prompt

PROMPT_VERSION = "chapter-plan-v3"
PLAN_REASONING_EFFORT = os.getenv("PLAN_REASONING_EFFORT", "low").strip() or None

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
    "SEMANTIC_CONCEPT_OVERLAP": "SEMANTIC_CONCEPT_OVERLAP",
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
    excluded = (starting_point or {}).get("excludedTopics", [])
    if excluded:
        parts.append(f"已掌握且应跳过：{'、'.join(excluded)}")
    background = (starting_point or {}).get("backgroundSummary")
    if background:
        parts.append(f"相关背景（仅用于校准与例子选择）：{background}")
    confidence = (starting_point or {}).get("levelConfidence")
    if isinstance(confidence, (int, float)):
        parts.append(f"水平判断置信度：{round(float(confidence) * 100)}%")
    return "\n".join(parts) if parts else "无"


def _format_mission(mission: dict | None) -> str:
    if not mission:
        return ""
    lines = [
        f"- 学习动机：{mission.get('why', '')}",
        f"- 目标场景：{mission.get('targetScenario', '')}",
    ]
    success = mission.get("successCriteria") or []
    if success:
        lines.append("- 完成标准：" + "；".join(str(item) for item in success))
    constraints = mission.get("constraints") or []
    if constraints:
        lines.append("- 约束：" + "、".join(str(item) for item in constraints))
    out_of_scope = mission.get("outOfScope") or []
    if out_of_scope:
        lines.append("- 不学：" + "、".join(str(item) for item in out_of_scope))
    return "\n\n## 课程使命\n" + "\n".join(lines)


def _format_teaching_state(teaching_state: dict) -> str:
    if not teaching_state:
        return ""

    sections = []
    pending = teaching_state.get("pendingArtifacts") or []
    if pending:
        pending_lines = [
            f"- {item.get('description', '')}（章节：{item.get('chapterId', '未知')}）"
            for item in pending[-5:]
        ]
        sections.append("## 待用户反馈材料\n" + "\n".join(pending_lines))

    insights = [item for item in (teaching_state.get("insights") or []) if item.get("status") != "discarded"]
    if insights:
        insight_lines = [
            f"- {item.get('content', '')}（建议章节：{item.get('suggestedChapterId', '任意')}）"
            for item in insights[-5:]
        ]
        sections.append("## 可复用教学素材\n" + "\n".join(insight_lines))

    notes = teaching_state.get("notes") or []
    if notes:
        note_lines = [f"- {item.get('content', '')}" for item in notes[-5:]]
        sections.append("## 课程教学备注\n" + "\n".join(note_lines))

    if not sections:
        return ""
    return "\n\n<teaching_state>\n" + "\n".join(sections) + "\n</teaching_state>"


def _format_completed_chapters(completed: list[dict] | None) -> str:
    """已完成章节摘要：每章标题 + 要点，供计划去重"""
    if not completed:
        return "（这是第一章，或此前章节尚未产出小结）"
    sections: list[str] = []
    for item in completed:
        title = item.get("title", "")
        takeaways = item.get("takeaways") or []
        lines = [f"- {point}" for point in takeaways[:5]]
        sections.append(f"### {title}\n" + "\n".join(lines))
    return "\n".join(sections)


def build_chapter_plan_prompt(topic: str, chapter: dict, objectives: list[dict], learner: dict, evidence: str | None = None, sources: list[dict] | None = None, mission: dict | None = None, teaching_state: dict | None = None, completed_chapters: list[dict] | None = None, intent_type: str | None = None, memory_context: dict | None = None, allow_search: bool = False) -> str:
    """构建章节计划 system prompt；有证据包时约束规划来源"""
    evidence_section = ""
    if evidence:
        source_lines = "\n".join(f"- {s.get('title', '')}（{s.get('url', '')}）" for s in (sources or []))
        evidence_section = (
            "\n\n## 课程证据包\n"
            f"{evidence}\n\n## 可参考来源\n{source_lines}\n\n"
            "规划任务时优先围绕这些权威来源；不要规划证据未支持的高风险事实细节。"
        )
    prompt = build_prompt(
        "chapter_plan",
        ["role", "chapter_context", "output_format", "goal_alignment", "completed_chapters"],
        topic=topic,
        chapter_title=chapter.get("title", ""),
        teaching_goal=chapter.get("teachingGoal", ""),
        objectives_section=_format_objectives(objectives),
        learner_section=_format_learner(learner),
        intent_type=intent_type or "未指定",
        completed_section=_format_completed_chapters(completed_chapters),
    ) + _format_mission(mission) + _format_teaching_state(teaching_state or {}) + format_memory_context_for_prompt(memory_context or {}) + evidence_section
    if allow_search:
        prompt += "\n\n" + format_search_decision_policy(max_searches=2)
    return prompt
    intent_type = (chapter.get("intentType") or "") if isinstance(chapter, dict) else ""
    # intentType 在课程级，蓝图透传时挂在 chapter 上的场景做兜底读取
    if not intent_type:
        pass
    return _format_goal_alignment(intent_type) + _format_completed_chapters(completed_chapters)


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

    # 相邻任务概念高度重合属于硬错误：避免同一基础概念反复换说法。
    for previous, current in zip(tasks, tasks[1:]):
        previous_keys = {key.strip().lower() for key in previous.get("conceptKeys", []) if key.strip()}
        current_keys = {key.strip().lower() for key in current.get("conceptKeys", []) if key.strip()}
        if previous.get("objectiveId") == current.get("objectiveId") and previous_keys and current_keys:
            union = previous_keys | current_keys
            overlap = len(previous_keys & current_keys) / max(1, len(union))
            if overlap >= 0.8:
                errors.append({
                    "code": codes["SEMANTIC_CONCEPT_OVERLAP"],
                    "taskId": current["taskId"],
                    "message": f"相邻任务概念高度重合：{previous['taskId']} 与 {current['taskId']}，应合并或提升认知增量。",
                })

    # 软约束：2～7 个任务、教学模式多样化（只告警不拦截）
    if not (2 <= len(tasks) <= 7):
        warnings.append({"code": codes["TASK_COUNT_OUT_OF_RANGE"], "message": f"任务数量 {len(tasks)} 超出建议范围 2～7。"})
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


def should_review_chapter_plan(
    tasks: list[dict],
    warnings: list[dict],
    learner: dict | None = None,
    review_mode: str | None = None,
) -> bool:
    """质量审查只在高风险计划上触发；普通结构合法计划直接进入内容生成。"""
    mode = (review_mode or os.getenv("PLAN_REVIEW_MODE", "auto")).strip().lower()
    if mode == "off":
        return False
    if mode == "always":
        return True
    if warnings:
        return True
    confidence = (learner or {}).get("levelConfidence")
    if isinstance(confidence, (int, float)) and confidence < 0.55:
        return True
    # 没有 conceptKeys 的计划无法判断认知增量，交给独立审查补一层风险信号。
    if any(not task.get("conceptKeys") for task in tasks):
        return True
    return False


def build_chapter_plan_review_prompt(
    chapter_title: str,
    teaching_goal: str,
    learner: dict,
    tasks: list[dict],
) -> str:
    """生产与 Prompt Lab 共用的章节计划审查 system prompt。"""
    review_tasks = [
        {
            "taskId": task.get("taskId"),
            "title": task.get("title"),
            "objectiveId": task.get("objectiveId"),
            "taskGoal": task.get("taskGoal"),
            "observableOutcome": task.get("observableOutcome"),
            "conceptKeys": task.get("conceptKeys"),
            "teachingPattern": task.get("teachingPattern"),
            "expectedMinutes": task.get("expectedMinutes"),
        }
        for task in tasks
    ]
    return build_prompt(
        "chapter_plan",
        ["review"],
        chapter_title=chapter_title,
        teaching_goal=teaching_goal,
        learner_section=_format_learner(learner),
        tasks_json=json.dumps(review_tasks, ensure_ascii=False, indent=2),
    )


async def _review_chapter_plan(
    client: MiniMaxClient,
    *,
    chapter: dict,
    teaching_goal: str,
    learner: dict,
    tasks: list[dict],
) -> dict:
    """独立审查计划的认知增量、重复度和水平匹配；不可解析时安全放行并记录。"""
    try:
        response = await client.chat(
            messages=[
                {
                    "role": "system",
                    "content": build_chapter_plan_review_prompt(
                        chapter.get("title", ""),
                        teaching_goal,
                        learner,
                        tasks,
                    ),
                },
                {"role": "user", "content": "请审查这份章节计划。"},
            ],
            max_tokens=8000,
        )
        content = (response.get("choices") or [{}])[0].get("message", {}).get("content", "")
        parsed = parse_json_response(content)
        if not isinstance(parsed, dict) or not isinstance(parsed.get("passed"), bool):
            raise ValueError("review schema invalid")
        issues = parsed.get("issues") if isinstance(parsed.get("issues"), list) else []
        return {
            "passed": parsed["passed"],
            "issues": [item for item in issues if isinstance(item, dict)],
            "repairNotes": str(parsed.get("repairNotes") or ""),
        }
    except Exception as exc:  # noqa: BLE001 质量审查失败不阻塞主流程
        print(f"[章节计划] 质量审查不可用，按结构校验结果继续：{exc}")
        return {"passed": True, "issues": [], "repairNotes": ""}


async def generate_chapter_plan(request: ChapterPlanRequest, client: MiniMaxClient | None = None, memory_context: dict | None = None) -> dict:
    """生成章节计划；校验失败带修复提示重试一次，仍失败抛 PlanValidationError"""
    client = client or AgentClient()
    blueprint = request.blueprint or {}
    teaching_state = blueprint.get("teachingState") or {}
    chapter, objectives = _resolve_chapter(blueprint, request.chapterId)
    objective_ids = list(chapter.get("objectiveIds", []))

    # 已有章节证据直接作为模型上下文；是否需要补充搜索由模型通过工具调用决定。
    collector = ChapterEvidenceCollector(
        request.courseId,
        request.chapterId,
        blueprint.get("topic", ""),
        chapter.get("title", ""),
    )
    evidence_pack = collector.pack
    evidence, sources = evidence_to_prompt(evidence_pack)

    completed_chapters = request.completedChapters or []
    intent_type = blueprint.get("intentType") or ""
    started = time.monotonic()
    last_errors: list[dict] = []
    repair_notes: str | None = None

    for _round in range(3):
        evidence_pack = collector.pack
        evidence, sources = evidence_to_prompt(evidence_pack)
        coverage = task_evidence_coverage(
            evidence_pack,
            f"{chapter.get('title', '')} {chapter.get('teachingGoal', '')}",
            " ".join(
                f"{objective.get('description', '')} {objective.get('observableOutcome', '')}"
                for objective in objectives
            ),
        )
        allow_search = not coverage["covered"]
        system_prompt = build_chapter_plan_prompt(
            topic=blueprint.get("topic", ""),
            chapter=chapter,
            objectives=objectives,
            learner=blueprint.get("learnerStartingPoint", {}),
            intent_type=intent_type,
            completed_chapters=completed_chapters,
            evidence=evidence,
            sources=sources,
            mission=blueprint.get("mission"),
            teaching_state=teaching_state,
            memory_context=memory_context,
            allow_search=allow_search,
        )
        user_message = "请为这个章节生成任务计划。"
        if repair_notes:
            user_message += f"\n\n上一版输出存在以下问题，请修正后重新输出完整 JSON：\n{repair_notes}"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]
        if hasattr(client, "chat_with_tools"):
            response = await asyncio.to_thread(
                client.chat_with_tools,
                messages=messages,
                tools=SEARCH_TOOLS if allow_search else [],
                tool_functions=collector.tool_functions,
                max_tokens=16000,
                reasoning_split=True,
                max_iterations=2 if allow_search else 1,
                max_searches=1,
                reasoning_effort=PLAN_REASONING_EFFORT,
            )
        else:
            response = await client.chat(messages=messages, max_tokens=16000)
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
        # 章节级理解闸门：最后一个任务固定触发 Checkpoint。
        # 该字段由服务端确定性写入，模型输出不影响，避免“测题能力存在但流程不触发”。
        if tasks:
            tasks[-1]["evidencePolicy"] = "checkpoint"
        _normalize_prereqs(tasks)

        errors, warnings = validate_plan_tasks(tasks, objective_ids)
        for warning in warnings:
            print(f"[章节计划] 软约束告警：{warning['code']} {warning['message']}")
        if not errors:
            now_ms = time.time_ns() // 1_000_000
            plan = {
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
            if not should_review_chapter_plan(
                tasks,
                warnings,
                blueprint.get("learnerStartingPoint", {}),
            ):
                plan["generationMeta"]["reviewSkipped"] = True
                return plan

            review = await _review_chapter_plan(
                client,
                chapter=chapter,
                teaching_goal=chapter.get("teachingGoal", ""),
                learner=blueprint.get("learnerStartingPoint", {}),
                tasks=tasks,
            )
            if review["passed"] or _round >= 2:
                if not review["passed"]:
                    print("[章节计划] 二次修订后仍有质量告警，保留最终结构合法计划")
                return plan

            review_issues = review.get("issues") or []
            for issue in review_issues:
                print(f"[章节计划] 质量审查：{issue.get('code', 'QUALITY')} {issue.get('message', '')}")
            last_errors = review_issues
            issue_notes = _format_repair_notes(review_issues)
            custom_notes = review.get("repairNotes") or ""
            repair_notes = "\n".join(part for part in (issue_notes, custom_notes) if part)
            continue

        last_errors = errors
        repair_notes = _format_repair_notes(errors)

    raise PlanValidationError(last_errors)
