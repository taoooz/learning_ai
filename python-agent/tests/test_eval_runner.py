"""evals/runner.py 测试：spec 归一化、blueprint 编译规则、dry-run 全链路装配。

dry-run 用内置 DryRunClient 走真实服务函数与真实 trace hook（不调 LLM），
验证：请求装配、blueprint 编译、course 组装、trace 契约完整性、
EVAL_TRACE_DIR 未设置时零副作用。
"""
import argparse
import asyncio
import json
import os

import pytest

from evals import runner
from evals import trace as eval_trace


@pytest.fixture(autouse=True)
def _restore_env():
    snapshot = dict(os.environ)
    yield
    os.environ.clear()
    os.environ.update(snapshot)
    eval_trace.end_spec()


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# spec 归一化（宽松契约）
# ---------------------------------------------------------------------------

def test_normalize_spec_defaults():
    spec = runner.normalize_spec({"topic": "SQL 索引"}, 0)
    assert spec["id"] == "spec-01"
    assert spec["learningGoal"] == "完成 SQL 索引 的独立学习目标"
    assert spec["learnerPositioning"]["estimatedLevel"] == "beginner"
    assert spec["learnerPositioning"]["skipBasics"] == []


def test_normalize_spec_difficulty_and_string_learner():
    spec = runner.normalize_spec({"topic": "t", "difficulty": "advanced"}, 2)
    assert spec["id"] == "spec-03"
    assert spec["learnerPositioning"]["estimatedLevel"] == "advanced"
    # learnerPositioning 显式给 estimatedLevel 时优先于 difficulty
    spec = runner.normalize_spec(
        {"topic": "t", "difficulty": "advanced", "learnerPositioning": {"estimatedLevel": "intermediate"}}, 0
    )
    assert spec["learnerPositioning"]["estimatedLevel"] == "intermediate"
    spec = runner.normalize_spec({"topic": "t", "learnerPositioning": "会基础语法"}, 0)
    assert spec["learnerPositioning"]["backgroundSummary"] == "会基础语法"


def test_normalize_spec_missing_topic_raises():
    with pytest.raises(ValueError, match="topic"):
        runner.normalize_spec({"id": "x"}, 0)


def test_load_golden_set_wrapped(tmp_path):
    path = tmp_path / "golden.json"
    path.write_text(json.dumps({"specs": [{"topic": "a"}, {"topic": "b"}]}), encoding="utf-8")
    specs = runner.load_golden_set(path)
    assert [s["id"] for s in specs] == ["spec-01", "spec-02"]
    path.write_text(json.dumps({"not": "a list"}), encoding="utf-8")
    with pytest.raises(ValueError):
        runner.load_golden_set(path)


# ---------------------------------------------------------------------------
# blueprint 编译（与 TS 编译器规则一致）
# ---------------------------------------------------------------------------

ARCHITECTURE = {
    "architectureVersion": 1,
    "courseTopic": "Python 装饰器",
    "thesis": {
        "audience": "零基础", "currentBoundary": [],
        "targetCapability": "独立写出带参数的装饰器",
        "learningDelta": ["从理解闭包到能写装饰器"],
        "nonGoals": ["元类"],
    },
    "conceptGraph": [
        {"conceptId": "c-1", "label": "闭包", "targetDepth": "understand", "rationale": "r", "prerequisiteConceptIds": []},
        {"conceptId": "c-2", "label": "装饰器语法", "targetDepth": "apply", "rationale": "r", "prerequisiteConceptIds": ["c-1"]},
        {"conceptId": "c-3", "label": "历史背景", "targetDepth": "refresh", "rationale": "r", "prerequisiteConceptIds": []},
    ],
    "chapters": [
        {"chapterId": "ch-1", "title": "闭包基础", "roleInCourse": "理解闭包机制",
         "conceptIds": ["c-1", "c-3"], "deliverable": "解释闭包的形成机制",
         "prerequisites": [], "assessmentMode": "self_report"},
        {"chapterId": "ch-2", "title": "装饰器实战", "roleInCourse": "应用装饰器语法",
         "conceptIds": ["c-2"], "deliverable": "写出带参数的装饰器",
         "prerequisites": ["ch-1"], "assessmentMode": "checkpoint"},
    ],
    "examplePolicy": {"preferredDomains": ["后端开发"], "personalExampleLimit": 2, "avoidRepeatedScenarios": True},
}


def test_compile_blueprint_mapping_rules():
    learner = {
        "estimatedLevel": "中级", "skipBasics": ["变量与函数"], "likelyGaps": ["闭包"],
        "personalExampleLimit": 3,
    }
    blueprint = runner.compile_blueprint("eval-x", ARCHITECTURE, learner, now=123)
    assert blueprint["blueprintId"] == "bp-eval-x"
    assert blueprint["protocolVersion"] == 2
    assert blueprint["topic"] == "Python 装饰器"
    assert blueprint["createdAt"] == 123
    assert blueprint["promptVersion"] == "course-architecture-compiler-v1"

    objectives = blueprint["courseObjectives"]
    assert [o["objectiveId"] for o in objectives] == ["obj-1", "obj-2"]
    # understand → supporting；apply → core
    assert objectives[0]["importance"] == "supporting"
    assert objectives[1]["importance"] == "core"
    # self_report → self_report；checkpoint → demonstration
    assert objectives[0]["evidenceRequirement"] == "self_report"
    assert objectives[1]["evidenceRequirement"] == "demonstration"
    assert objectives[0]["conceptKeys"] == ["闭包", "历史背景"]
    assert objectives[0]["description"] == "理解闭包机制"
    assert objectives[0]["observableOutcome"] == "解释闭包的形成机制"

    chapters = blueprint["chapters"]
    assert [c["index"] for c in chapters] == [1, 2]
    assert chapters[0]["objectiveIds"] == ["obj-1"]
    assert chapters[1]["prerequisites"] == ["ch-1"]
    assert chapters[1]["completionCriteria"] == ["写出带参数的装饰器"]

    assert blueprint["mission"]["outOfScope"] == ["元类"]
    assert blueprint["mission"]["why"] == "从理解闭包到能写装饰器"
    assert blueprint["mission"]["successCriteria"] == ["解释闭包的形成机制", "写出带参数的装饰器"]

    starting = blueprint["learnerStartingPoint"]
    assert starting["estimatedLevel"] == "intermediate"
    assert starting["confirmedKnowledge"] == ["变量与函数"]
    assert starting["excludedTopics"] == ["变量与函数"]
    assert starting["likelyGaps"] == ["闭包"]
    assert starting["personalExampleLimit"] == 3
    # learner 未给 preferredExampleDomains → 回退 examplePolicy
    assert starting["preferredExampleDomains"] == ["后端开发"]
    # goalText 无意图关键词 → conceptual_understanding
    assert blueprint["intentType"] == "conceptual_understanding"


def test_compile_blueprint_core_fallback_and_intent():
    architecture = json.loads(json.dumps(ARCHITECTURE))
    for concept in architecture["conceptGraph"]:
        concept["targetDepth"] = "refresh"
    blueprint = runner.compile_blueprint("c", architecture, {})
    # 无 core 目标时最后一个提升为 core
    assert [o["importance"] for o in blueprint["courseObjectives"]] == ["optional", "core"]
    # 显式合法 intent 透传；非法值回退推断
    assert runner.compile_blueprint("c", ARCHITECTURE, {}, intent_type="skill_mastery")["intentType"] == "skill_mastery"
    assert runner.compile_blueprint("c", ARCHITECTURE, {}, intent_type="bogus")["intentType"] == "conceptual_understanding"
    # 关键词推断：实操/动手 → skill_mastery
    architecture["thesis"]["targetCapability"] = "动手搭建一个完整示例"
    assert runner.compile_blueprint("c", architecture, {})["intentType"] == "skill_mastery"


def test_compile_blueprint_reference_assertions():
    architecture = json.loads(json.dumps(ARCHITECTURE))
    architecture["chapters"][0]["conceptIds"] = ["missing"]
    with pytest.raises(ValueError, match="不存在的概念"):
        runner.compile_blueprint("c", architecture, {})
    architecture = json.loads(json.dumps(ARCHITECTURE))
    architecture["chapters"][1]["prerequisites"] = ["missing-ch"]
    with pytest.raises(ValueError, match="不存在的前置章节"):
        runner.compile_blueprint("c", architecture, {})


# ---------------------------------------------------------------------------
# dry-run 全链路：真实服务 + 真实 trace hook + 罐头 LLM
# ---------------------------------------------------------------------------

def _write_golden(tmp_path, specs):
    path = tmp_path / "golden.json"
    path.write_text(json.dumps(specs, ensure_ascii=False), encoding="utf-8")
    return path


def test_dry_run_full_trace_contract(tmp_path):
    golden = _write_golden(tmp_path, [{"id": "s1", "topic": "Python 装饰器"}])
    trace_dir = tmp_path / "traces"
    rc = runner.main([
        str(golden), "--dry-run", "--run-id", "test-run",
        "--trace-dir", str(trace_dir), "--max-tasks", "2",
    ])
    assert rc == 0

    spec_dir = trace_dir / "test-run" / "s1"
    assert _read(spec_dir / "spec.json")["topic"] == "Python 装饰器"
    # Bug4：章/任务阶段带作用域（chapter_plan_<ch> / search_decision_<ch>_<tid> /
    # task_content_<ch>_<tid> / checkpoints_<ch>），architect 课程级不变
    stages = [
        "architect_chapters", "architect_meta",
        "chapter_plan_ch-1", "chapter_plan_ch-2",
        "search_decision_ch-1_t-1", "search_decision_ch-1_t-2",
        "search_decision_ch-2_t-1", "search_decision_ch-2_t-2",
        "task_content_ch-1_t-1", "task_content_ch-1_t-2",
        "task_content_ch-2_t-1", "task_content_ch-2_t-2",
        "checkpoints_ch-1", "checkpoints_ch-2",
    ]
    for stage in stages:
        for suffix in ("request.json", "raw.txt", "parsed.json", "meta.json"):
            assert (spec_dir / f"stage_{stage}_{suffix}").exists(), f"缺少 stage_{stage}_{suffix}"
        meta = _read(spec_dir / f"stage_{stage}_meta.json")
        assert meta["model"] == "dry-run-model"
        assert meta["fallback_level"] in ("strict", "json_object", "none")
    # 旧无作用域名不应再出现（跨章同名任务不再互相覆盖）
    assert not (spec_dir / "stage_task_content_t-1_parsed.json").exists()
    assert not (spec_dir / "stage_chapter_plan_parsed.json").exists()

    # architect raw 是修复前原文（罐头 JSON），parse 无修复
    chapters_meta = _read(spec_dir / "stage_architect_chapters_meta.json")
    assert chapters_meta["repair_applied"] is False
    assert chapters_meta["fallback_level"] == "strict"

    # course 组装：蓝图 + blueprint + 章节计划 + 任务内容块
    course = _read(spec_dir / "course.json")
    assert course["status"] == "completed"
    assert course["dryRun"] is True
    assert course["architecture"]["courseTopic"] == "Python 装饰器"
    blueprint = course["blueprint"]
    assert len(blueprint["courseObjectives"]) == 2
    assert len(course["chapters"]) == 2
    for chapter in course["chapters"]:
        assert chapter["plan"]["tasks"]
        assert len(chapter["tasks"]) == 2
        for task in chapter["tasks"]:
            assert task["blocks"], "任务正文 blocks 为空"
            assert task["boundaryPrompt"]["takeaway"]

    # checkpoint 阶段：每任务一道，objectiveId 来自 plan.tasks 映射（生成任务本身不带）
    assert len(course["checkpoints"]) == 4
    for cp in course["checkpoints"]:
        assert cp["objectiveId"] and cp["taskId"] and cp["chapterId"]
        assert cp["kind"] == "scenario_choice"
        assert cp.get("status") != "failed"
    cp_parsed = _read(spec_dir / "stage_checkpoints_ch-1_parsed.json")
    assert cp_parsed["chapterId"] == "ch-1" and len(cp_parsed["checkpoints"]) == 2

    # previousTasks 装配：ch-1 的 t-2 请求里应含 t-1 的标题
    t2_request = _read(spec_dir / "stage_task_content_ch-1_t-2_request.json")
    assert "概念讲解" in json.dumps(t2_request["messages"], ensure_ascii=False)

    # 证据快照与运行元信息
    assert (spec_dir / "evidence_snapshot.json").exists()
    run_meta = _read(trace_dir / "test-run" / "run_meta.json")
    assert run_meta["dryRun"] is True
    assert run_meta["specCount"] == 1
    assert run_meta["checkpoints"] is True
    assert run_meta["llmCallTotal"] > 0
    assert run_meta["specs"][0]["llmCalls"]["architect_chapters"] >= 1
    assert run_meta["specs"][0]["checkpoints"] == 4


def test_dry_run_specs_filter_and_max_chapters(tmp_path):
    golden = _write_golden(tmp_path, [{"id": "s1", "topic": "主题甲"}, {"id": "s2", "topic": "主题乙"}])
    trace_dir = tmp_path / "traces"
    rc = runner.main([
        str(golden), "--dry-run", "--run-id", "r2", "--trace-dir", str(trace_dir),
        "--specs", "s2", "--max-chapters", "1", "--max-tasks", "1",
    ])
    assert rc == 0
    assert not (trace_dir / "r2" / "s1").exists()
    course = _read(trace_dir / "r2" / "s2" / "course.json")
    assert course["topic"] == "主题乙"
    assert len(course["chapters"]) == 1
    assert len(course["chapters"][0]["tasks"]) == 1
    assert (trace_dir / "r2" / "s2" / "stage_task_content_ch-1_t-1_raw.txt").exists()
    assert not (trace_dir / "r2" / "s2" / "stage_task_content_ch-1_t-2_raw.txt").exists()
    # max_tasks=1 → 只为 t-1 生成一道 checkpoint
    assert len(course["checkpoints"]) == 1
    assert course["checkpoints"][0]["taskId"] == "t-1"


def test_run_spec_without_trace_dir_zero_side_effects(tmp_path, monkeypatch):
    monkeypatch.delenv("EVAL_TRACE_DIR", raising=False)
    monkeypatch.setenv("EVIDENCE_STORE_DIR", str(tmp_path / "evidence"))
    monkeypatch.setenv("DISABLE_WEB_SEARCH", "1")
    monkeypatch.setenv("DISABLE_EVIDENCE_SEARCH", "1")
    spec = runner.normalize_spec({"id": "s1", "topic": "Python 装饰器"}, 0)
    args = argparse.Namespace(dry_run=True, no_search=True, max_tasks=1, max_chapters=1)
    result = asyncio.run(runner.run_spec(spec, args, "run-no-trace"))
    assert result["status"] == "completed"
    assert result["llmCalls"] == {}
    assert eval_trace.current_spec_dir() is None
    # 未设置开关：不产生任何 trace 文件（证据目录只读不写）
    assert not (tmp_path / "run-no-trace").exists()
    assert list(tmp_path.iterdir()) == []


# ---------------------------------------------------------------------------
# Bug2 回归：checkpoint 阶段开关 / 失败降级
# ---------------------------------------------------------------------------

def test_dry_run_no_checkpoints_switch(tmp_path):
    golden = _write_golden(tmp_path, [{"id": "s1", "topic": "Python 装饰器"}])
    trace_dir = tmp_path / "traces"
    rc = runner.main([
        str(golden), "--dry-run", "--run-id", "nc", "--trace-dir", str(trace_dir),
        "--max-tasks", "2", "--no-checkpoints",
    ])
    assert rc == 0
    spec_dir = trace_dir / "nc" / "s1"
    course = _read(spec_dir / "course.json")
    assert course["status"] == "completed"
    assert course["checkpoints"] == []
    # 关闭后不产生任何 checkpoint 阶段文件
    assert not list(spec_dir.glob("stage_checkpoints_*"))
    run_meta = _read(trace_dir / "nc" / "run_meta.json")
    assert run_meta["checkpoints"] is False
    assert run_meta["specs"][0]["checkpoints"] == 0


def test_checkpoint_failure_marks_partial(tmp_path, monkeypatch):
    import services.checkpoint_service as cps

    async def boom(**kwargs):
        raise RuntimeError("checkpoint 生成失败")

    monkeypatch.setattr(cps, "generate_checkpoint", boom)
    golden = _write_golden(tmp_path, [{"id": "s1", "topic": "Python 装饰器"}])
    trace_dir = tmp_path / "traces"
    rc = runner.main([
        str(golden), "--dry-run", "--run-id", "cf", "--trace-dir", str(trace_dir),
        "--max-chapters", "1", "--max-tasks", "1",
    ])
    assert rc == 0
    course = _read(trace_dir / "cf" / "s1" / "course.json")
    # 单题失败不中断整章，但 spec 标 partial
    assert course["status"] == "partial"
    assert len(course["checkpoints"]) == 1
    cp = course["checkpoints"][0]
    assert cp["status"] == "failed"
    assert "checkpoint 生成失败" in cp["error"]
    assert cp["taskId"] == "t-1" and cp["chapterId"] == "ch-1"
    # 失败也留 parsed 审计（四件套契约）
    cp_parsed = _read(trace_dir / "cf" / "s1" / "stage_checkpoints_ch-1_parsed.json")
    assert cp_parsed["checkpoints"][0]["status"] == "failed"
    run_meta = _read(trace_dir / "cf" / "run_meta.json")
    assert run_meta["specs"][0]["checkpoints"] == 0  # 成功计数不含 failed
