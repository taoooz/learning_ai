"""evals.grounding — 事实溯源评测：原子事实分解 → 证据归因 → 溯源率。

流程：
1. 从 course.json（或 trace 阶段文件）提取任务内容块为可核查单元；
2. judge 辅助把正文拆成原子事实声明（排除教学指令/观点/纯类比）；
3. 逐条对照 evidence_snapshot.json 归因：supported / contradicted / no_evidence；
4. 事实溯源率 = supported / total；矛盾与无证据清单输出供人工审计。

成本控制：--sample N 限量模式（确定性等距抽取至多 N 个内容单元做分解）；
--claims-in 复用已分解声明，只重跑归因。证据快照缺失时容错：全部声明记
no_evidence 并标注 evidence_available=false，不臆造归因。

CLI（README 片段）：
    cd python-agent
    python -m evals.grounding --trace-dir "$EVAL_TRACE_DIR/run-1/spec-1" --sample 20 --out grounding.json
    python -m evals.grounding --course course.json --evidence evidence_snapshot.json --out grounding.json
    # 复用上次分解的声明，只重跑归因
    python -m evals.grounding --trace-dir ... --claims-in grounding.json --out grounding2.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path

from .judge import JudgeGateway, JudgeCallError, load_judges_config
from .report import load_trace_bundle, load_json_or_none

_EVIDENCE_ID_RE = re.compile(r"\bev-\d+-[0-9a-fA-F]+\b")

DECOMPOSE_SYSTEM = """你是事实核查员。把给出的课程内容片段分解为"原子事实声明"：
- 每条声明只含一个可独立核查的事实断言（定义、数值、机制、因果、时间、归属）。
- 排除：教学指令（"请记住/练习"）、主观观点、纯类比修辞、学习目标描述。
- 类比中若含事实断言（如"HTTP 像寄信"本身不算，但"HTTP 默认端口是 80"算），只提取事实部分。
- 每条声明附原文摘录 excerpt（≤50字）。最多 10 条；没有可核查事实则返回空数组。
输出严格 JSON：{"claims": [{"text": "声明", "excerpt": "原文摘录"}]}"""

ATTRIBUTE_SYSTEM = """你是事实溯源审计员。给定证据源列表（evidenceId/标题/URL/摘要）与一批事实声明，
逐条判断声明与证据的关系：
- supported：证据摘要中有明确支撑该声明的内容（给出 evidence_ids）。
- contradicted：证据与声明直接矛盾（给出 evidence_ids 与矛盾点）。
- no_evidence：证据不足以判断（摘要未覆盖该声明细节时也属此类，不要凭常识补判）。
只依据给出的证据判断，不使用你自身的知识。输出严格 JSON：
{"attributions": [{"claim_id": "c1", "verdict": "supported|contradicted|no_evidence", "evidence_ids": ["ev-..."], "reason": "一句话"}]}"""


# ---------------------------------------------------------------- 内容单元提取

def _blocks_of_task(task: dict, contents: dict) -> list[dict]:
    blocks = task.get("blocks")
    if blocks is None:
        entry = contents.get(task.get("taskId", ""))
        if isinstance(entry, dict):
            blocks = entry.get("blocks")
        elif isinstance(entry, list):
            blocks = entry
    return blocks or []


def _block_text(block: dict) -> str:
    btype = block.get("type", "")
    if btype == "markdown":
        return block.get("markdown", "")
    if btype == "key_point":
        return "\n".join(str(p) for p in block.get("points", []))
    if btype == "example":
        return "\n".join(filter(None, [block.get("context", ""), block.get("content", ""), block.get("takeaway", "")]))
    if btype == "comparison":
        rows = [" | ".join(str(c) for c in r) for r in block.get("rows", [])]
        return "\n".join([" | ".join(block.get("columns", []))] + rows)
    if btype == "definition":
        return f"{block.get('term', '')}：{block.get('definition', '')}"
    return str(block.get("markdown") or block.get("content") or block.get("text") or "")


def extract_content_units(course: dict) -> list[dict]:
    """把课程任务内容块拆成内容单元 [{"unit_id","task_id","task_title","text"}]。"""
    if not isinstance(course, dict):
        return []
    contents = course.get("taskContents") or {}
    tasks: list[dict] = []
    for ch in course.get("chapters") or (course.get("blueprint") or {}).get("chapters") or []:
        if isinstance(ch, dict):
            tasks.extend(t for t in ch.get("tasks") or [] if isinstance(t, dict))
    tasks.extend(t for t in course.get("tasks") or [] if isinstance(t, dict))
    # taskContents 里有但计划里没有的任务也评（容错）
    known = {t.get("taskId") for t in tasks}
    for task_id in contents:
        if task_id not in known:
            tasks.append({"taskId": task_id, "title": task_id})

    units = []
    for task in tasks:
        task_id = task.get("taskId", "")
        for i, block in enumerate(_blocks_of_task(task, contents)):
            text = _block_text(block).strip()
            if len(text) < 8:  # 过短片段无核查价值
                continue
            units.append({
                "unit_id": f"{task_id or 'task'}-b{i}",
                "task_id": task_id,
                "task_title": task.get("title", ""),
                "text": text,
            })
    return units


def select_sample(units: list[dict], sample: int | None) -> list[dict]:
    """确定性等距抽样（固定输入 → 固定样本，可复现审计）。"""
    if sample is None or sample <= 0 or len(units) <= sample:
        return units
    if sample == 1:
        return [units[0]]
    last = len(units) - 1
    indices = sorted({round(i * last / (sample - 1)) for i in range(sample)})
    return [units[i] for i in indices]


# ---------------------------------------------------------------- 证据快照

def flatten_evidence_sources(snapshot) -> list[dict]:
    """容错展平证据快照：{"sources":[...]} / 多 pack / 裸列表均可。"""
    found: list[dict] = []
    seen_ids: set = set()

    def visit(node):
        if isinstance(node, list):
            for item in node:
                visit(item)
        elif isinstance(node, dict):
            if "evidenceId" in node or ("url" in node and "summary" in node):
                eid = node.get("evidenceId") or node.get("url")
                if eid not in seen_ids:
                    seen_ids.add(eid)
                    found.append({
                        "evidenceId": node.get("evidenceId", ""),
                        "title": node.get("title", ""),
                        "url": node.get("url", ""),
                        "summary": node.get("summary", ""),
                        "kind": node.get("kind", ""),
                        "authorityScore": node.get("authorityScore"),
                    })
            for value in node.values():
                if isinstance(value, (list, dict)):
                    visit(value)

    visit(snapshot)
    return found


def find_dangling_citations(course: dict, sources: list[dict]) -> list[str]:
    """程序检查：正文引用的 evidenceId 不在快照中（引用脱节）。"""
    known = {s["evidenceId"] for s in sources if s.get("evidenceId")}
    text = json.dumps(course or {}, ensure_ascii=False)
    cited = set(_EVIDENCE_ID_RE.findall(text))
    return sorted(cited - known)


# ---------------------------------------------------------------- LLM 步骤

async def decompose_claims(units: list[dict], gateway: JudgeGateway, model: str) -> list[dict]:
    """judge 辅助原子事实分解；单元失败降级为空声明并记录，不中断整体。"""
    claims: list[dict] = []
    for unit in units:
        messages = [
            {"role": "system", "content": DECOMPOSE_SYSTEM},
            {"role": "user", "content": f"任务：{unit['task_title']}\n\n片段：\n{unit['text'][:3000]}"},
        ]
        try:
            result = await gateway.complete_json(messages, model)
        except JudgeCallError:
            continue
        for item in (result["data"].get("claims") or [])[:10]:
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            claims.append({
                "claim_id": f"c{len(claims) + 1}",
                "unit_id": unit["unit_id"],
                "task_id": unit["task_id"],
                "text": text,
                "excerpt": str(item.get("excerpt", ""))[:80],
            })
    return claims


async def attribute_claims(
    claims: list[dict],
    sources: list[dict],
    gateway: JudgeGateway,
    model: str,
    batch_size: int = 8,
) -> list[dict]:
    """批量归因；批失败时该批降级为 no_evidence（保守，不臆造支持）。"""
    if not claims:
        return []
    if not sources:
        return [{"claim_id": c["claim_id"], "verdict": "no_evidence",
                 "evidence_ids": [], "reason": "证据快照缺失或为空"} for c in claims]
    evidence_text = "\n".join(
        f"[{s['evidenceId']}] {s['title']} ({s['url']})\n摘要：{s['summary'][:300]}"
        for s in sources[:40]
    )
    results: dict[str, dict] = {}
    for start in range(0, len(claims), batch_size):
        batch = claims[start:start + batch_size]
        claims_text = "\n".join(f"{c['claim_id']}: {c['text']}" for c in batch)
        messages = [
            {"role": "system", "content": ATTRIBUTE_SYSTEM},
            {"role": "user", "content": f"## 证据源\n{evidence_text}\n\n## 待归因声明\n{claims_text}"},
        ]
        try:
            result = await gateway.complete_json(messages, model)
            rows = result["data"].get("attributions") or []
        except JudgeCallError:
            rows = []
        by_id = {str(r.get("claim_id")): r for r in rows if isinstance(r, dict)}
        for c in batch:
            row = by_id.get(c["claim_id"]) or {}
            verdict = str(row.get("verdict", "")).strip().lower()
            if verdict not in ("supported", "contradicted", "no_evidence"):
                verdict = "no_evidence"
            results[c["claim_id"]] = {
                "claim_id": c["claim_id"],
                "verdict": verdict,
                "evidence_ids": [str(e) for e in (row.get("evidence_ids") or [])],
                "reason": str(row.get("reason", "")) or ("归因调用失败/未覆盖，保守记无证据" if not row else ""),
            }
    return [results[c["claim_id"]] for c in claims]


def summarize_grounding(claims: list[dict], attributions: list[dict]) -> dict:
    """溯源率 = supported / total；矛盾与无证据清单供人工审计。"""
    by_id = {a["claim_id"]: a for a in attributions}
    merged = []
    counts = {"supported": 0, "contradicted": 0, "no_evidence": 0}
    for c in claims:
        a = by_id.get(c["claim_id"], {"verdict": "no_evidence", "evidence_ids": [], "reason": "未归因"})
        counts[a["verdict"]] = counts.get(a["verdict"], 0) + 1
        merged.append({**c, **a})
    total = len(claims)
    return {
        "total_claims": total,
        "supported": counts["supported"],
        "contradicted": counts["contradicted"],
        "no_evidence": counts["no_evidence"],
        "grounding_rate": counts["supported"] / total if total else None,
        "claims": merged,
        "contradicted_claims": [m for m in merged if m["verdict"] == "contradicted"],
        "unsupported_claims": [m for m in merged if m["verdict"] == "no_evidence"],
    }


# ---------------------------------------------------------------- 主流程

async def run_grounding(
    trace_dir: str | Path | None = None,
    course: dict | None = None,
    evidence=None,
    *,
    gateway: JudgeGateway | None = None,
    model: str | None = None,
    sample: int | None = None,
    config: dict | None = None,
    claims_in: list[dict] | None = None,
) -> dict:
    notes: list[str] = []
    if course is None and trace_dir is not None:
        bundle = load_trace_bundle(trace_dir)
        course = bundle.get("course")
        if evidence is None:
            evidence = bundle.get("evidence")
        notes.extend(bundle.get("missing", []))
    if course is None:
        return {"grounding_rate": None, "total_claims": 0, "supported": 0,
                "contradicted": 0, "no_evidence": 0, "claims": [],
                "contradicted_claims": [], "unsupported_claims": [],
                "evidence_available": False, "notes": notes + ["course.json 缺失，无法评测"]}

    config = config or load_judges_config()
    model = model or config.get("utility_model") or config["panel"][0]["model"]
    gateway = gateway or JudgeGateway(max_retries=config["max_retries"],
                                      temperature=config["temperature"],
                                      max_tokens=config["max_tokens"])
    sources = flatten_evidence_sources(evidence)
    if not sources:
        notes.append("evidence_snapshot 缺失或为空：全部声明保守记 no_evidence")

    units = extract_content_units(course)
    selected = select_sample(units, sample)
    if claims_in is not None:
        claims = claims_in
        notes.append(f"复用已分解声明 {len(claims)} 条（--claims-in）")
    else:
        claims = await decompose_claims(selected, gateway, model)

    attributions = await attribute_claims(claims, sources, gateway, model)
    summary = summarize_grounding(claims, attributions)
    summary.update({
        "model": model,
        "sampled": sample is not None and len(selected) < len(units),
        "units_total": len(units),
        "units_evaluated": len(selected),
        "evidence_available": bool(sources),
        "evidence_count": len(sources),
        "dangling_citations": find_dangling_citations(course, sources),
        "llm_calls": gateway.calls,
        "notes": notes,
    })
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="事实溯源评测（详见模块 docstring）")
    parser.add_argument("--trace-dir", help="EVAL_TRACE_DIR/<run_id>/<spec_id>/ 目录")
    parser.add_argument("--course", help="course.json 路径（与 --trace-dir 二选一）")
    parser.add_argument("--evidence", help="evidence_snapshot.json 路径")
    parser.add_argument("--sample", type=int, help="限量模式：至多分解 N 个内容单元（控成本）")
    parser.add_argument("--model", help="辅助 judge 模型（默认 judges.json utility_model）")
    parser.add_argument("--claims-in", help="复用已分解声明的 grounding.json")
    parser.add_argument("--out", help="结果 JSON 输出路径")
    args = parser.parse_args()
    if not args.trace_dir and not args.course:
        parser.error("需要 --trace-dir 或 --course")

    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    except ImportError:
        pass

    course = load_json_or_none(args.course) if args.course else None
    evidence = load_json_or_none(args.evidence) if args.evidence else None
    claims_in = None
    if args.claims_in:
        prior = load_json_or_none(args.claims_in) or {}
        claims_in = [{k: c[k] for k in ("claim_id", "unit_id", "task_id", "text", "excerpt") if k in c}
                     for c in prior.get("claims", [])]
    result = asyncio.run(run_grounding(
        trace_dir=args.trace_dir, course=course, evidence=evidence,
        model=args.model, sample=args.sample, claims_in=claims_in,
    ))
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        rate = result["grounding_rate"]
        print(f"已写入 {args.out}（溯源率={'%.1f%%' % (rate * 100) if rate is not None else 'N/A'}，"
              f"声明 {result['total_claims']} 条）")
    else:
        print(text)


if __name__ == "__main__":
    main()