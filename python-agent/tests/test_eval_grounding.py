# tests/test_eval_grounding.py — 事实溯源：单元提取 / 抽样 / 归因 / 溯源率 / 缺失容错
import asyncio
import json

import pytest

from evals.grounding import (
    attribute_claims,
    compute_evidence_coverage,
    decompose_claims,
    extract_content_units,
    extract_request_evidence,
    find_dangling_citations,
    flatten_evidence_sources,
    run_grounding,
    select_sample,
    summarize_grounding,
)
from evals.judge import JudgeGateway


def run(coro):
    return asyncio.run(coro)


def json_response(payload):
    return {"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}


COURSE = {
    "chapters": [{"chapterId": "ch1", "title": "HTTP 基础", "tasks": [
        {"taskId": "t1", "title": "端口", "blocks": [
            {"type": "markdown", "markdown": "PORT80：HTTP 默认端口是 80。"},
            {"type": "markdown", "markdown": "短"},  # <8 字，跳过
        ]},
        {"taskId": "t2", "title": "缓存", "blocks": [
            {"type": "markdown", "markdown": "ETAG：ETag 是资源版本标识。"},
        ]},
    ]}],
    "taskContents": {"t-orphan": {"blocks": [
        {"type": "example", "context": "场景", "content": "ORPHAN：缓存命中返回 200。", "takeaway": "要点"},
    ]}},
}

EVIDENCE = {"sources": [{"evidenceId": "ev-01-abc123", "title": "MDN HTTP",
                         "url": "https://example.com/http", "summary": "HTTP 默认端口是 80。",
                         "kind": "documentation", "authorityScore": 0.9}]}


def grounding_fake(fail_decompose_marker=None, fail_attribute=False, bad_verdict=False):
    """按系统提示区分分解/归因两步的 fake judge。"""
    async def fake(messages, model, **kwargs):
        system, user = messages[0]["content"], messages[-1]["content"]
        if "事实核查员" in system:
            if fail_decompose_marker and fail_decompose_marker in user:
                raise RuntimeError("分解调用失败")
            if "PORT80" in user:
                return json_response({"claims": [{"text": "HTTP 默认端口是 80", "excerpt": "默认端口是 80"}]})
            if "ETAG" in user:
                return json_response({"claims": [{"text": "ETag 是资源版本标识", "excerpt": "版本标识"}]})
            if "ORPHAN" in user:
                return json_response({"claims": [{"text": "缓存命中返回 200", "excerpt": "返回 200"}]})
            return json_response({"claims": []})
        # 归因
        if fail_attribute:
            raise RuntimeError("归因调用失败")
        rows = []
        for line in user.split("## 待归因声明", 1)[1].strip().splitlines():
            cid, _, text = line.partition(":")
            text = text.strip()
            if "端口是 80" in text:
                rows.append({"claim_id": cid.strip(), "verdict": "maybe" if bad_verdict else "supported",
                             "evidence_ids": ["ev-01-abc123"], "reason": "摘要明确支撑"})
            else:
                rows.append({"claim_id": cid.strip(), "verdict": "no_evidence",
                             "evidence_ids": [], "reason": "摘要未覆盖"})
        return json_response({"attributions": rows})
    return fake


# ---------------------------------------------------------------- 提取与抽样

def test_extract_content_units_blocks_and_orphans():
    units = extract_content_units(COURSE)
    ids = [u["unit_id"] for u in units]
    assert ids == ["t1-b0", "t2-b0", "t-orphan-b0"]  # 短块被跳过，孤儿任务被收
    assert units[0]["task_title"] == "端口"
    assert "缓存命中返回 200" in units[2]["text"] and "要点" in units[2]["text"]


def test_extract_content_units_block_types():
    course = {"tasks": [{"taskId": "t", "blocks": [
        {"type": "key_point", "points": ["要点一：缓存减少往返", "要点二：协商验证新鲜度"]},
        {"type": "definition", "term": "ETag", "definition": "资源版本标识"},
        {"type": "comparison", "columns": ["强缓存", "协商缓存"], "rows": [["200", "304"]]},
    ]}]}
    texts = [u["text"] for u in extract_content_units(course)]
    assert "要点一：缓存减少往返\n要点二：协商验证新鲜度" in texts
    assert "ETag：资源版本标识" in texts
    assert any("强缓存 | 协商缓存" in t and "200 | 304" in t for t in texts)


def test_extract_content_units_tolerates_garbage():
    assert extract_content_units(None) == []
    assert extract_content_units({}) == []
    assert extract_content_units({"chapters": [None, {"tasks": [None]}]}) == []


def test_select_sample_deterministic_equidistant():
    units = [{"unit_id": f"u{i}"} for i in range(10)]
    picked = select_sample(units, 4)
    assert [u["unit_id"] for u in picked] == ["u0", "u3", "u6", "u9"]
    assert select_sample(units, 4) == picked  # 可复现
    assert select_sample(units, None) == units
    assert select_sample(units, 0) == units
    assert select_sample(units, 99) == units
    assert select_sample(units, 1) == [units[0]]


# ---------------------------------------------------------------- 证据快照

def test_flatten_evidence_sources_shapes_and_dedup():
    src = EVIDENCE["sources"][0]
    assert flatten_evidence_sources(EVIDENCE)[0]["evidenceId"] == "ev-01-abc123"
    packs = {"packs": [{"sources": [src]}, {"sources": [src]}]}
    assert len(flatten_evidence_sources(packs)) == 1  # 去重
    assert len(flatten_evidence_sources([src])) == 1
    assert flatten_evidence_sources(None) == []
    url_only = [{"url": "https://x", "summary": "s"}]
    assert flatten_evidence_sources(url_only)[0]["evidenceId"] == ""


def test_find_dangling_citations():
    course = {"tasks": [{"taskId": "t", "blocks": [
        {"type": "markdown", "markdown": "见 ev-01-abc123 与 ev-99-deadbe。"}]}]}
    sources = flatten_evidence_sources(EVIDENCE)
    assert find_dangling_citations(course, sources) == ["ev-99-deadbe"]
    assert find_dangling_citations({}, sources) == []


# ---------------------------------------------------------------- LLM 步骤（mock）

def test_decompose_claims_numbering_and_failure_skip():
    units = extract_content_units(COURSE)
    gateway = JudgeGateway(llm_call=grounding_fake(fail_decompose_marker="ETAG"),
                           max_retries=1, retry_delay=0)
    claims = run(decompose_claims(units, gateway, "mock/m"))
    # t2 分解失败被跳过，其余两个单元各 1 条声明，连续编号
    assert [c["claim_id"] for c in claims] == ["c1", "c2"]
    assert claims[0]["text"] == "HTTP 默认端口是 80"
    assert claims[0]["unit_id"] == "t1-b0"


def test_attribute_claims_no_sources_all_no_evidence():
    claims = [{"claim_id": "c1", "text": "x"}, {"claim_id": "c2", "text": "y"}]
    gateway = JudgeGateway(llm_call=grounding_fake(), retry_delay=0)
    rows = run(attribute_claims(claims, [], gateway, "mock/m"))
    assert all(r["verdict"] == "no_evidence" for r in rows)
    assert gateway.calls == []  # 无证据时不调用 LLM


def test_attribute_claims_batch_failure_conservative():
    claims = [{"claim_id": "c1", "text": "HTTP 默认端口是 80"}]
    gateway = JudgeGateway(llm_call=grounding_fake(fail_attribute=True), max_retries=1, retry_delay=0)
    rows = run(attribute_claims(claims, flatten_evidence_sources(EVIDENCE), gateway, "mock/m"))
    assert rows[0]["verdict"] == "no_evidence"
    assert "失败" in rows[0]["reason"]


def test_attribute_claims_invalid_verdict_normalized():
    claims = [{"claim_id": "c1", "text": "HTTP 默认端口是 80"}]
    gateway = JudgeGateway(llm_call=grounding_fake(bad_verdict=True), retry_delay=0)
    rows = run(attribute_claims(claims, flatten_evidence_sources(EVIDENCE), gateway, "mock/m"))
    assert rows[0]["verdict"] == "no_evidence"


def test_attribute_claims_batching():
    claims = [{"claim_id": f"c{i}", "text": f"声明{i}"} for i in range(1, 6)]
    gateway = JudgeGateway(llm_call=grounding_fake(), retry_delay=0)
    rows = run(attribute_claims(claims, flatten_evidence_sources(EVIDENCE), gateway, "mock/m", batch_size=2))
    assert len(rows) == 5 and len(gateway.calls) == 3  # 2+2+1 三批


def test_summarize_grounding_known_rate():
    claims = [{"claim_id": f"c{i}", "text": f"声明{i}"} for i in range(1, 5)]
    attributions = [
        {"claim_id": "c1", "verdict": "supported", "evidence_ids": ["ev-01-abc123"], "reason": ""},
        {"claim_id": "c2", "verdict": "supported", "evidence_ids": ["ev-01-abc123"], "reason": ""},
        {"claim_id": "c3", "verdict": "contradicted", "evidence_ids": ["ev-01-abc123"], "reason": "端口应为 80"},
        {"claim_id": "c4", "verdict": "no_evidence", "evidence_ids": [], "reason": "未覆盖"},
    ]
    summary = summarize_grounding(claims, attributions)
    assert summary["grounding_rate"] == 0.5
    assert summary["supported"] == 2 and summary["contradicted"] == 1 and summary["no_evidence"] == 1
    assert summary["contradicted_claims"][0]["claim_id"] == "c3"
    assert summary["unsupported_claims"][0]["claim_id"] == "c4"
    empty = summarize_grounding([], [])
    assert empty["grounding_rate"] is None and empty["total_claims"] == 0


def test_summarize_missing_attribution_defaults_no_evidence():
    summary = summarize_grounding([{"claim_id": "c1", "text": "x"}], [])
    assert summary["no_evidence"] == 1 and summary["grounding_rate"] == 0.0


# ---------------------------------------------------------------- 主流程 / 容错

def test_run_grounding_end_to_end_mock():
    gateway = JudgeGateway(llm_call=grounding_fake(), retry_delay=0)
    result = run(run_grounding(course=COURSE, evidence=EVIDENCE, gateway=gateway, model="mock/m"))
    assert result["total_claims"] == 3
    assert result["supported"] == 1  # 只有端口声明有证据支撑
    assert result["grounding_rate"] == pytest.approx(1 / 3)
    assert result["evidence_available"] is True and result["evidence_count"] == 1
    assert result["units_total"] == 3 and result["sampled"] is False
    assert len(result["llm_calls"]) == 4  # 3 分解 + 1 归因批


def test_run_grounding_sample_limits_calls():
    gateway = JudgeGateway(llm_call=grounding_fake(), retry_delay=0)
    result = run(run_grounding(course=COURSE, evidence=EVIDENCE, gateway=gateway,
                               model="mock/m", sample=1))
    assert result["sampled"] is True and result["units_evaluated"] == 1
    assert result["total_claims"] == 1  # 只分解第一个单元
    assert len(gateway.calls) == 2  # 1 分解 + 1 归因


def test_run_grounding_missing_evidence_no_retrieval():
    # 契约变更（非回归）：无检索证据 ≠ 有证据但不支持。
    # 全部声明记 no_retrieval（不计溯源失败），溯源率 N/A，零归因 LLM 调用。
    gateway = JudgeGateway(llm_call=grounding_fake(), retry_delay=0)
    result = run(run_grounding(course=COURSE, evidence=None, gateway=gateway, model="mock/m"))
    assert result["evidence_available"] is False
    assert result["grounding_rate"] is None
    assert result["no_retrieval"] == result["total_claims"]
    assert result["no_evidence"] == 0
    assert result["unsupported_claims"] == []
    assert "no_retrieval" in result["flags"]
    assert result["evidence_source"] == "none"
    # 有声明但无证据支撑 → evidence_coverage=0.0（区别于 grounding_rate=None）
    assert result["evidence_coverage"] == 0.0
    assert result["tasks_with_evidence_support"] == 0
    assert len(gateway.calls) == 3  # 只分解（3 单元），无证据不做归因
    assert any("no_retrieval" in n for n in result["notes"])


def test_run_grounding_missing_course(tmp_path):
    result = run(run_grounding(trace_dir=tmp_path))
    assert result["grounding_rate"] is None and result["total_claims"] == 0
    assert any("course.json 缺失" in n for n in result["notes"])


def test_run_grounding_trace_dir_and_dangling(tmp_path):
    course = json.loads(json.dumps(COURSE))
    course["chapters"][0]["tasks"][0]["blocks"][0]["markdown"] += "另见 ev-99-deadbe。"
    (tmp_path / "course.json").write_text(json.dumps(course, ensure_ascii=False), encoding="utf-8")
    (tmp_path / "evidence_snapshot.json").write_text(json.dumps(EVIDENCE, ensure_ascii=False), encoding="utf-8")
    gateway = JudgeGateway(llm_call=grounding_fake(), retry_delay=0)
    result = run(run_grounding(trace_dir=tmp_path, gateway=gateway, model="mock/m"))
    assert result["dangling_citations"] == ["ev-99-deadbe"]
    assert result["total_claims"] == 3


def test_run_grounding_claims_in_reuse():
    gateway = JudgeGateway(llm_call=grounding_fake(), retry_delay=0)
    claims_in = [{"claim_id": "c1", "unit_id": "t1-b0", "task_id": "t1",
                  "text": "HTTP 默认端口是 80", "excerpt": ""}]
    result = run(run_grounding(course=COURSE, evidence=EVIDENCE, gateway=gateway,
                               model="mock/m", claims_in=claims_in))
    assert result["supported"] == 1 and result["grounding_rate"] == 1.0
    assert len(gateway.calls) == 1  # 只有归因，无分解
    assert any("复用" in n for n in result["notes"])


# ---------------------------------------------------------------- Bug3 回归：no_retrieval 语义 / 证据回退 / evidence_coverage

EVIDENCE_BLOCK = ("- MDN HTTP\n  HTTP 默认端口是 80。\n  来源: https://example.com/http\n"
                  "  证据ID: ev-01-abc123 | 类型: documentation")


def _request_with_evidence(block=EVIDENCE_BLOCK):
    return {"model": "mock/m", "messages": [
        {"role": "system", "content": "你是课程作者"},
        {"role": "user", "content": "请生成任务正文。\n\n## 搜索证据包（外部资料，引用时须注明来源）\n"
         + block + "\n\n## 可引用来源\n- MDN HTTP（https://example.com/http）"},
    ]}


def test_extract_request_evidence_from_task_content(tmp_path):
    (tmp_path / "stage_task_content_ch1_t1_request.json").write_text(
        json.dumps(_request_with_evidence(), ensure_ascii=False), encoding="utf-8")
    sources = extract_request_evidence(tmp_path)
    assert len(sources) == 1
    assert sources[0]["evidenceId"] == "ev-01-abc123"
    assert sources[0]["url"] == "https://example.com/http"
    assert "HTTP 默认端口是 80" in sources[0]["summary"]


def test_extract_request_evidence_calls_and_search_decision(tmp_path):
    # calls.json 全量历史 + search_decision 阶段（"## 已有证据"头）都读，按 evidenceId 去重
    (tmp_path / "stage_task_content_ch1_t1_calls.json").write_text(json.dumps(
        [{"request": _request_with_evidence()}, {"request": _request_with_evidence()}],
        ensure_ascii=False), encoding="utf-8")
    sd = {"messages": [{"role": "user",
                        "content": "## 已有证据\n" + EVIDENCE_BLOCK + "\n\n## 可引用来源\n- x"}]}
    (tmp_path / "stage_search_decision_ch1_t1_request.json").write_text(
        json.dumps(sd, ensure_ascii=False), encoding="utf-8")
    assert len(extract_request_evidence(tmp_path)) == 1


def test_extract_request_evidence_no_section_empty(tmp_path):
    # pilot 实例：无证据注入（evidencePolicy=none）→ 回退也空
    (tmp_path / "stage_task_content_t1_request.json").write_text(json.dumps(
        {"messages": [{"role": "user", "content": "请生成任务正文，无证据。"}]},
        ensure_ascii=False), encoding="utf-8")
    assert extract_request_evidence(tmp_path) == []


def test_run_grounding_request_fallback(tmp_path):
    # snapshot 全 null，但 request 快照有注入证据 → 回退提取，正常归因（非 no_retrieval）
    (tmp_path / "course.json").write_text(json.dumps(COURSE, ensure_ascii=False), encoding="utf-8")
    (tmp_path / "evidence_snapshot.json").write_text(json.dumps(
        [{"stage": "task_content", "chapter_id": "ch1", "task_id": "t1", "pack": None}],
        ensure_ascii=False), encoding="utf-8")
    (tmp_path / "stage_task_content_ch1_t1_request.json").write_text(
        json.dumps(_request_with_evidence(), ensure_ascii=False), encoding="utf-8")
    gateway = JudgeGateway(llm_call=grounding_fake(), retry_delay=0)
    result = run(run_grounding(trace_dir=tmp_path, gateway=gateway, model="mock/m"))
    assert result["evidence_source"] == "request_fallback"
    assert result["evidence_available"] is True
    assert "no_retrieval" not in result["flags"]
    assert result["supported"] == 1
    assert result["grounding_rate"] == pytest.approx(1 / 3)
    assert result["evidence_coverage"] == pytest.approx(1 / 3)
    assert any("回退" in n for n in result["notes"])


def test_compute_evidence_coverage_chapter_scoped():
    merged = [
        {"chapter_id": "ch1", "task_id": "t1", "verdict": "supported"},
        {"chapter_id": "ch1", "task_id": "t1", "verdict": "no_evidence"},
        {"chapter_id": "ch2", "task_id": "t1", "verdict": "no_retrieval"},  # 跨章 t1 不合并
        {"chapter_id": "ch1", "task_id": "t2", "verdict": "no_evidence"},
    ]
    cov = compute_evidence_coverage(merged)
    assert cov["tasks_evaluated"] == 3  # (ch1,t1),(ch2,t1),(ch1,t2)
    assert cov["tasks_with_evidence_support"] == 1
    assert cov["evidence_coverage"] == pytest.approx(1 / 3)
    assert compute_evidence_coverage([])["evidence_coverage"] is None


def test_summarize_no_retrieval_excluded_from_rate():
    claims = [{"claim_id": f"c{i}", "text": f"声明{i}"} for i in range(1, 5)]
    attributions = [
        {"claim_id": "c1", "verdict": "supported", "evidence_ids": ["ev-01-abc123"], "reason": ""},
        {"claim_id": "c2", "verdict": "no_evidence", "evidence_ids": [], "reason": "未覆盖"},
        {"claim_id": "c3", "verdict": "no_retrieval", "evidence_ids": [], "reason": "无检索"},
        {"claim_id": "c4", "verdict": "no_retrieval", "evidence_ids": [], "reason": "无检索"},
    ]
    summary = summarize_grounding(claims, attributions)
    # 可归因 = 4 - 2(no_retrieval) = 2；rate = supported/可归因 = 1/2
    assert summary["grounding_rate"] == 0.5
    assert summary["no_retrieval"] == 2
    assert len(summary["no_retrieval_claims"]) == 2
    # no_retrieval 不算溯源失败：unsupported_claims 只含 no_evidence
    assert len(summary["unsupported_claims"]) == 1
    assert summary["unsupported_claims"][0]["claim_id"] == "c2"

# ---------------------------------------------------------------- 任务级归因（L1）

from evals.grounding import build_scoped_evidence

SCOPED_COURSE = {"chapters": [{"chapterId": "ch1", "title": "HTTP 基础", "tasks": [
    {"taskId": "t1", "title": "端口", "blocks": [
        {"type": "markdown", "markdown": "PORT80：HTTP 默认端口是 80。"}]},
    {"taskId": "t2", "title": "缓存", "blocks": [
        {"type": "markdown", "markdown": "ETAG：ETag 是资源版本标识。"}]},
]}]}

EV_SRC = {"evidenceId": "ev-01-abc123", "title": "MDN HTTP",
          "url": "https://example.com/http", "summary": "HTTP 默认端口是 80。",
          "kind": "documentation", "authorityScore": 0.9}


def test_build_scoped_evidence_indexing_and_dedup():
    snap = [
        {"chapterId": "ch1", "taskId": "t1", "pack": {"sources": [EV_SRC, EV_SRC]}},
        {"chapterId": "ch1", "taskId": "", "pack": {"sources": [EV_SRC]}},
        {"chapterId": "ch2", "taskId": "t1", "pack": None},
        {"chapterId": "ch2", "taskId": "t2", "pack": {"sources": []}},
        "garbage",
    ]
    scoped = build_scoped_evidence(snap)
    assert set(scoped) == {("ch1", "t1"), ("ch1", "")}
    assert len(scoped[("ch1", "t1")]) == 1  # 去重
    assert build_scoped_evidence(None) == {}
    assert build_scoped_evidence({"sources": [EV_SRC]}) == {}  # 非 pack 结构走课程级


def test_run_grounding_task_scoped_no_retrieval():
    # t1 有证据、t2 无证据：t2 声明记 no_retrieval 而非 no_evidence，
    # 溯源率只算可归因声明（1/1），t2 零归因调用。
    snap = [{"chapterId": "ch1", "taskId": "t1", "pack": {"sources": [EV_SRC]}}]
    gateway = JudgeGateway(llm_call=grounding_fake(), retry_delay=0)
    result = run(run_grounding(course=SCOPED_COURSE, evidence=snap, gateway=gateway, model="mock/m"))
    assert result["total_claims"] == 2
    assert result["supported"] == 1 and result["no_retrieval"] == 1
    assert result["no_evidence"] == 0 and result["unsupported_claims"] == []
    assert result["grounding_rate"] == pytest.approx(1.0)
    assert result["evidence_coverage"] == pytest.approx(0.5)
    assert len(result["llm_calls"]) == 3  # 2 分解 + 1 归因批（仅 t1）
    assert any("任务级归因" in n for n in result["notes"])


def test_run_grounding_chapter_pack_covers_all_tasks():
    snap = [{"chapterId": "ch1", "taskId": "", "pack": {"sources": [EV_SRC]}}]
    gateway = JudgeGateway(llm_call=grounding_fake(), retry_delay=0)
    result = run(run_grounding(course=SCOPED_COURSE, evidence=snap, gateway=gateway, model="mock/m"))
    assert result["no_retrieval"] == 0
    assert result["supported"] == 1 and result["no_evidence"] == 1
    assert result["grounding_rate"] == pytest.approx(0.5)
    assert len(result["llm_calls"]) == 3  # 2 分解 + 1 归因批（两任务同章级组）


def test_run_grounding_task_pack_preferred_over_chapter():
    ev_task = {**EV_SRC, "evidenceId": "ev-task-999", "title": "TASK-PACK-SRC"}
    ev_ch = {**EV_SRC, "evidenceId": "ev-ch-000", "title": "CH-PACK-SRC"}
    snap = [
        {"chapterId": "ch1", "taskId": "", "pack": {"sources": [ev_ch]}},
        {"chapterId": "ch1", "taskId": "t1", "pack": {"sources": [ev_task]}},
    ]
    seen_users = []
    fake = grounding_fake()

    async def recording(messages, model, **kwargs):
        if "事实核查员" not in messages[0]["content"]:
            seen_users.append(messages[-1]["content"])
        return await fake(messages, model, **kwargs)

    gateway = JudgeGateway(llm_call=recording, retry_delay=0)
    result = run(run_grounding(course=SCOPED_COURSE, evidence=snap, gateway=gateway, model="mock/m"))
    assert result["total_claims"] == 2 and result["no_retrieval"] == 0
    t1_batch = next(u for u in seen_users if "端口是 80" in u)
    assert "ev-task-999" in t1_batch and "ev-ch-000" not in t1_batch  # 任务 pack 优先
    t2_batch = next(u for u in seen_users if "版本标识" in u)
    assert "ev-ch-000" in t2_batch  # t2 回退章级 pack
