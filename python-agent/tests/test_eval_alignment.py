# tests/test_eval_alignment.py — 对齐审计：覆盖矩阵 / 断裂编码 / judge 质量 / 容错
import asyncio
import json

import pytest

from evals.alignment import (
    build_coverage_matrix,
    extract_checkpoints,
    extract_objectives,
    extract_task_contents,
    extract_tasks,
    judge_alignment_quality,
    run_alignment,
)
from evals.judge import JudgeGateway


def run(coro):
    return asyncio.run(coro)


def json_response(payload):
    return {"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}


GOOD_COURSE = {
    "blueprint": {"courseObjectives": [{"objectiveId": "o1", "observableOutcome": "能判断 304 场景"}]},
    "chapters": [{"chapterId": "ch1", "tasks": [
        {"taskId": "t1", "title": "协商缓存", "objectiveId": "o1",
         "blocks": [{"type": "markdown", "markdown": "ETag 与 If-None-Match 的协商流程。"}]},
    ]}],
    "checkpoints": [{"checkpointId": "cp1", "objectiveId": "o1", "taskId": "t1",
                     "kind": "scenario_choice", "prompt": "资源未变时服务器返回什么？"}],
}

BROKEN_COURSE = {
    "blueprint": {"courseObjectives": [
        {"objectiveId": "o1", "observableOutcome": "能判断 304 场景"},
        {"objectiveId": "o2", "observableOutcome": "能配置 Cache-Control"},
        {"objectiveId": "o3", "observableOutcome": "能设计缓存策略"},
    ]},
    "chapters": [{"chapterId": "ch1", "tasks": [
        {"taskId": "t1", "objectiveId": "o1",
         "blocks": [{"type": "markdown", "markdown": "ETag 协商流程内容。"}]},
        {"taskId": "t2", "objectiveId": "o2"},  # 无内容 → TASK_EMPTY_CONTENT + o2 无承载
        {"taskId": "t3", "objectiveId": "oX", "prerequisiteTaskIds": ["t9"],
         "blocks": [{"type": "markdown", "markdown": "孤儿目标内容。"}]},
    ]}],
    "checkpoints": [
        {"checkpointId": "cp1", "objectiveId": "o1", "taskId": "t1", "prompt": "304 何时返回？"},
        {"checkpointId": "cp2", "taskId": "t2", "prompt": "max-age 含义？"},  # 经任务间接挂 o2
        {"checkpointId": "cp3", "objectiveId": "oZ", "taskId": "t9", "prompt": "悬空测验"},
    ],
}


def align_fake(fail=False, content=4, assessment=2):
    async def fake(messages, model, **kwargs):
        if fail:
            raise RuntimeError("对齐评估调用失败")
        return json_response({"content_alignment": content, "assessment_alignment": assessment,
                              "issues": ["测验只考记忆"], "comment": "内容尚可，评估偏弱"})
    return fake


# ---------------------------------------------------------------- 提取器

def test_extract_objectives_priority_and_fallback():
    assert extract_objectives(GOOD_COURSE)[0]["objectiveId"] == "o1"
    top = {"objectives": [{"objectiveId": "x", "text": "顶层目标"}]}
    assert extract_objectives(top)[0]["text"] == "顶层目标"
    thesis = {"architecture": {"thesis": {"learningDelta": ["从零到能配置缓存", "能诊断失效"]}}}
    objs = extract_objectives(thesis)
    assert [o["objectiveId"] for o in objs] == ["delta-1", "delta-2"]
    assert extract_objectives(None) == [] and extract_objectives({}) == []


def test_extract_tasks_dedup_and_contents():
    course = {"chapters": [{"chapterId": "ch1", "tasks": [{"taskId": "t1", "blocks": []}]}],
              "tasks": [{"taskId": "t1"}, {"taskId": "t2"}],
              "taskContents": {"t2": [{"type": "markdown", "markdown": "内容"}]}}
    tasks = extract_tasks(course)
    assert [t["taskId"] for t in tasks] == ["t1", "t2"]  # 同 id 去重
    contents = extract_task_contents(course)
    assert contents["t1"] == [] and contents["t2"][0]["markdown"] == "内容"


def test_extract_checkpoints_embedded_and_dedup():
    course = {
        "chapters": [{"chapterId": "ch1", "tasks": [
            {"taskId": "t1", "checkpoint": {"checkpointId": "cpA", "prompt": "内嵌测验"}},
        ]}],
        "taskContents": {"t2": {"checkpoint": {"checkpointId": "cpB", "prompt": "内容内嵌"}}},
        "checkpoints": [{"checkpointId": "cpA", "prompt": "重复项"}],
    }
    cps = extract_checkpoints(course)
    assert {c["checkpointId"] for c in cps} == {"cpA", "cpB"}
    by_id = {c["checkpointId"]: c for c in cps}
    assert by_id["cpB"]["taskId"] == "t2"  # 内嵌测验继承 taskId


# ---------------------------------------------------------------- 覆盖矩阵

def test_matrix_fully_covered_no_breaks():
    result = build_coverage_matrix(GOOD_COURSE)
    assert result["breaks"] == []
    assert result["coverage"]["full_coverage_rate"] == 1.0
    entry = result["matrix"][0]
    assert entry["content_task_ids"] == ["t1"]
    assert entry["assessment_checkpoint_ids"] == ["cp1"]
    assert entry["fully_covered"] is True


def test_matrix_break_codes_complete():
    result = build_coverage_matrix(BROKEN_COURSE)
    codes = {b["code"] for b in result["breaks"]}
    assert codes == {
        "TASK_DANGLING_OBJECTIVE",       # t3 → oX
        "TASK_PREREQ_MISSING",           # t3 → t9
        "TASK_EMPTY_CONTENT",            # t2 无内容
        "CHECKPOINT_DANGLING_OBJECTIVE", # cp3 → oZ
        "CHECKPOINT_DANGLING_TASK",      # cp3 → t9
        "OBJECTIVE_NO_CONTENT",          # o2（t2 空）、o3（无任务）
        "OBJECTIVE_NO_ASSESSMENT",       # o3
    }
    cov = result["coverage"]
    assert cov["objectives_total"] == 3
    assert cov["with_content"] == 1 and cov["with_assessment"] == 2
    assert cov["fully_covered"] == 1
    assert cov["full_coverage_rate"] == pytest.approx(1 / 3)
    by_oid = {m["objectiveId"]: m for m in result["matrix"]}
    # cp2 无 objectiveId，经 t2 间接挂到 o2
    assert by_oid["o2"]["assessment_checkpoint_ids"] == ["cp2"]
    assert by_oid["o2"]["content_covered"] is False
    assert by_oid["o3"]["fully_covered"] is False


def test_matrix_empty_course_tolerant():
    result = build_coverage_matrix({})
    assert result["matrix"] == [] and result["breaks"] == []
    assert result["coverage"]["objectives_total"] == 0
    assert result["coverage"]["full_coverage_rate"] is None


# ---------------------------------------------------------------- judge 质量（mock）

def test_judge_alignment_quality_scores_and_issues():
    matrix = build_coverage_matrix(GOOD_COURSE)["matrix"]
    gateway = JudgeGateway(llm_call=align_fake(), retry_delay=0)
    scores = run(judge_alignment_quality(GOOD_COURSE, matrix, gateway, "mock/m"))
    assert scores[0]["status"] == "ok"
    assert scores[0]["content_alignment"] == 4 and scores[0]["assessment_alignment"] == 2
    assert scores[0]["issues"] == ["测验只考记忆"]
    assert len(gateway.calls) == 1


def test_judge_alignment_quality_failure_recorded():
    matrix = build_coverage_matrix(GOOD_COURSE)["matrix"]
    gateway = JudgeGateway(llm_call=align_fake(fail=True), max_retries=1, retry_delay=0)
    scores = run(judge_alignment_quality(GOOD_COURSE, matrix, gateway, "mock/m"))
    assert scores[0]["status"] == "failed" and "error" in scores[0]


def test_judge_alignment_quality_sample_limit():
    matrix = build_coverage_matrix(BROKEN_COURSE)["matrix"]
    gateway = JudgeGateway(llm_call=align_fake(), retry_delay=0)
    scores = run(judge_alignment_quality(BROKEN_COURSE, matrix, gateway, "mock/m", sample=2))
    assert len(scores) == 2 and len(gateway.calls) == 2
    assert [s["objectiveId"] for s in scores] == ["o1", "o3"]  # 等距：首尾


# ---------------------------------------------------------------- 主流程 / 容错

def test_run_alignment_no_llm_zero_calls():
    result = run(run_alignment(course=BROKEN_COURSE, with_llm=False))
    assert result["judge_scores"] == [] and result["llm_calls"] == []
    assert len(result["breaks"]) >= 7


def test_run_alignment_with_mock_gateway():
    gateway = JudgeGateway(llm_call=align_fake(), retry_delay=0)
    result = run(run_alignment(course=BROKEN_COURSE, gateway=gateway, model="mock/m"))
    assert len(result["judge_scores"]) == 3
    assert result["model"] == "mock/m"
    assert len(result["llm_calls"]) == 3


def test_run_alignment_missing_trace(tmp_path):
    result = run(run_alignment(trace_dir=tmp_path, with_llm=False))
    assert result["matrix"] == [] and result["judge_scores"] == []
    assert any("course.json 缺失" in n for n in result["notes"])


def test_run_alignment_trace_dir_course(tmp_path):
    (tmp_path / "course.json").write_text(json.dumps(GOOD_COURSE, ensure_ascii=False), encoding="utf-8")
    result = run(run_alignment(trace_dir=tmp_path, with_llm=False))
    assert result["coverage"]["full_coverage_rate"] == 1.0


def test_run_alignment_empty_objectives_skips_llm():
    gateway = JudgeGateway(llm_call=align_fake(), retry_delay=0)
    result = run(run_alignment(course={"chapters": []}, gateway=gateway, model="mock/m"))
    assert result["judge_scores"] == [] and gateway.calls == []
    assert any("无学习目标" in n for n in result["notes"])


# ---------------------------------------------------------------- Bug1 回归：plan 映射 + 跨章 t1

# 生成任务（chapters[].tasks）只有 taskId/blocks，无 objectiveId；
# 目标映射在 chapters[].plan.tasks。每章第一个任务都叫 t1（跨章复用）。
PLAN_MAPPING_COURSE = {
    "blueprint": {"courseObjectives": [
        {"objectiveId": "o1", "observableOutcome": "能解释强缓存"},
        {"objectiveId": "o2", "observableOutcome": "能解释协商缓存"},
    ]},
    "chapters": [
        {"chapterId": "ch1",
         "plan": {"chapterId": "ch1", "tasks": [{"taskId": "t1", "objectiveId": "o1"}]},
         "tasks": [{"taskId": "t1", "title": "强缓存",
                    "blocks": [{"type": "markdown", "markdown": "Cache-Control 强缓存内容足够长。"}]}]},
        {"chapterId": "ch2",
         "plan": {"chapterId": "ch2", "tasks": [{"taskId": "t1", "objectiveId": "o2"}]},
         "tasks": [{"taskId": "t1", "title": "协商缓存",
                    "blocks": [{"type": "markdown", "markdown": "ETag 协商缓存内容足够长。"}]}]},
    ],
    "checkpoints": [
        {"checkpointId": "cp1", "objectiveId": "o1", "taskId": "t1", "chapterId": "ch1", "prompt": "强缓存？"},
        {"checkpointId": "cp2", "objectiveId": "o2", "taskId": "t1", "chapterId": "ch2", "prompt": "协商？"},
    ],
}


def test_extract_tasks_plan_mapping_cross_chapter():
    # 跨章同名 t1 不合并：两章任务都保留，objectiveId 由章内 plan 映射补齐
    tasks = extract_tasks(PLAN_MAPPING_COURSE)
    assert len(tasks) == 2
    assert all(t["taskId"] == "t1" for t in tasks)
    by_ch = {t["chapterId"]: t for t in tasks}
    assert by_ch["ch1"]["objectiveId"] == "o1"
    assert by_ch["ch2"]["objectiveId"] == "o2"


def test_extract_tasks_own_objective_wins_over_plan():
    # 任务自带 objectiveId 时优先，不被 plan 映射覆盖
    course = {"chapters": [{"chapterId": "ch1",
                            "plan": {"tasks": [{"taskId": "t1", "objectiveId": "o-plan"}]},
                            "tasks": [{"taskId": "t1", "objectiveId": "o-own"}]}],
              "blueprint": {"courseObjectives": [{"objectiveId": "o-own", "observableOutcome": "x"}]}}
    assert extract_tasks(course)[0]["objectiveId"] == "o-own"


def test_matrix_plan_mapping_full_coverage():
    # Bug1 核心回归：生成任务无 objectiveId，经 plan 映射后覆盖矩阵不再全 0
    result = build_coverage_matrix(PLAN_MAPPING_COURSE)
    assert result["breaks"] == []
    cov = result["coverage"]
    assert cov["objectives_total"] == 2
    assert cov["with_content"] == 2 and cov["with_assessment"] == 2
    assert cov["fully_covered"] == 2 and cov["full_coverage_rate"] == 1.0
    by_oid = {m["objectiveId"]: m for m in result["matrix"]}
    assert by_oid["o1"]["content_task_ids"] == ["t1"]
    assert by_oid["o2"]["content_task_ids"] == ["t1"]
    # 章感知：o1 内容来自 ch1，o2 来自 ch2（content_task_refs 区分跨章 t1）
    assert by_oid["o1"]["content_task_refs"] == [{"chapterId": "ch1", "taskId": "t1"}]
    assert by_oid["o2"]["content_task_refs"] == [{"chapterId": "ch2", "taskId": "t1"}]


def test_checkpoint_indirect_mapping_chapter_scoped():
    # cp 无 objectiveId，仅 taskId+chapterId → 按章间接挂目标（不串章）
    course = {
        "blueprint": {"courseObjectives": [
            {"objectiveId": "o1", "observableOutcome": "a"},
            {"objectiveId": "o2", "observableOutcome": "b"},
        ]},
        "chapters": [
            {"chapterId": "ch1", "plan": {"tasks": [{"taskId": "t1", "objectiveId": "o1"}]},
             "tasks": [{"taskId": "t1", "blocks": [{"type": "markdown", "markdown": "内容一足够长。"}]}]},
            {"chapterId": "ch2", "plan": {"tasks": [{"taskId": "t1", "objectiveId": "o2"}]},
             "tasks": [{"taskId": "t1", "blocks": [{"type": "markdown", "markdown": "内容二足够长。"}]}]},
        ],
        "checkpoints": [{"checkpointId": "cp2", "taskId": "t1", "chapterId": "ch2", "prompt": "题"}],
    }
    by_oid = {m["objectiveId"]: m for m in build_coverage_matrix(course)["matrix"]}
    assert by_oid["o2"]["assessment_checkpoint_ids"] == ["cp2"]
    assert by_oid["o1"]["assessment_checkpoint_ids"] == []


def test_judge_alignment_quality_chapter_aware_content():
    # judge 取内容按 (chapterId, taskId) 定位：跨章 t1 不串内容
    matrix = build_coverage_matrix(PLAN_MAPPING_COURSE)["matrix"]
    seen = []

    async def fake(messages, model, **kwargs):
        seen.append(messages[-1]["content"])
        return json_response({"content_alignment": 4, "assessment_alignment": 4,
                              "issues": [], "comment": "ok"})

    gateway = JudgeGateway(llm_call=fake, retry_delay=0)
    run(judge_alignment_quality(PLAN_MAPPING_COURSE, matrix, gateway, "mock/m"))
    assert len(seen) == 2
    # o1 的 prompt 含 ch1 内容（Cache-Control），o2 含 ch2 内容（ETag），互不串
    assert "Cache-Control" in seen[0] and "ETag" not in seen[0]
    assert "ETag" in seen[1] and "Cache-Control" not in seen[1]