"""evals/report.py 回归测试：阶段拼装（新/旧命名）、成本归一化、溯源新指标展示。

report.py 的测试历史上寄居在 test_eval_judge.py；本文件专放 report 自身的
回归（Bug4 作用域拼装兼容、fallback_level 字符串归一化、no_retrieval /
evidence_coverage 展示），不改动 judge.py / stats.py / test_eval_judge.py。
"""
import json

from evals.report import (
    _fallback_level,
    build_report,
    collect_cost,
    load_trace_bundle,
)


def _write_stage(root, name, parsed=None, meta=None, raw=None):
    if parsed is not None:
        (root / f"stage_{name}_parsed.json").write_text(
            json.dumps(parsed, ensure_ascii=False), encoding="utf-8")
    if meta is not None:
        (root / f"stage_{name}_meta.json").write_text(
            json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    if raw is not None:
        (root / f"stage_{name}_raw.txt").write_text(raw, encoding="utf-8")


# ---------------------------------------------------------------- Bug4：新命名拼装（跨章 t1 不串）

def test_assembly_new_naming_cross_chapter(tmp_path):
    _write_stage(tmp_path, "architect_chapters", parsed={"courseTopic": "缓存", "chapters": [
        {"chapterId": "ch-1", "title": "强缓存"}, {"chapterId": "ch-2", "title": "协商缓存"}]})
    _write_stage(tmp_path, "chapter_plan_ch-1",
                 parsed={"chapterId": "ch-1", "tasks": [{"taskId": "t1", "objectiveId": "o1"}]})
    _write_stage(tmp_path, "chapter_plan_ch-2",
                 parsed={"chapterId": "ch-2", "tasks": [{"taskId": "t1", "objectiveId": "o2"}]})
    _write_stage(tmp_path, "task_content_ch-1_t1",
                 parsed={"blocks": [{"type": "markdown", "markdown": "强缓存内容"}]})
    _write_stage(tmp_path, "task_content_ch-2_t1",
                 parsed={"blocks": [{"type": "markdown", "markdown": "协商缓存内容"}]})
    _write_stage(tmp_path, "checkpoints_ch-1", parsed={"chapterId": "ch-1", "checkpoints": [
        {"checkpointId": "cp1", "objectiveId": "o1", "taskId": "t1", "prompt": "题1"}]})
    _write_stage(tmp_path, "checkpoints_ch-2", parsed={"chapterId": "ch-2", "checkpoints": [
        {"checkpointId": "cp2", "objectiveId": "o2", "taskId": "t1", "prompt": "题2"}]})
    bundle = load_trace_bundle(tmp_path)
    course = bundle["course"]
    assert course is not None
    assert any("拼装" in m for m in bundle["missing"])
    by_ch = {ch["chapterId"]: ch for ch in course["chapters"]}
    # 跨章同名 t1 按章归位，blocks 不互相覆盖
    assert by_ch["ch-1"]["tasks"][0]["blocks"][0]["markdown"] == "强缓存内容"
    assert by_ch["ch-2"]["tasks"][0]["blocks"][0]["markdown"] == "协商缓存内容"
    assert by_ch["ch-1"]["plan"]["tasks"][0]["objectiveId"] == "o1"
    assert by_ch["ch-2"]["plan"]["tasks"][0]["objectiveId"] == "o2"
    assert {cp["checkpointId"] for cp in course["checkpoints"]} == {"cp1", "cp2"}
    assert all(cp.get("chapterId") for cp in course["checkpoints"])


def test_assembly_old_naming_compat(tmp_path):
    # 旧 trace（pilot-0）无作用域命名仍可拼装出报告
    _write_stage(tmp_path, "architect_chapters",
                 parsed={"courseTopic": "缓存", "chapters": [{"chapterId": "ch-1", "title": "x"}]})
    _write_stage(tmp_path, "chapter_plan",
                 parsed={"chapterId": "ch-1", "tasks": [{"taskId": "t1", "objectiveId": "o1"}]})
    _write_stage(tmp_path, "task_content_t1",
                 parsed={"blocks": [{"type": "markdown", "markdown": "ETag 内容"}]})
    course = load_trace_bundle(tmp_path)["course"]
    assert course["chapters"][0]["tasks"][0]["taskId"] == "t1"
    assert course["taskContents"]["t1"]["blocks"][0]["markdown"] == "ETag 内容"


# ---------------------------------------------------------------- 成本归一化（fallback_level 字符串）

def test_fallback_level_normalization():
    assert _fallback_level("strict") == 0
    assert _fallback_level("json_object") == 1
    assert _fallback_level("none") == 0  # 流式/search 正常形态，非降级
    assert _fallback_level(1) == 1  # 旧数字夹具透传
    assert _fallback_level(0) == 0
    assert _fallback_level(None) == 0


def test_collect_cost_call_count_and_str_fallback(tmp_path):
    # 字符串 fallback_level 不再 TypeError；generation_calls 按 call_count 累积（含重试）
    _write_stage(tmp_path, "chapter_plan_ch-1",
                 meta={"model": "m", "call_count": 4, "fallback_level": "strict",
                       "usage": {"total_tokens": 30}})
    _write_stage(tmp_path, "task_content_ch-1_t1",
                 meta={"model": "m", "call_count": 1, "fallback_level": "none",
                       "usage": {"total_tokens": 10}})
    _write_stage(tmp_path, "architect_chapters",
                 meta={"model": "m", "call_count": 1, "fallback_level": "json_object",
                       "usage": {"total_tokens": 5}})
    cost = collect_cost(load_trace_bundle(tmp_path))
    assert cost["generation_calls"] == 6  # 4+1+1
    assert cost["fallback_count"] == 1  # 只有 json_object 算真降级
    assert cost["total_tokens"] == 45


# ---------------------------------------------------------------- 溯源新指标展示

def test_build_report_no_retrieval_display():
    grounding = {"grounding_rate": None, "total_claims": 3, "supported": 0, "contradicted": 0,
                 "no_evidence": 0, "no_retrieval": 3, "evidence_coverage": 0.0,
                 "tasks_evaluated": 3, "tasks_with_evidence_support": 0,
                 "evidence_source": "none", "evidence_available": False, "flags": ["no_retrieval"],
                 "contradicted_claims": [], "unsupported_claims": [], "no_retrieval_claims": []}
    report = build_report(grounding=grounding)
    assert "N/A（无检索证据" in report
    assert "no_retrieval 占比：100.0%" in report
    assert "evidence_coverage" in report and "0.0%" in report
    assert "无检索 3" in report
    # no_retrieval 不计溯源失败：抑制"证据快照缺失"警告
    assert "⚠️ 证据快照缺失" not in report


def test_build_report_request_fallback_and_rate():
    grounding = {"grounding_rate": 1 / 3, "total_claims": 3, "supported": 1, "contradicted": 0,
                 "no_evidence": 2, "no_retrieval": 0, "evidence_coverage": 1 / 3,
                 "tasks_evaluated": 3, "tasks_with_evidence_support": 1,
                 "evidence_source": "request_fallback", "evidence_available": True,
                 "contradicted_claims": [], "unsupported_claims": [{"text": "x"}],
                 "no_retrieval_claims": []}
    report = build_report(grounding=grounding)
    assert "33.3%" in report
    assert "回退从任务 request 快照提取" in report
    assert "no_retrieval 占比" not in report  # no_retrieval=0 不显示占比


# ---------------------------------------------------------------- L2：run/spec 标识回退

def test_run_meta_parent_fallback_and_spec_id(tmp_path):
    """run_meta.json 在 run 根目录、spec.json 用 id 键时报告标识不再"未知"。"""
    run_root = tmp_path / "run-x"
    spec_dir = run_root / "gs-demo-b"
    spec_dir.mkdir(parents=True)
    (run_root / "run_meta.json").write_text(
        json.dumps({"run_id": "run-x", "model": "m"}), encoding="utf-8")
    (spec_dir / "spec.json").write_text(
        json.dumps({"id": "gs-demo-b", "topic": "demo"}), encoding="utf-8")
    bundle = load_trace_bundle(spec_dir)
    assert bundle["run_meta"] is not None
    assert bundle["run_meta"]["run_id"] == "run-x"
    assert "run_meta.json 缺失" not in " ".join(bundle["missing"])
    report = build_report(bundle)
    assert "run: `run-x`" in report
    assert "spec: `gs-demo-b`" in report


def test_spec_id_key_precedence(tmp_path):
    """spec_id 键优先于 id；两者皆无才"未知"。"""
    (tmp_path / "spec.json").write_text(
        json.dumps({"spec_id": "canonical", "id": "fallback"}), encoding="utf-8")
    bundle = load_trace_bundle(tmp_path)
    assert "spec: `canonical`" in build_report(bundle)
    (tmp_path / "spec.json").write_text(json.dumps({"id": "fallback"}), encoding="utf-8")
    assert "spec: `fallback`" in build_report(load_trace_bundle(tmp_path))
