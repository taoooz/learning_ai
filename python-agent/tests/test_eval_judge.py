# tests/test_eval_judge.py — 评审团：位置交换去偏 / 聚合 / 重试降级 / BT + 报告装配与校准
import asyncio
import json

import pytest

from evals.judge import (
    DIMENSIONS,
    JudgeCallError,
    JudgeGateway,
    aggregate_panel,
    estimate_calls,
    evaluate_pair,
    fit_bradley_terry,
    judge_pair_once,
    load_judges_config,
    render_course_text,
    win_rates,
)
from evals.report import (
    build_report,
    load_trace_bundle,
    make_calibration_worksheet,
    score_calibration,
)


# ---------------------------------------------------------------- fixtures

CONFIG = {
    "panel": [{"id": "j1", "model": "mock/m1"}, {"id": "j2", "model": "mock/m2"},
              {"id": "j3", "model": "mock/m3"}],
    "utility_model": "mock/m1",
    "temperature": 0, "max_tokens": 200, "max_retries": 3, "timeout_seconds": 5,
}


def make_course(marker: str, topic: str = "HTTP 缓存") -> dict:
    return {
        "courseTopic": topic,
        "run_meta": {"model": "ark/deepseek-v4-1-flash", "run_id": "run-secret"},
        "blueprint": {"learningGoal": "学会缓存协商", "courseObjectives": [
            {"objectiveId": "o1", "observableOutcome": "能判断 304 场景"}]},
        "chapters": [{"chapterId": "ch1", "title": "缓存基础", "tasks": [
            {"taskId": "t1", "title": "协商缓存", "taskGoal": "理解 ETag",
             "blocks": [{"type": "markdown", "markdown": f"{marker}：ETag 是资源的版本标识。"},
                        {"type": "key_point", "points": ["304 表示资源未变化"]}]}]}],
    }


def verdict_response(winner: str, a_score: int = 4, b_score: int = 3) -> dict:
    dims = {name: {"a_score": a_score, "b_score": b_score, "comment": "ok"} for name in DIMENSIONS}
    payload = {"dimensions": dims, "winner": winner, "reason": "测试理由"}
    return {"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}}


def content_based_fake(model_winners=None, fail_models=()):
    """按内容标记判胜的 fake：含 GOOD_MARKER 的一侧胜。

    model_winners 值可为固定位置字母（"A"/"B"，模拟位置偏差），
    或 "prefer_b"（始终偏好第二门课程 b，与位置无关的真实内容异议）。
    """
    async def fake(messages, model, **kwargs):
        if model in fail_models:
            raise RuntimeError(f"{model} 网关不可用")
        user = messages[-1]["content"]
        first = user.split("## 课程 A\n", 1)[1].split("## 课程 B", 1)[0]
        marker_in_first = "GOOD_MARKER" in first
        preference = (model_winners or {}).get(model)
        if preference == "prefer_b":
            return verdict_response("B" if marker_in_first else "A")
        if preference:
            return verdict_response(preference)
        return verdict_response("A" if marker_in_first else "B")
    return fake


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------- 位置交换去偏

def test_position_bias_always_first_becomes_tie():
    # 每个 judge 都无脑选第一个位置 → 双向换算后 1:1 → 平局 + position_bias 标记
    gateway = JudgeGateway(llm_call=content_based_fake(model_winners={
        "mock/m1": "A", "mock/m2": "A", "mock/m3": "A"}), retry_delay=0)
    result = run(evaluate_pair(make_course("A"), make_course("B"), config=CONFIG, gateway=gateway))
    assert result["winner"] == "tie"
    for record in result["per_judge"]:
        assert record["position_bias"] is True
        assert record["winner"] == "tie"
    assert result["agreement_rate"] == 1.0  # 三个 judge 都判 tie，裁决一致


def test_consistent_preference_survives_swap():
    gateway = JudgeGateway(llm_call=content_based_fake(), retry_delay=0)
    result = run(evaluate_pair(make_course("GOOD_MARKER"), make_course("普通"),
                               config=CONFIG, gateway=gateway))
    assert result["winner"] == "a"
    assert result["votes"]["a"] == 3
    for record in result["per_judge"]:
        assert record["position_bias"] is False
        assert record["forward_winner"] == "A" and record["reverse_winner"] == "B"
    # 每 judge 双向各一次 = 6 次调用
    assert len(gateway.calls) == 6
    assert all(c["status"] == "ok" for c in gateway.calls)


def test_majority_vote_and_agreement():
    # j1/j2 内容判 a 胜，j3 真实偏好课程 b（双向换算后都投 b）
    gateway = JudgeGateway(llm_call=content_based_fake(model_winners={"mock/m3": "prefer_b"}), retry_delay=0)
    result = run(evaluate_pair(make_course("GOOD_MARKER"), make_course("普通"),
                               config=CONFIG, gateway=gateway))
    assert result["winner"] == "a"
    assert result["votes"] == {"a": 2, "b": 1, "tie": 0}
    assert result["agreement_rate"] == pytest.approx(1 / 3)


def test_judge_failure_excluded_and_recorded():
    gateway = JudgeGateway(llm_call=content_based_fake(fail_models={"mock/m2"}), retry_delay=0)
    result = run(evaluate_pair(make_course("GOOD_MARKER"), make_course("普通"),
                               config=CONFIG, gateway=gateway))
    assert result["winner"] == "a"
    assert result["judges_ok"] == 2 and result["judges_failed"] == 1
    failed = [j for j in result["per_judge"] if j["status"] == "failed"]
    assert failed[0]["fallback"] == "excluded"
    assert any(c["status"] == "failed" and c["model"] == "mock/m2" for c in gateway.calls)


def test_all_judges_fail_returns_error():
    gateway = JudgeGateway(llm_call=content_based_fake(
        fail_models={"mock/m1", "mock/m2", "mock/m3"}), retry_delay=0)
    result = run(evaluate_pair(make_course("A"), make_course("B"), config=CONFIG, gateway=gateway))
    assert result["winner"] == "error"


def test_retry_then_success_recorded():
    calls = {"n": 0}

    async def flaky(messages, model, **kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("暂时性故障")
        return verdict_response("A")

    gateway = JudgeGateway(llm_call=flaky, max_retries=3, retry_delay=0)
    result = run(judge_pair_once(gateway, "mock/m1", "甲", "乙"))
    assert result["winner"] == "A"
    assert gateway.calls[0]["attempts"] == 3
    assert gateway.calls[0]["status"] == "ok"


def test_retry_exhausted_raises():
    async def always_fail(messages, model, **kwargs):
        raise RuntimeError("永久故障")

    gateway = JudgeGateway(llm_call=always_fail, max_retries=2, retry_delay=0)
    with pytest.raises(JudgeCallError):
        run(gateway.complete_json([{"role": "user", "content": "x"}], "mock/m1"))
    assert gateway.calls[0]["status"] == "failed"
    assert gateway.calls[0]["attempts"] == 2


def test_markdown_fenced_json_parsed():
    async def fenced(messages, model, **kwargs):
        resp = verdict_response("B")
        resp["choices"][0]["message"]["content"] = "```json\n" + resp["choices"][0]["message"]["content"] + "\n```"
        return resp

    gateway = JudgeGateway(llm_call=fenced, retry_delay=0)
    result = run(judge_pair_once(gateway, "mock/m1", "甲", "乙"))
    assert result["winner"] == "B"


def test_winner_normalization():
    async def lowercase(messages, model, **kwargs):
        return verdict_response("a")

    gateway = JudgeGateway(llm_call=lowercase, retry_delay=0)
    assert run(judge_pair_once(gateway, "mock/m1", "甲", "乙"))["winner"] == "A"


# ---------------------------------------------------------------- 聚合与 BT

def test_win_rates_known():
    matches = [{"a": "A", "b": "B", "winner": "A"},
               {"a": "A", "b": "B", "winner": "A"},
               {"a": "A", "b": "B", "winner": "tie"}]
    rates = win_rates(matches)
    assert rates["A"]["win_rate"] == pytest.approx((2 + 0.5) / 3)
    assert rates["B"]["win_rate"] == pytest.approx(0.5 / 3)


def test_bradley_terry_transitive_order():
    matches = []
    for _ in range(3):
        matches += [{"a": "A", "b": "B", "winner": "A"},
                    {"a": "B", "b": "C", "winner": "B"},
                    {"a": "A", "b": "C", "winner": "A"}]
    scores = fit_bradley_terry(matches)
    assert scores["A"] > scores["B"] > scores["C"]
    assert sum(scores.values()) == pytest.approx(1.0)


def test_bradley_terry_empty_and_ties():
    assert fit_bradley_terry([]) == {}
    scores = fit_bradley_terry([{"a": "A", "b": "B", "winner": "tie"}] * 4)
    assert scores["A"] == pytest.approx(scores["B"])


def test_estimate_calls_and_default_config():
    assert estimate_calls(5, CONFIG)["total_calls"] == 30
    default = load_judges_config()  # 真实 judges.json
    assert len(default["panel"]) == 3
    assert default["temperature"] == 0
    models = [m["model"] for m in default["panel"]]
    assert "ark/deepseek-v4-1-flash" not in models  # 与生成模型异构
    # 成本约束：默认评审团只用国产模型，避免误耗 OpenAI/Anthropic 额度
    assert not any(m.startswith(("openai/", "funcloud/claude", "anthropic/")) for m in models)
    assert estimate_calls(1)["total_calls"] == 6


def test_render_excludes_metadata():
    text = render_course_text(make_course("GOOD_MARKER"))
    assert "GOOD_MARKER" in text and "ETag" in text
    assert "deepseek" not in text and "run-secret" not in text


def test_aggregate_panel_tie_break_conservative():
    verdicts = [{"winner": "a", "dimensions": {}}, {"winner": "b", "dimensions": {}}]
    assert aggregate_panel(verdicts)["winner"] == "tie"


# ---------------------------------------------------------------- 报告装配 / 缺失容错

def test_load_trace_bundle_missing_tolerance(tmp_path):
    bundle = load_trace_bundle(tmp_path)
    assert bundle["course"] is None
    assert len(bundle["missing"]) == 4
    report = build_report(bundle)  # 空 trace 也能出报告
    assert "缺失文件" in report


def test_stage_assembly_fallback(tmp_path):
    (tmp_path / "stage_architect_chapters_parsed.json").write_text(json.dumps({
        "courseTopic": "HTTP", "chapters": [{"chapterId": "ch1", "title": "缓存"}]}), encoding="utf-8")
    (tmp_path / "stage_chapter_plan_parsed.json").write_text(json.dumps({
        "chapterId": "ch1", "tasks": [{"taskId": "t1", "title": "协商缓存", "objectiveId": "o1"}]}), encoding="utf-8")
    (tmp_path / "stage_task_content_t1_parsed.json").write_text(json.dumps({
        "blocks": [{"type": "markdown", "markdown": "ETag 内容"}]}), encoding="utf-8")
    (tmp_path / "stage_task_content_t1_meta.json").write_text(json.dumps({
        "model": "ark/deepseek-v4-1-flash", "usage": {"promptTokens": 10, "completionTokens": 20},
        "repair_applied": True, "fallback_level": 1}), encoding="utf-8")
    bundle = load_trace_bundle(tmp_path)
    course = bundle["course"]
    assert course["chapters"][0]["tasks"][0]["taskId"] == "t1"
    assert course["taskContents"]["t1"]["blocks"][0]["markdown"] == "ETag 内容"
    report = build_report(bundle)
    assert "repair_applied" in report and "拼装" in report


def test_report_assembly_full():
    grounding = {"grounding_rate": 0.5, "total_claims": 4, "supported": 2, "contradicted": 1,
                 "no_evidence": 1, "evidence_available": True,
                 "contradicted_claims": [{"text": "HTTP 默认端口是 8080", "reason": "证据表明是 80"}],
                 "unsupported_claims": [{"text": "某无证据声明", "reason": ""}]}
    alignment = {"coverage": {"objectives_total": 2, "with_content": 2, "with_assessment": 1,
                              "fully_covered": 1},
                 "breaks": [{"code": "OBJECTIVE_NO_ASSESSMENT", "detail": "目标 o2 无评估对应"}],
                 "judge_scores": []}
    gateway = JudgeGateway(llm_call=content_based_fake(), retry_delay=0)
    judge = run(evaluate_pair(make_course("GOOD_MARKER"), make_course("普通"),
                              config=CONFIG, gateway=gateway, pair_id="pair-1"))
    report = build_report({"run_meta": {"run_id": "r1"}, "spec": {"spec_id": "s1"}},
                          grounding=grounding, alignment=alignment, judge=judge)
    assert "50.0%" in report
    assert "幻觉事实" in report and "评估错位" in report
    assert "pair-1" in report and "成本统计" in report
    assert "事实准确" in report  # 五维表


# ---------------------------------------------------------------- 人工校准工作表

def _pairs_fixture():
    return [{"pair_id": f"pair-{i:02d}", "a_id": f"run-alpha-{i}", "b_id": f"run-beta-{i}",
             "course_a": make_course(f"甲内容{i}", topic=f"run-alpha-{i} 的 HTTP 课"),
             "course_b": make_course(f"乙内容{i}")} for i in range(4)]


def test_worksheet_anonymized_and_key_separate(tmp_path):
    info = make_calibration_worksheet(_pairs_fixture(), tmp_path, n=4, seed=42)
    worksheet = (tmp_path / "worksheet.md").read_text(encoding="utf-8")
    assert "deepseek" not in worksheet
    assert "run-alpha" not in worksheet and "run-beta" not in worksheet
    assert worksheet.count("## 对局") == 4
    key = json.loads((tmp_path / "key.json").read_text(encoding="utf-8"))
    assert len(key["pairs"]) == 4
    for entry in key["pairs"]:
        assert {entry["shown_a"], entry["shown_b"]} == {entry["orig_a"], entry["orig_b"]}


def test_worksheet_reproducible(tmp_path):
    make_calibration_worksheet(_pairs_fixture(), tmp_path / "a", seed=7)
    make_calibration_worksheet(_pairs_fixture(), tmp_path / "b", seed=7)
    assert (tmp_path / "a" / "worksheet.md").read_text() == (tmp_path / "b" / "worksheet.md").read_text()


def test_score_calibration_perfect_agreement(tmp_path):
    make_calibration_worksheet(_pairs_fixture(), tmp_path, seed=42)
    key = json.loads((tmp_path / "key.json").read_text(encoding="utf-8"))
    # 人类每次都选中原课程 A（按密钥换算展示位置），judge 也全胜 a → 一致率 1，κ 退化 1
    answers = [{"pair_id": e["pair_id"],
                "winner": "A" if e["shown_a"] == e["orig_a"] else "B"} for e in key["pairs"]]
    judge = [{"pair_id": e["pair_id"], "winner": "a"} for e in key["pairs"]]
    result = score_calibration(answers, key, judge)
    assert result["human_judge"]["agreement_rate"] == 1.0
    assert result["human_judge"]["kappa"] == 1.0


def test_score_calibration_known_kappa(tmp_path):
    make_calibration_worksheet(_pairs_fixture(), tmp_path, seed=42)
    key = json.loads((tmp_path / "key.json").read_text(encoding="utf-8"))
    # 人类相对标签 [a, a, b, tie]，judge [a, b, b, tie]
    # po=0.75, pe=0.5×0.25+0.25×0.5+0.25×0.25=0.3125 → κ=0.4375/0.6875≈0.636364
    human_rel = ["a", "a", "b", "tie"]
    judge_rel = ["a", "b", "b", "tie"]
    answers, judge = [], []
    for entry, h, j in zip(key["pairs"], human_rel, judge_rel):
        target = entry["orig_a"] if h == "a" else entry["orig_b"] if h == "b" else "tie"
        shown = "tie" if target == "tie" else ("A" if entry["shown_a"] == target else "B")
        answers.append({"pair_id": entry["pair_id"], "winner": shown})
        judge.append({"pair_id": entry["pair_id"], "winner": j})
    result = score_calibration(answers, key, judge)
    assert result["human_judge"]["agreement_rate"] == 0.75
    assert result["human_judge"]["kappa"] == pytest.approx(0.4375 / 0.6875, abs=1e-9)