"""evals.alignment — 目标↔内容↔评估映射审计。

两层审计：
1. 程序覆盖矩阵（确定性、零成本）：从 course.json 提取学习目标、任务内容、
   checkpoint/测验，检查每个目标"有内容承载 + 有评估对应"，输出断裂清单：
   - OBJECTIVE_NO_CONTENT      目标无任务内容承载（脚手架断裂）
   - OBJECTIVE_NO_ASSESSMENT   目标无评估对应（评估错位）
   - TASK_EMPTY_CONTENT        任务挂目标但内容块为空（脚手架断裂）
   - TASK_DANGLING_OBJECTIVE   任务引用不存在的目标（脚手架断裂）
   - CHECKPOINT_DANGLING_OBJECTIVE / CHECKPOINT_DANGLING_TASK（评估错位）
   - TASK_PREREQ_MISSING       任务先修引用缺失（先修断裂）
2. judge 对齐质量（可选 --no-llm 跳过）：对有承载的目标评
   content_alignment / assessment_alignment（1-5），识别"形式覆盖但实质错位"。

缺失 trace 容错：course.json 缺失时返回空矩阵 + missing 说明，不抛异常。

CLI（README 片段）：
    cd python-agent
    python -m evals.alignment --trace-dir "$EVAL_TRACE_DIR/run-1/spec-1" --out alignment.json
    python -m evals.alignment --course course.json --no-llm          # 仅程序矩阵
    python -m evals.alignment --trace-dir ... --sample 5             # 限量 judge 评估
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from .judge import JudgeGateway, JudgeCallError, load_judges_config, _blocks_to_text
from .report import load_trace_bundle, load_json_or_none

BREAK_LABELS = {
    "OBJECTIVE_NO_CONTENT": "目标无内容承载",
    "OBJECTIVE_NO_ASSESSMENT": "目标无评估对应",
    "TASK_EMPTY_CONTENT": "任务内容为空",
    "TASK_DANGLING_OBJECTIVE": "任务引用不存在的目标",
    "CHECKPOINT_DANGLING_OBJECTIVE": "测验引用不存在的目标",
    "CHECKPOINT_DANGLING_TASK": "测验引用不存在的任务",
    "TASK_PREREQ_MISSING": "任务先修引用缺失",
}

ALIGN_SYSTEM = """你是教学设计审计员。给定一个学习目标、承载它的任务内容摘要与对应测验，
判断实质对齐质量（不是形式覆盖）：
- content_alignment 1-5：内容是否真正教会该目标的可观察产出（5=直接训练目标行为，1=内容与目标无关）。
- assessment_alignment 1-5：测验是否真正测量该目标（5=测量目标行为，1=测的是别的东西或只考记忆）。
无测验时 assessment_alignment 给 1 并在 issues 说明。
输出严格 JSON：{"content_alignment": 1-5, "assessment_alignment": 1-5, "issues": ["一句话问题"], "comment": "一句话总评"}"""


# ---------------------------------------------------------------- 提取器（容错）

def extract_objectives(course: dict) -> list[dict]:
    """学习目标：blueprint.courseObjectives 优先，兼容顶层 objectives / architecture.learningDelta。"""
    if not isinstance(course, dict):
        return []
    blueprint = course.get("blueprint") or {}
    raw = blueprint.get("courseObjectives") or course.get("objectives") or []
    objectives = []
    for obj in raw:
        if not isinstance(obj, dict):
            continue
        oid = str(obj.get("objectiveId") or "").strip()
        text = obj.get("observableOutcome") or obj.get("description") or obj.get("text") or ""
        if oid:
            objectives.append({"objectiveId": oid, "text": str(text)})
    if not objectives:
        thesis = (course.get("architecture") or {}).get("thesis") or {}
        for i, delta in enumerate(thesis.get("learningDelta") or []):
            objectives.append({"objectiveId": f"delta-{i + 1}", "text": str(delta)})
    return objectives


def _scoped_objectives(course: dict, objectives: list[dict]) -> tuple[list[dict], list[str]]:
    """runner 截断章节（--max-chapters）时，只把已生成章节内的目标计入覆盖。

    章→目标映射取 blueprint.chapters[].objectiveIds；目标跨多章时任一章已生成即在范围内。
    blueprint/映射/已生成章节缺失时保守返回全部目标（旧行为，全量跑不受影响）。
    返回 (范围内目标, 范围外目标 id 列表)。
    """
    blueprint = course.get("blueprint") or {}
    bp_chapters = blueprint.get("chapters") or []
    generated = {str(c.get("chapterId") or "") for c in course.get("chapters") or []}
    generated.discard("")
    if not bp_chapters or not generated:
        return objectives, []
    mapping: dict[str, set] = {}
    for ch in bp_chapters:
        if not isinstance(ch, dict):
            continue
        chid = str(ch.get("chapterId") or "")
        for oid in ch.get("objectiveIds") or []:
            mapping.setdefault(str(oid), set()).add(chid)
    if not mapping:
        return objectives, []
    in_scope, out = [], []
    for obj in objectives:
        chapters = mapping.get(obj["objectiveId"])
        if chapters is None or (chapters & generated):
            in_scope.append(obj)
        else:
            out.append(obj["objectiveId"])
    return in_scope, out


def extract_tasks(course: dict) -> list[dict]:
    """任务清单（含 chapterId）。

    生成内容任务（chapters[].tasks）只有 taskId/blocks，没有 objectiveId；
    目标映射在 chapters[].plan.tasks（taskId+objectiveId），这里按章内
    plan 映射补齐（任务自带 objectiveId 时优先）。taskId 可跨章复用
    （每章第一个任务都叫 t1），章任务按 (chapterId, taskId) 去重，
    顶层任务按裸 taskId 去重（先出现者为准）。
    """
    if not isinstance(course, dict):
        return []
    entries: list[tuple[dict, bool]] = []  # (task, 是否章内任务)
    for ch in course.get("chapters") or (course.get("blueprint") or {}).get("chapters") or []:
        if not isinstance(ch, dict):
            continue
        chapter_id = ch.get("chapterId", "")
        plan_map: dict[str, str] = {}
        plan = ch.get("plan")
        if isinstance(plan, dict):
            for pt in plan.get("tasks") or []:
                if isinstance(pt, dict) and pt.get("taskId") and pt.get("objectiveId"):
                    plan_map[str(pt["taskId"])] = str(pt["objectiveId"]).strip()
        for task in ch.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            merged = {**task, "chapterId": chapter_id}
            if not str(merged.get("objectiveId") or "").strip():
                mapped = plan_map.get(str(task.get("taskId") or ""))
                if mapped:
                    merged["objectiveId"] = mapped
            entries.append((merged, True))
    for task in course.get("tasks") or []:
        if isinstance(task, dict):
            entries.append((task, False))
    seen_scoped: set[tuple[str, str]] = set()
    seen_bare: set[str] = set()
    unique = []
    for task, scoped in entries:
        tid = task.get("taskId")
        if not tid:
            continue
        if scoped:
            key = (str(task.get("chapterId") or ""), tid)
            if key in seen_scoped:
                continue
            seen_scoped.add(key)
        elif tid in seen_bare:
            continue
        seen_bare.add(tid)
        unique.append(task)
    return unique


def _scoped_task_blocks(course: dict) -> dict[tuple[str, str], list[dict]]:
    """(chapterId, taskId) → blocks。任务内嵌 blocks 优先（taskId 跨章复用
    时裸键 taskContents 会互相覆盖），缺失时回退 taskContents 裸键。"""
    contents = extract_task_contents(course)
    scoped: dict[tuple[str, str], list[dict]] = {}
    for task in extract_tasks(course):
        tid = task.get("taskId")
        if not tid:
            continue
        blocks = task.get("blocks")
        scoped[(str(task.get("chapterId") or ""), tid)] = (
            blocks if isinstance(blocks, list) else contents.get(tid, [])
        )
    return scoped


def extract_task_contents(course: dict) -> dict[str, list[dict]]:
    """taskId → blocks。兼容 taskContents 字典 / 任务内嵌 blocks。"""
    contents: dict[str, list[dict]] = {}
    if not isinstance(course, dict):
        return contents
    raw = course.get("taskContents") or {}
    if isinstance(raw, dict):
        for task_id, entry in raw.items():
            if isinstance(entry, dict):
                contents[task_id] = entry.get("blocks") or []
            elif isinstance(entry, list):
                contents[task_id] = entry
    for task in extract_tasks(course):
        tid = task.get("taskId")
        if tid and tid not in contents and isinstance(task.get("blocks"), list):
            contents[tid] = task["blocks"]
    return contents


def extract_checkpoints(course: dict) -> list[dict]:
    """checkpoint/测验：顶层 checkpoints、任务内嵌 checkpoint(s)、taskContents 内 checkpoint。"""
    if not isinstance(course, dict):
        return []
    found: list[dict] = []

    def add(cp, task_id=None, chapter_id=None):
        if not isinstance(cp, dict) or not (cp.get("prompt") or cp.get("checkpointId")):
            return
        found.append({
            "checkpointId": cp.get("checkpointId", f"cp-{len(found) + 1}"),
            "objectiveId": str(cp.get("objectiveId") or "").strip(),
            "taskId": str(cp.get("taskId") or task_id or "").strip(),
            "chapterId": str(cp.get("chapterId") or chapter_id or "").strip(),
            "kind": cp.get("kind", ""),
            "prompt": cp.get("prompt", ""),
        })

    for cp in course.get("checkpoints") or []:
        add(cp)
    for task in extract_tasks(course):
        cp = task.get("checkpoint") or task.get("checkpoints")
        for item in (cp if isinstance(cp, list) else [cp] if cp else []):
            add(item, task.get("taskId"), task.get("chapterId"))
    raw = course.get("taskContents") or {}
    if isinstance(raw, dict):
        for task_id, entry in raw.items():
            if isinstance(entry, dict):
                cp = entry.get("checkpoint") or entry.get("checkpoints")
                for item in (cp if isinstance(cp, list) else [cp] if cp else []):
                    add(item, task_id)
    seen, unique = set(), []
    for cp in found:
        if cp["checkpointId"] not in seen:
            seen.add(cp["checkpointId"])
            unique.append(cp)
    return unique


def _has_content(blocks: list[dict]) -> bool:
    return bool(_blocks_to_text(blocks or []).strip())


# ---------------------------------------------------------------- 覆盖矩阵

def build_coverage_matrix(course: dict) -> dict:
    """程序检查：每个目标的内容承载与评估对应 + 引用完整性。"""
    objectives = extract_objectives(course)
    all_objective_ids = {o["objectiveId"] for o in objectives}
    objectives, out_of_scope = _scoped_objectives(course, objectives)
    tasks = extract_tasks(course)
    scoped_blocks = _scoped_task_blocks(course)
    checkpoints = extract_checkpoints(course)

    objective_ids = all_objective_ids  # 悬空引用检查用全集，覆盖矩阵用范围内目标
    task_ids = {t.get("taskId") for t in tasks if t.get("taskId")}
    task_refs: list[tuple[str, str, str]] = []  # (chapterId, taskId, objectiveId)
    breaks: list[dict] = []

    def add_break(code: str, detail: str, **refs):
        breaks.append({"code": code, "label": BREAK_LABELS.get(code, code), "detail": detail, **refs})

    for task in tasks:
        tid = task.get("taskId", "")
        chid = str(task.get("chapterId") or "")
        oid = str(task.get("objectiveId") or "").strip()
        refs = {"taskId": tid}
        if chid:
            refs["chapterId"] = chid
        if oid:
            task_refs.append((chid, tid, oid))
            if oid not in objective_ids:
                add_break("TASK_DANGLING_OBJECTIVE", f"任务 {tid} 引用不存在的目标 {oid}",
                          objectiveId=oid, **refs)
        blocks = scoped_blocks.get((chid, tid), [])
        if oid and not _has_content(blocks):
            add_break("TASK_EMPTY_CONTENT", f"任务 {tid} 挂目标 {oid} 但内容块为空",
                      objectiveId=oid, **refs)
        for prereq in task.get("prerequisiteTaskIds") or []:
            if prereq not in task_ids:
                add_break("TASK_PREREQ_MISSING", f"任务 {tid} 的先修任务 {prereq} 不存在",
                          missingPrereq=prereq, **refs)

    checkpoints_by_objective: dict[str, list[str]] = {}
    for cp in checkpoints:
        oid, tid = cp["objectiveId"], cp["taskId"]
        if oid and oid not in objective_ids:
            add_break("CHECKPOINT_DANGLING_OBJECTIVE", f"测验 {cp['checkpointId']} 引用不存在的目标 {oid}",
                      checkpointId=cp["checkpointId"], objectiveId=oid)
        if tid and tid not in task_ids:
            add_break("CHECKPOINT_DANGLING_TASK", f"测验 {cp['checkpointId']} 引用不存在的任务 {tid}",
                      checkpointId=cp["checkpointId"], taskId=tid)
        # 直接挂目标，或经由任务间接挂目标（taskId 跨章复用时按章匹配，
        # 任一侧无 chapterId 时退化为裸 taskId 匹配，兼容旧数据）
        if oid:
            checkpoints_by_objective.setdefault(oid, []).append(cp["checkpointId"])
        elif tid:
            cp_ch = str(cp.get("chapterId") or "")
            for chid, t_tid, o in task_refs:
                if t_tid == tid and (not cp_ch or not chid or cp_ch == chid):
                    checkpoints_by_objective.setdefault(o, []).append(cp["checkpointId"])

    matrix = []
    for obj in objectives:
        oid = obj["objectiveId"]
        content_refs = [(chid, tid) for chid, tid, o in task_refs
                        if o == oid and _has_content(scoped_blocks.get((chid, tid), []))]
        content_tasks = list(dict.fromkeys(tid for _, tid in content_refs))
        assessments = list(dict.fromkeys(checkpoints_by_objective.get(oid, [])))
        entry = {
            "objectiveId": oid,
            "text": obj["text"],
            "content_task_ids": content_tasks,
            "content_task_refs": [{"chapterId": chid, "taskId": tid} for chid, tid in content_refs],
            "assessment_checkpoint_ids": assessments,
            "content_covered": bool(content_tasks),
            "assessment_covered": bool(assessments),
            "fully_covered": bool(content_tasks) and bool(assessments),
        }
        matrix.append(entry)
        if not content_tasks:
            add_break("OBJECTIVE_NO_CONTENT", f"目标 {oid} 无任务内容承载", objectiveId=oid)
        if not assessments:
            add_break("OBJECTIVE_NO_ASSESSMENT", f"目标 {oid} 无评估对应", objectiveId=oid)

    total = len(objectives)
    return {
        "matrix": matrix,
        "breaks": breaks,
        "coverage": {
            "objectives_total": total,
            "objectives_out_of_scope": out_of_scope,
            "with_content": sum(1 for m in matrix if m["content_covered"]),
            "with_assessment": sum(1 for m in matrix if m["assessment_covered"]),
            "fully_covered": sum(1 for m in matrix if m["fully_covered"]),
            "full_coverage_rate": (sum(1 for m in matrix if m["fully_covered"]) / total) if total else None,
        },
        "tasks_total": len(tasks),
        "checkpoints_total": len(checkpoints),
    }


# ---------------------------------------------------------------- judge 质量

async def judge_alignment_quality(
    course: dict,
    matrix: list[dict],
    gateway: JudgeGateway,
    model: str,
    sample: int | None = None,
) -> list[dict]:
    """对目标逐个评实质对齐质量；确定性等距限量（sample）。失败降级记录不中断。"""
    from .grounding import select_sample

    entries = select_sample(matrix, sample)
    contents = extract_task_contents(course)
    scoped_blocks = _scoped_task_blocks(course)
    checkpoints = {cp["checkpointId"]: cp for cp in extract_checkpoints(course)}
    results = []
    for entry in entries:
        content_parts = []
        # 章感知取内容：taskId 跨章复用时按 (chapterId, taskId) 定位，
        # 旧矩阵（无 content_task_refs）退化为裸 taskId。
        refs = entry.get("content_task_refs") or [
            {"chapterId": "", "taskId": tid} for tid in entry.get("content_task_ids", [])
        ]
        for ref in refs[:3]:
            tid = ref.get("taskId", "")
            chid = str(ref.get("chapterId") or "")
            blocks = scoped_blocks.get((chid, tid))
            if blocks is None:
                blocks = contents.get(tid, [])
            content_parts.append(_blocks_to_text(blocks)[:1500])
        assessment_parts = [checkpoints[cid]["prompt"] for cid in entry["assessment_checkpoint_ids"][:3]
                            if cid in checkpoints]
        messages = [
            {"role": "system", "content": ALIGN_SYSTEM},
            {"role": "user", "content":
                f"## 学习目标\n{entry['text'] or entry['objectiveId']}\n\n"
                f"## 任务内容摘要\n{'（无内容）' if not content_parts else chr(10).join(content_parts)}\n\n"
                f"## 测验\n{'（无测验）' if not assessment_parts else chr(10).join(assessment_parts)}"},
        ]
        record = {"objectiveId": entry["objectiveId"]}
        try:
            data = (await gateway.complete_json(messages, model))["data"]
            record.update({
                "status": "ok",
                "content_alignment": data.get("content_alignment"),
                "assessment_alignment": data.get("assessment_alignment"),
                "issues": data.get("issues") or [],
                "comment": data.get("comment", ""),
            })
        except JudgeCallError as exc:
            record.update({"status": "failed", "error": str(exc)})
        results.append(record)
    return results


# ---------------------------------------------------------------- 主流程

async def run_alignment(
    trace_dir: str | Path | None = None,
    course: dict | None = None,
    *,
    gateway: JudgeGateway | None = None,
    model: str | None = None,
    with_llm: bool = True,
    sample: int | None = None,
    config: dict | None = None,
) -> dict:
    notes: list[str] = []
    if course is None and trace_dir is not None:
        bundle = load_trace_bundle(trace_dir)
        course = bundle.get("course")
        notes.extend(bundle.get("missing", []))
    if course is None:
        return {"matrix": [], "breaks": [], "coverage": {"objectives_total": 0},
                "judge_scores": [], "llm_calls": [],
                "notes": notes + ["course.json 缺失，无法审计"]}

    result = build_coverage_matrix(course)
    config = config or load_judges_config()
    model = model or config.get("utility_model") or config["panel"][0]["model"]
    judge_scores: list[dict] = []
    calls: list[dict] = []
    if with_llm and result["matrix"]:
        gateway = gateway or JudgeGateway(max_retries=config["max_retries"],
                                          temperature=config["temperature"],
                                          max_tokens=config["max_tokens"])
        judge_scores = await judge_alignment_quality(course, result["matrix"], gateway, model, sample)
        calls = gateway.calls
    elif with_llm:
        notes.append("无学习目标可评（矩阵为空），跳过 judge 对齐评估")
    result.update({"judge_scores": judge_scores, "model": model,
                   "llm_calls": calls, "notes": notes})
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="目标↔内容↔评估对齐审计（详见模块 docstring）")
    parser.add_argument("--trace-dir")
    parser.add_argument("--course")
    parser.add_argument("--no-llm", action="store_true", help="仅程序覆盖矩阵，不调用 judge")
    parser.add_argument("--sample", type=int, help="限量 judge 评估的目标数")
    parser.add_argument("--model")
    parser.add_argument("--out")
    args = parser.parse_args()
    if not args.trace_dir and not args.course:
        parser.error("需要 --trace-dir 或 --course")
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    except ImportError:
        pass
    course = load_json_or_none(args.course) if args.course else None
    result = asyncio.run(run_alignment(
        trace_dir=args.trace_dir, course=course, model=args.model,
        with_llm=not args.no_llm, sample=args.sample,
    ))
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        cov = result["coverage"]
        print(f"已写入 {args.out}（目标 {cov.get('objectives_total', 0)}，"
              f"全覆盖 {cov.get('fully_covered', 0)}，断裂 {len(result['breaks'])} 处）")
    else:
        print(text)


if __name__ == "__main__":
    main()