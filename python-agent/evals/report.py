"""evals.report — 基线报告生成 + 人工校准工作表。

功能：
1. load_trace_bundle: 容错读取 EVAL_TRACE_DIR/<run_id>/<spec_id>/（spec/run_meta/
   course/evidence/stage_*）；course.json 缺失时从阶段文件尽力拼装，缺失清单入报告。
2. build_report: 装配 markdown 基线报告（五维分数、溯源率、对齐断裂、
   失败编码频次表、成本统计、人工校准结果）。
3. make_calibration_worksheet: 生成 10 对匿名 A/B 盲评工作表（隐去模型/版本/
   run id，位置随机化），答案密钥单独存放。
4. score_calibration: 回收盲评后计算人机一致率与 Cohen's κ（stats.cohens_kappa）。

失败编码 taxonomy（严重度 1-3）：幻觉事实/过时事实/解释浅表/脚手架断裂/评估错位/
先修断裂/冗余堆砌/认知超载/示例失真/takeaway空泛。

CLI（README 片段）：
    cd python-agent
    python -m evals.report --trace-dir "$EVAL_TRACE_DIR/run-1/spec-1" \
        --grounding grounding.json --alignment alignment.json --judge judge.json --out report.md
    python -m evals.report worksheet --pairs pairs.json --out-dir calib/ --n 10 --seed 42
    python -m evals.report score --answers calib/answers.json --key calib/key.json --judge judge_pairs.json
"""
from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path

from .judge import DIMENSIONS, DIMENSION_LABELS, render_course_text
from .stats import agreement_rate, cohens_kappa

# ---------------------------------------------------------------- 失败编码 taxonomy

FAILURE_TAXONOMY = {
    "hallucinated_fact": {"label": "幻觉事实", "default_severity": 3},
    "outdated_fact": {"label": "过时事实", "default_severity": 2},
    "shallow_explanation": {"label": "解释浅表", "default_severity": 2},
    "scaffolding_break": {"label": "脚手架断裂", "default_severity": 2},
    "assessment_misalignment": {"label": "评估错位", "default_severity": 2},
    "prerequisite_break": {"label": "先修断裂", "default_severity": 2},
    "redundancy": {"label": "冗余堆砌", "default_severity": 1},
    "cognitive_overload": {"label": "认知超载", "default_severity": 2},
    "distorted_example": {"label": "示例失真", "default_severity": 2},
    "vague_takeaway": {"label": "takeaway空泛", "default_severity": 1},
}

_ALIGNMENT_BREAK_MAP = {
    "OBJECTIVE_NO_CONTENT": "scaffolding_break",
    "TASK_EMPTY_CONTENT": "scaffolding_break",
    "TASK_DANGLING_OBJECTIVE": "scaffolding_break",
    "OBJECTIVE_NO_ASSESSMENT": "assessment_misalignment",
    "CHECKPOINT_DANGLING_OBJECTIVE": "assessment_misalignment",
    "CHECKPOINT_DANGLING_TASK": "assessment_misalignment",
    "TASK_PREREQ_MISSING": "prerequisite_break",
}


def _failure(code: str, detail: str, source: str, severity: int | None = None) -> dict:
    entry = FAILURE_TAXONOMY[code]
    return {"code": code, "label": entry["label"],
            "severity": severity if severity is not None else entry["default_severity"],
            "detail": detail, "source": source}


def encode_failures(grounding: dict | None = None, alignment: dict | None = None,
                    judge: dict | list | None = None) -> list[dict]:
    """把各评测输出映射为失败编码清单（确定性规则 +  documented 启发式）。

    - grounding contradicted → 幻觉事实(3)；reason 含"过时"→ 过时事实(2)；
      no_evidence → 幻觉事实(1)（疑似，需人工复核，无证据≠为假）。
    - alignment breaks → 按 _ALIGNMENT_BREAK_MAP；judge 对齐分 ≤2 → 对应断裂(2)。
    - 成对评审维度均分 ≤2 → 解释浅表/认知超载；reason 关键词 → 冗余/示例失真/takeaway。
    """
    failures: list[dict] = []
    for claim in (grounding or {}).get("contradicted_claims", []):
        reason = claim.get("reason", "")
        if "过时" in reason or "旧版本" in reason:
            failures.append(_failure("outdated_fact", f"{claim['text']}（{reason}）", "grounding"))
        else:
            failures.append(_failure("hallucinated_fact", f"{claim['text']}（{reason}）", "grounding"))
    for claim in (grounding or {}).get("unsupported_claims", []):
        failures.append(_failure("hallucinated_fact", f"[疑似/无证据] {claim['text']}", "grounding", severity=1))

    for br in (alignment or {}).get("breaks", []):
        code = _ALIGNMENT_BREAK_MAP.get(br.get("code"))
        if code:
            failures.append(_failure(code, br.get("detail", ""), "alignment"))
    for score in (alignment or {}).get("judge_scores", []):
        if score.get("status") != "ok":
            continue
        oid = score.get("objectiveId", "?")
        ca, aa = score.get("content_alignment"), score.get("assessment_alignment")
        if isinstance(ca, (int, float)) and ca <= 2:
            failures.append(_failure("scaffolding_break", f"目标 {oid} 内容实质对齐差（{ca}/5）", "alignment.judge"))
        if isinstance(aa, (int, float)) and aa <= 2:
            failures.append(_failure("assessment_misalignment", f"目标 {oid} 测验实质对齐差（{aa}/5）", "alignment.judge"))

    judge_results = judge if isinstance(judge, list) else [judge] if judge else []
    for pair in judge_results:
        if not isinstance(pair, dict):
            continue
        pid = pair.get("pair_id", "?")
        for name in DIMENSIONS:
            avg = (pair.get("dimension_averages") or {}).get(name) or {}
            for side in ("a", "b"):
                value = avg.get(side)
                if isinstance(value, (int, float)) and value <= 2:
                    code = {"depth": "shallow_explanation", "cognitive_load": "cognitive_overload"}.get(name)
                    if code:
                        failures.append(_failure(code, f"对局 {pid} 课程{side.upper()} {DIMENSION_LABELS[name]}均分 {value}/5", "judge"))
        for record in pair.get("per_judge", []):
            reason = record.get("reason", "")
            for keyword, code in (("冗余", "redundancy"), ("示例失真", "distorted_example"),
                                  ("例子空泛", "distorted_example"), ("takeaway 空泛", "vague_takeaway"),
                                  ("takeaway空泛", "vague_takeaway")):
                if keyword in reason:
                    failures.append(_failure(code, f"对局 {pid}：{reason}", f"judge.{record.get('judge', '?')}"))
                    break
    return failures


def failure_frequency_table(failures: list[dict]) -> list[dict]:
    """按编码聚合频次与最高严重度，按频次降序。"""
    agg: dict[str, dict] = {}
    for f in failures:
        entry = agg.setdefault(f["code"], {"code": f["code"], "label": f["label"],
                                           "count": 0, "max_severity": 0})
        entry["count"] += 1
        entry["max_severity"] = max(entry["max_severity"], f["severity"])
    return sorted(agg.values(), key=lambda x: (-x["count"], x["code"]))


# ---------------------------------------------------------------- trace 容错读取

def load_json_or_none(path) -> dict | list | None:
    if not path:
        return None
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _assemble_course_from_stages(stages: dict) -> dict | None:
    """course.json 缺失时的尽力拼装：architect 蓝图 + chapter_plan 任务 + task_content 块 + checkpoints。

    兼容新旧阶段命名：新命名带章/任务作用域（chapter_plan_<ch>、task_content_<ch>_<tid>、
    checkpoints_<ch>），旧命名无作用域（chapter_plan、task_content_<tid>）。旧命名下跨章
    同名任务只能保留最后一章（partial）；新命名按章归位，blocks 内嵌到对应章任务。
    """
    course: dict = {}
    chapters_parsed = (stages.get("architect_chapters") or {}).get("parsed")
    meta_parsed = (stages.get("architect_meta") or {}).get("parsed")
    if isinstance(chapters_parsed, dict) and chapters_parsed.get("chapters"):
        course["chapters"] = [dict(ch) for ch in chapters_parsed["chapters"]]
        course["courseTopic"] = chapters_parsed.get("courseTopic", "")
    if isinstance(meta_parsed, dict):
        course["architecture"] = meta_parsed
        course.setdefault("blueprint", {})["courseObjectives"] = meta_parsed.get("courseObjectives", [])

    # chapter_plan / chapter_plan_<ch>（排除 review）：按 parsed.chapterId 或名后缀归章
    plan_stages = sorted(
        (name, stage) for name, stage in stages.items()
        if name == "chapter_plan"
        or (name.startswith("chapter_plan_") and not name.startswith("chapter_plan_review"))
    )
    for name, stage in plan_stages:
        parsed = stage.get("parsed")
        if not isinstance(parsed, dict):
            continue
        tasks = parsed.get("tasks") or []
        chapter_id = parsed.get("chapterId") or (
            name[len("chapter_plan_"):] if name.startswith("chapter_plan_") else None)
        chapters = course.setdefault("chapters", [])
        target = next((ch for ch in chapters if ch.get("chapterId") == chapter_id), None)
        if target is None and len(plan_stages) == 1:
            target = chapters[0] if chapters else None
        if target is None and chapter_id:
            target = {"chapterId": chapter_id}
            chapters.append(target)
        if target is None:
            course["tasks"] = tasks
        else:
            target["plan"] = parsed
            target["tasks"] = tasks

    # task_content_<tid>（旧）/ task_content_<ch>_<tid>（新）：按已知 chapterId 前缀拆分
    known_chapters = [str(ch.get("chapterId")) for ch in course.get("chapters", []) if ch.get("chapterId")]
    contents = {}
    for name, stage in stages.items():
        if not name.startswith("task_content_"):
            continue
        rest = name[len("task_content_"):]
        chapter_id, task_id = "", rest
        for chid in known_chapters:
            if rest.startswith(chid + "_"):
                chapter_id, task_id = chid, rest[len(chid) + 1:]
                break
        parsed = stage.get("parsed")
        if not isinstance(parsed, dict):
            continue
        blocks = parsed.get("blocks") or (parsed.get("task") or {}).get("blocks")
        if blocks is None:
            continue
        contents[task_id] = {"blocks": blocks}
        checkpoint = parsed.get("checkpoint") or (parsed.get("task") or {}).get("checkpoint")
        if checkpoint:
            contents[task_id]["checkpoint"] = checkpoint
        if chapter_id:
            target = next((ch for ch in course.get("chapters", []) if ch.get("chapterId") == chapter_id), None)
            if target is not None:
                tasks = target.setdefault("tasks", [])
                task = next((t for t in tasks if isinstance(t, dict) and t.get("taskId") == task_id), None)
                if task is None:
                    task = {"taskId": task_id}
                    tasks.append(task)
                task.setdefault("blocks", blocks)
    if contents:
        course["taskContents"] = contents

    # checkpoints / checkpoints_<ch>：聚合到 course["checkpoints"]
    checkpoints: list[dict] = []
    for name, stage in sorted(stages.items()):
        if name != "checkpoints" and not name.startswith("checkpoints_"):
            continue
        parsed = stage.get("parsed")
        if not isinstance(parsed, dict) or not isinstance(parsed.get("checkpoints"), list):
            continue
        chapter_id = parsed.get("chapterId") or (
            name[len("checkpoints_"):] if name.startswith("checkpoints_") else "")
        for cp in parsed["checkpoints"]:
            if isinstance(cp, dict):
                entry = dict(cp)
                if chapter_id and not entry.get("chapterId"):
                    entry["chapterId"] = chapter_id
                checkpoints.append(entry)
    if checkpoints:
        course["checkpoints"] = checkpoints
    return course or None


def load_trace_bundle(trace_dir) -> dict:
    """容错读取 trace 目录。返回 {course, evidence, spec, run_meta, stages, missing}。

    stages: {name: {"raw": str|None, "parsed": obj|None, "meta": dict|None}}。
    任何文件缺失都不抛异常，记入 missing 清单。
    """
    root = Path(trace_dir)
    missing: list[str] = []
    bundle: dict = {"stages": {}, "missing": missing}
    for key, filename in (("spec", "spec.json"), ("run_meta", "run_meta.json"),
                          ("course", "course.json"), ("evidence", "evidence_snapshot.json")):
        data = load_json_or_none(root / filename)
        bundle[key] = data
        if data is None:
            missing.append(f"{filename} 缺失或不可解析")
    if root.is_dir():
        names: set[str] = set()
        for path in root.glob("stage_*"):
            for suffix in ("_meta.json", "_parsed.json", "_raw.txt"):
                if path.name.endswith(suffix):
                    names.add(path.name[len("stage_"):-len(suffix)])
        for name in sorted(names):
            raw_path = root / f"stage_{name}_raw.txt"
            bundle["stages"][name] = {
                "meta": load_json_or_none(root / f"stage_{name}_meta.json"),
                "parsed": load_json_or_none(root / f"stage_{name}_parsed.json"),
                "raw": raw_path.read_text(encoding="utf-8") if raw_path.exists() else None,
            }
    if bundle["course"] is None and bundle["stages"]:
        bundle["course"] = _assemble_course_from_stages(bundle["stages"])
        if bundle["course"] is not None:
            missing.append("course.json 缺失：已从阶段文件拼装（尽力而为，可能不完整）")
    return bundle


# ---------------------------------------------------------------- 成本统计

def _usage_tokens(usage) -> tuple[int, int, int]:
    if not isinstance(usage, dict):
        return (0, 0, 0)
    prompt = usage.get("prompt_tokens", usage.get("promptTokens", 0)) or 0
    completion = usage.get("completion_tokens", usage.get("completionTokens", 0)) or 0
    total = usage.get("total_tokens", usage.get("totalTokens", prompt + completion)) or 0
    return (int(prompt), int(completion), int(total))


def _fallback_level(value) -> int:
    """归一化 fallback_level：兼容数字（旧夹具）与 trace.py 写入的字符串。

    trace.py 记录捕获时实际使用的 response_format：strict(json_schema) / json_object / none。
    其中 none 是流式正文与 search_decision 的正常形态（本就不要求结构化输出），不算降级；
    只有 json_object 代表从 strict 的真实降级。数字值原样透传。
    """
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        return {"strict": 0, "json_object": 1, "none": 0}.get(value.strip().lower(), 0)
    return 0


def collect_cost(bundle: dict | None = None, outputs: list[dict] | None = None) -> dict:
    """汇总生成侧（stage meta）与评测侧（llm_calls 审计）的调用数与 token 成本。"""
    cost = {"generation_calls": 0, "evaluation_calls": 0, "failed_calls": 0,
            "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
            "repair_applied_count": 0, "fallback_count": 0, "by_model": {}}

    def add(model: str, usage, status_ok=True):
        p, c, t = _usage_tokens(usage)
        cost["prompt_tokens"] += p
        cost["completion_tokens"] += c
        cost["total_tokens"] += t
        entry = cost["by_model"].setdefault(model or "unknown", {"calls": 0, "total_tokens": 0})
        entry["calls"] += 1
        entry["total_tokens"] += t
        if not status_ok:
            cost["failed_calls"] += 1

    for stage in ((bundle or {}).get("stages") or {}).values():
        meta = stage.get("meta") or {}
        # call_count 含重试/多章累积（Bug4 后按作用域拆分），按真实调用数计
        try:
            calls = max(1, int(meta.get("call_count") or 1))
        except (TypeError, ValueError):
            calls = 1
        cost["generation_calls"] += calls
        add(meta.get("model", ""), meta.get("usage"))
        if meta.get("repair_applied"):
            cost["repair_applied_count"] += 1
        if _fallback_level(meta.get("fallback_level")) > 0:
            cost["fallback_count"] += 1
    for output in outputs or []:
        if not isinstance(output, dict):
            continue
        results = output if isinstance(output, dict) else {}
        call_lists = [results.get("llm_calls") or []]
        for pair in results.get("pairs", []) if isinstance(results.get("pairs"), list) else []:
            call_lists.append(pair.get("llm_calls") or [])
        for calls in call_lists:
            for call in calls:
                cost["evaluation_calls"] += 1
                add(call.get("model", ""), call.get("usage"), call.get("status") == "ok")
                if _fallback_level(call.get("fallback_level")) > 0:
                    cost["fallback_count"] += 1
    return cost


# ---------------------------------------------------------------- 报告装配

def _md_table(headers: list[str], rows: list[list]) -> str:
    lines = ["| " + " | ".join(headers) + " |",
             "|" + "|".join(["---"] * len(headers)) + "|"]
    for row in rows:
        lines.append("| " + " | ".join(str(c) if c is not None else "—" for c in row) + " |")
    return "\n".join(lines)


def build_report(bundle: dict | None = None, grounding: dict | None = None,
                 alignment: dict | None = None, judge: dict | list | None = None,
                 calibration: dict | None = None) -> str:
    """装配 markdown 基线报告。所有输入可缺省（部分 trace 也能出报告）。"""
    bundle = bundle or {}
    run_meta = bundle.get("run_meta") or {}
    spec = bundle.get("spec") or {}
    judge_results = judge if isinstance(judge, list) else [judge] if judge else []
    failures = encode_failures(grounding, alignment, judge)
    cost = collect_cost(bundle, [grounding, alignment, *judge_results])

    lines: list[str] = ["# 课程质量基线报告", ""]
    lines.append(f"- run: `{run_meta.get('run_id', '未知')}` / spec: `{spec.get('spec_id', '未知')}`")
    if run_meta.get("model"):
        lines.append(f"- 生成模型: `{run_meta['model']}`")
    if run_meta.get("generated_at"):
        lines.append(f"- 生成时间: {run_meta['generated_at']}")
    lines.append("")

    # 五维分数
    lines.append("## 五维 rubric 分数（评审团均分，1-5）")
    dim_rows = []
    for name in DIMENSIONS:
        a_vals = [(p.get("dimension_averages") or {}).get(name, {}).get("a") for p in judge_results]
        b_vals = [(p.get("dimension_averages") or {}).get(name, {}).get("b") for p in judge_results]
        a_vals = [v for v in a_vals if isinstance(v, (int, float))]
        b_vals = [v for v in b_vals if isinstance(v, (int, float))]
        dim_rows.append([
            DIMENSION_LABELS[name],
            round(sum(a_vals) / len(a_vals), 2) if a_vals else None,
            round(sum(b_vals) / len(b_vals), 2) if b_vals else None,
        ])
    if judge_results:
        lines.append(_md_table(["维度", "课程A", "课程B"], dim_rows))
        for p in judge_results:
            lines.append(f"\n对局 `{p.get('pair_id', '?')}`：胜者 **{p.get('winner', '?')}**，"
                         f"judge 间一致率 {p.get('agreement_rate', 0):.0%}"
                         f"（有效 judge {p.get('judges_ok', 0)}，失败 {p.get('judges_failed', 0)}）")
    else:
        lines.append("未提供成对评审结果（运行 `python -m evals.judge` 生成）。")
    lines.append("")

    # 事实溯源
    lines.append("## 事实溯源")
    if grounding:
        rate = grounding.get("grounding_rate")
        total = grounding.get("total_claims", 0)
        no_retrieval = grounding.get("no_retrieval", 0)
        if rate is not None:
            lines.append(f"- 溯源率：**{rate:.1%}**（支持 / 可归因声明，no_retrieval 不计入）")
        elif no_retrieval:
            lines.append("- 溯源率：N/A（无检索证据，全部声明记 no_retrieval，不计溯源失败）")
        else:
            lines.append("- 溯源率：N/A（无可核查声明）")
        lines.append(f"- 声明 {total} 条：支持 {grounding.get('supported', 0)} / "
                     f"矛盾 {grounding.get('contradicted', 0)} / 无证据 {grounding.get('no_evidence', 0)} / "
                     f"无检索 {no_retrieval}")
        if total and no_retrieval:
            lines.append(f"- no_retrieval 占比：{no_retrieval / total:.1%}（NO_SEARCH / 纯参数化生成，不计溯源失败）")
        coverage = grounding.get("evidence_coverage")
        if coverage is not None:
            lines.append(f"- evidence_coverage（有证据支撑的任务占比）：**{coverage:.1%}** "
                         f"（{grounding.get('tasks_with_evidence_support', 0)}/{grounding.get('tasks_evaluated', 0)} 任务）")
        elif grounding.get("tasks_evaluated"):
            lines.append("- evidence_coverage：N/A（无声明）")
        if grounding.get("evidence_source") == "request_fallback":
            lines.append("- 证据来源：evidence_snapshot 为空，已回退从任务 request 快照提取注入证据")
        if grounding.get("sampled"):
            lines.append(f"- 限量模式：{grounding.get('units_evaluated')}/{grounding.get('units_total')} 内容单元")
        if not grounding.get("evidence_available", True) and not no_retrieval:
            lines.append("- ⚠️ 证据快照缺失：无证据计数不代表内容错误")
        for claim in grounding.get("contradicted_claims", [])[:10]:
            lines.append(f"- ❌ 矛盾：{claim['text']}（{claim.get('reason', '')}）")
        for claim in grounding.get("unsupported_claims", [])[:10]:
            lines.append(f"- ⚠️ 无证据：{claim['text']}")
        if grounding.get("dangling_citations"):
            lines.append(f"- 引用脱节：{', '.join(grounding['dangling_citations'])}")
    else:
        lines.append("未提供溯源评测结果（运行 `python -m evals.grounding` 生成）。")
    lines.append("")

    # 对齐审计
    lines.append("## 目标↔内容↔评估对齐")
    if alignment:
        cov = alignment.get("coverage") or {}
        lines.append(f"- 目标 {cov.get('objectives_total', 0)} 个：有内容 {cov.get('with_content', 0)}，"
                     f"有评估 {cov.get('with_assessment', 0)}，全覆盖 {cov.get('fully_covered', 0)}")
        breaks = alignment.get("breaks") or []
        if breaks:
            lines.append(f"- 断裂 {len(breaks)} 处：")
            for br in breaks[:20]:
                lines.append(f"  - [{br.get('code')}] {br.get('detail', '')}")
        else:
            lines.append("- 无程序可检断裂")
    else:
        lines.append("未提供对齐审计结果（运行 `python -m evals.alignment` 生成）。")
    lines.append("")

    # 失败编码频次表
    lines.append("## 失败编码频次（taxonomy）")
    freq = failure_frequency_table(failures)
    if freq:
        lines.append(_md_table(["编码", "标签", "频次", "最高严重度"],
                               [[f["code"], f["label"], f["count"], f["max_severity"]] for f in freq]))
    else:
        lines.append("无失败编码。")
    lines.append("")

    # 成本
    lines.append("## 成本统计")
    lines.append(_md_table(["项", "值"], [
        ["生成侧调用", cost["generation_calls"]],
        ["评测侧调用", cost["evaluation_calls"]],
        ["失败调用（重试耗尽）", cost["failed_calls"]],
        ["prompt tokens", cost["prompt_tokens"]],
        ["completion tokens", cost["completion_tokens"]],
        ["总 tokens", cost["total_tokens"]],
        ["生成侧 repair_applied", cost["repair_applied_count"]],
        ["降级次数（response_format/其他）", cost["fallback_count"]],
    ]))
    lines.append("")

    # 人工校准
    if calibration:
        lines.append("## 人工校准")
        lines.append(f"- 回收盲评 {calibration.get('n_answered', 0)} 对")
        hj = calibration.get("human_judge") or {}
        if hj:
            lines.append(f"- 人机一致率：{hj.get('agreement_rate', 0):.0%}，Cohen's κ = {hj.get('kappa', 0):.3f}")
        for rater, info in (calibration.get("human_raters") or {}).items():
            lines.append(f"- 评分者 {rater} vs judge：一致率 {info.get('agreement_rate', 0):.0%}，κ = {info.get('kappa', 0):.3f}")
        lines.append("")

    # 容错说明
    if bundle.get("missing"):
        lines.append("## 缺失文件（容错记录）")
        for item in bundle["missing"]:
            lines.append(f"- {item}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------- 人工校准工作表

_MODEL_HINT_RE = re.compile(
    r"(deepseek[-\w.]*|claude[-\w.]*|gpt-[-\w.]*|qwen[-\w.]*|minimax[-\w.]*|ark/[-\w.]+|funcloud/[-\w.]+|bailian/[-\w.]+|openai/[-\w.]+)",
    re.IGNORECASE,
)


def _anonymize(text: str, ids: list[str]) -> str:
    for cid in ids:
        if cid:
            text = text.replace(cid, "〔已隐去〕")
    return _MODEL_HINT_RE.sub("〔模型已隐去〕", text)


def make_calibration_worksheet(pairs: list[dict], out_dir, n: int = 10, seed: int = 42) -> dict:
    """生成匿名盲评工作表 + 单独密钥文件。

    pairs: [{"pair_id","a_id","b_id","course_a","course_b"}]。
    位置随机化（固定 seed 可复现）；渲染只含教学内容，另 scrub run id/模型名。
    工作表不含任何模型/版本信息；密钥 key.json 记录展示位置↔真实课程映射。
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    selected = pairs[:n]
    key_pairs = []
    lines = ["# 课程质量盲评工作表", "",
             "说明：每对课程 A/B 来自不同生成配置，模型与版本信息已隐去。",
             "请独立判断整体质量更优的一方，填 A / B / tie（平局），可附一句理由。",
             "参考维度：事实准确、目标对齐、认知负荷、讲解深度、结构连贯。", ""]
    for i, pair in enumerate(selected):
        pair_id = pair.get("pair_id") or f"pair-{i + 1:02d}"
        a_id, b_id = pair.get("a_id", f"a-{i}"), pair.get("b_id", f"b-{i}")
        swap = rng.random() < 0.5
        shown_a_id, shown_b_id = (b_id, a_id) if swap else (a_id, b_id)
        shown_a_course, shown_b_course = (pair["course_b"], pair["course_a"]) if swap else (pair["course_a"], pair["course_b"])
        text_a = _anonymize(render_course_text(shown_a_course), [a_id, b_id, pair_id])
        text_b = _anonymize(render_course_text(shown_b_course), [a_id, b_id, pair_id])
        lines += [f"## 对局 {pair_id}", "", "### 课程 A", "", text_a or "（内容缺失）", "",
                  "### 课程 B", "", text_b or "（内容缺失）", "",
                  f"**你的判断（A/B/tie）**：______  理由：______", "", "---", ""]
        key_pairs.append({"pair_id": pair_id, "shown_a": shown_a_id, "shown_b": shown_b_id,
                          "orig_a": a_id, "orig_b": b_id})
    worksheet_path = out_dir / "worksheet.md"
    key_path = out_dir / "key.json"
    worksheet_path.write_text("\n".join(lines), encoding="utf-8")
    key_path.write_text(json.dumps({"seed": seed, "n": len(selected), "pairs": key_pairs},
                                   ensure_ascii=False, indent=2), encoding="utf-8")
    return {"worksheet_path": str(worksheet_path), "key_path": str(key_path), "n": len(selected)}


def _relative_label(canonical_winner: str, orig_a: str, orig_b: str) -> str:
    if canonical_winner == orig_a:
        return "a"
    if canonical_winner == orig_b:
        return "b"
    return "tie"


def score_calibration(answers: list[dict], key: dict, judge_verdicts: list[dict] | None = None) -> dict:
    """回收盲评 → 人机一致率 / κ。

    answers: [{"pair_id","winner":"A"/"B"/"tie", 可选 "rater"}]（展示位置语义）。
    key: make_calibration_worksheet 产出的 key.json 内容。
    judge_verdicts: [{"pair_id","winner":"a"/"b"/"tie"}]（相对 orig_a/orig_b，
    与 evaluate_pair 输出一致）。
    κ 在相对标签（a/b/tie）上计算，避免跨对局 id 不一致问题。
    """
    key_by_pair = {p["pair_id"]: p for p in key.get("pairs", [])}
    judge_by_pair = {p["pair_id"]: p.get("winner", "tie") for p in judge_verdicts or []}

    by_rater: dict[str, dict[str, str]] = {}
    for ans in answers:
        pid = ans.get("pair_id")
        kp = key_by_pair.get(pid)
        if not kp:
            continue
        shown = str(ans.get("winner", "")).strip().upper()
        canonical = kp["shown_a"] if shown == "A" else kp["shown_b"] if shown == "B" else "tie"
        label = _relative_label(canonical, kp["orig_a"], kp["orig_b"])
        rater = ans.get("rater", "human")
        by_rater.setdefault(rater, {})[pid] = label

    result: dict = {"n_answered": sum(len(v) for v in by_rater.values()), "human_raters": {}}
    all_human_labels: list[str] = []
    all_judge_labels: list[str] = []
    for rater, labels in by_rater.items():
        common = sorted(set(labels) & set(judge_by_pair))
        human = [labels[p] for p in common]
        machine = [judge_by_pair[p] for p in common]
        info = {"n_compared": len(common)}
        if common:
            info["agreement_rate"] = agreement_rate(human, machine)
            info["kappa"] = cohens_kappa(human, machine)
            all_human_labels.extend(human)
            all_judge_labels.extend(machine)
        result["human_raters"][rater] = info
    if all_human_labels:
        result["human_judge"] = {
            "n_compared": len(all_human_labels),
            "agreement_rate": agreement_rate(all_human_labels, all_judge_labels),
            "kappa": cohens_kappa(all_human_labels, all_judge_labels),
        }
    raters = sorted(by_rater)
    if len(raters) >= 2:
        left, right = by_rater[raters[0]], by_rater[raters[1]]
        common = sorted(set(left) & set(right))
        if common:
            result["human_human"] = {
                "raters": raters[:2], "n_compared": len(common),
                "agreement_rate": agreement_rate([left[p] for p in common], [right[p] for p in common]),
                "kappa": cohens_kappa([left[p] for p in common], [right[p] for p in common]),
            }
    return result


# ---------------------------------------------------------------- CLI

def main() -> None:
    parser = argparse.ArgumentParser(description="基线报告与人工校准（详见模块 docstring）")
    sub = parser.add_subparsers(dest="command")

    p_report = sub.add_parser("report", help="装配 markdown 基线报告")
    p_report.add_argument("--trace-dir")
    p_report.add_argument("--grounding")
    p_report.add_argument("--alignment")
    p_report.add_argument("--judge", help="成对评审结果 JSON（单个对象或列表）")
    p_report.add_argument("--calibration", help="score_calibration 输出 JSON")
    p_report.add_argument("--out")

    p_ws = sub.add_parser("worksheet", help="生成匿名盲评工作表")
    p_ws.add_argument("--pairs", required=True, help="pairs.json：[{pair_id,a_id,b_id,course_a,course_b}]")
    p_ws.add_argument("--out-dir", required=True)
    p_ws.add_argument("--n", type=int, default=10)
    p_ws.add_argument("--seed", type=int, default=42)

    p_score = sub.add_parser("score", help="回收盲评计算人机一致率/κ")
    p_score.add_argument("--answers", required=True)
    p_score.add_argument("--key", required=True)
    p_score.add_argument("--judge", help="judge 成对结果 JSON 列表")
    p_score.add_argument("--out")

    import sys
    argv = sys.argv[1:]
    if argv and argv[0].startswith("-"):
        argv = ["report"] + argv  # 兼容 python -m evals.report --trace-dir ...
    args = parser.parse_args(argv)

    if args.command == "worksheet":
        pairs = load_json_or_none(args.pairs) or []
        info = make_calibration_worksheet(pairs, args.out_dir, n=args.n, seed=args.seed)
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return
    if args.command == "score":
        answers = load_json_or_none(args.answers) or []
        key = load_json_or_none(args.key) or {}
        judge = load_json_or_none(args.judge) if args.judge else None
        if isinstance(judge, dict):
            judge = [judge]
        result = score_calibration(answers, key, judge)
        text = json.dumps(result, ensure_ascii=False, indent=2)
        if args.out:
            Path(args.out).write_text(text, encoding="utf-8")
        print(text)
        return

    # 默认 report
    bundle = load_trace_bundle(args.trace_dir) if args.trace_dir else {}
    judge = load_json_or_none(args.judge) if args.judge else None
    report = build_report(
        bundle,
        grounding=load_json_or_none(args.grounding) if args.grounding else None,
        alignment=load_json_or_none(args.alignment) if args.alignment else None,
        judge=judge,
        calibration=load_json_or_none(args.calibration) if args.calibration else None,
    )
    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")
        print(f"已写入 {args.out}")
    else:
        print(report)


if __name__ == "__main__":
    main()