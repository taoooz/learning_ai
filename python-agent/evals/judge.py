"""evals.judge — 异构评审团成对偏好评测（防位置偏差 + 一致性报告）。

设计要点：
- 评审团默认 3 个异构模型（judges.json 可配置），与生成模型 ark/deepseek-v4-1-flash
  不同源，规避 scripts/evaluate_content_quality.py 的自偏好偏差。
- 每对课程 A/B 由每个 judge 双向位置交换各评一次；两次方向矛盾（都选同一位置）
  判为平局并标记 position_bias，消除位置偏差。
- prompt 按 rubric 五维（事实准确/对齐/认知负荷/深度/连贯）输出结构化判断。
- 调用走 litellm 网关 /chat/completions，temperature=0。lib/minimax.py 的
  MiniMaxClient.chat 支持 model 覆盖但不暴露 temperature 参数，且 lib/ 禁止编辑，
  故此处用 httpx 自建薄调用层（复用 lib 的降级链思路：json_schema→json_object→无约束，
  降级与重试均写入审计日志）。
- 聚合：评审团多数票 + 简化胜率；跨多对可用 Bradley-Terry（MM 迭代）拟合能力分。

CLI（README 片段）：
    cd python-agent
    #  dry-run：只打印调用计划与成本估算，不访问网关
    python -m evals.judge --course-a runA/course.json --course-b runB/course.json --dry-run
    # 真实评审（读 python-agent/.env 的 LLM_API_KEY/LLM_API_BASE）
    python -m evals.judge --course-a runA/course.json --course-b runB/course.json --out judge.json
    # 自定义评审团
    python -m evals.judge --config my_judges.json ...
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import os
import time
from pathlib import Path

DEFAULT_CONFIG_PATH = Path(__file__).with_name("judges.json")

DIMENSIONS = ["factual_accuracy", "alignment", "cognitive_load", "depth", "coherence"]
DIMENSION_LABELS = {
    "factual_accuracy": "事实准确",
    "alignment": "目标对齐",
    "cognitive_load": "认知负荷",
    "depth": "讲解深度",
    "coherence": "结构连贯",
}


# ---------------------------------------------------------------- 配置

def load_judges_config(path: str | Path | None = None) -> dict:
    """读取评审团配置；path 为空时依次尝试 EVAL_JUDGES_CONFIG 环境变量、模块旁 judges.json。"""
    candidate = path or os.getenv("EVAL_JUDGES_CONFIG") or DEFAULT_CONFIG_PATH
    data = json.loads(Path(candidate).read_text(encoding="utf-8"))
    panel = data.get("panel") or []
    if not panel:
        raise ValueError("judges.json 缺少 panel（评审团模型列表）")
    for member in panel:
        if not member.get("model"):
            raise ValueError(f"评审团成员缺少 model 字段: {member}")
    data.setdefault("temperature", 0)
    data.setdefault("max_tokens", 4000)
    data.setdefault("max_retries", 3)
    data.setdefault("timeout_seconds", 120)
    data.setdefault("utility_model", panel[0]["model"])
    return data


# ---------------------------------------------------------------- 网关薄调用层

class JudgeCallError(RuntimeError):
    """单个 judge 调用重试耗尽或输出不可解析。"""


def _parse_json_text(text: str) -> dict:
    """最小 JSON 提取：剥 markdown 围栏，首 { 尾 } 截取，strict=False 容忍裸控制字符。"""
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    text = text.strip()
    first, last = text.find("{"), text.rfind("}")
    if first == -1 or last <= first:
        raise ValueError(f"响应中无 JSON 对象: {text[:160]}")
    return json.loads(text[first:last + 1], strict=False)


async def gateway_llm_call(
    messages: list[dict],
    model: str,
    *,
    max_tokens: int = 4000,
    temperature: float = 0,
    response_format: dict | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    timeout: float = 120.0,
) -> dict:
    """默认传输：httpx POST {LLM_API_BASE}/chat/completions（OpenAI 兼容）。

    返回原始响应 dict（choices/usage）。4xx 拒绝 response_format 时逐级降级
    （json_schema→json_object→无约束）并在响应上挂 _fallback_level 审计字段。
    """
    import httpx  # 延迟导入：测试注入 fake llm_call 时无需网络栈

    key = api_key or os.getenv("LLM_API_KEY", "")
    base = (base_url or os.getenv("LLM_API_BASE", "http://muses-openapi-prod.weizhipin.com/v1")).rstrip("/")
    body: dict = {"model": model, "messages": messages,
                  "max_tokens": max_tokens, "temperature": temperature}
    if response_format:
        body["response_format"] = response_format
    fallback_level = 0
    async with httpx.AsyncClient() as client:
        while True:
            resp = await client.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=body, timeout=timeout,
            )
            if resp.status_code >= 400 and "response_format" in body and resp.status_code < 500:
                fmt = body["response_format"]
                if fmt.get("type") == "json_schema":
                    body["response_format"] = {"type": "json_object"}
                    fallback_level = 1
                    continue
                del body["response_format"]
                fallback_level = 2
                continue
            resp.raise_for_status()
            data = resp.json()
            data["_fallback_level"] = fallback_level
            return data


class JudgeGateway:
    """带重试与审计日志的评审调用封装。

    llm_call 可注入（测试 mock）：async (messages, model, **kwargs) -> 原始响应 dict。
    每次调用记录 {model, attempts, latency_ms, usage, status, fallback_level, error}。
    """

    def __init__(self, llm_call=None, max_retries: int = 3, retry_delay: float = 1.0,
                 temperature: float = 0, max_tokens: int = 4000):
        self.llm_call = llm_call or gateway_llm_call
        self.max_retries = max(1, max_retries)
        self.retry_delay = retry_delay
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.calls: list[dict] = []

    async def complete_json(self, messages: list[dict], model: str,
                            max_tokens: int | None = None) -> dict:
        """请求 JSON 输出并解析；重试耗尽抛 JudgeCallError。返回 {"data", "meta"}。"""
        started = time.monotonic()
        last_error = ""
        fallback_level = 0
        usage = None
        for attempt in range(1, self.max_retries + 1):
            try:
                response = await self.llm_call(
                    messages, model,
                    max_tokens=max_tokens or self.max_tokens,
                    temperature=self.temperature,
                    response_format={"type": "json_object"},
                )
                fallback_level = response.get("_fallback_level", 0)
                usage = response.get("usage")
                text = ((response.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                data = _parse_json_text(text)
                meta = {"model": model, "attempts": attempt,
                        "latency_ms": round((time.monotonic() - started) * 1000),
                        "usage": usage, "status": "ok", "fallback_level": fallback_level}
                self.calls.append(meta)
                return {"data": data, "meta": meta}
            except Exception as exc:  # noqa: BLE001 —— 网络/解析错误统一重试
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt < self.max_retries and self.retry_delay > 0:
                    await asyncio.sleep(self.retry_delay * attempt)
        meta = {"model": model, "attempts": self.max_retries,
                "latency_ms": round((time.monotonic() - started) * 1000),
                "usage": usage, "status": "failed", "fallback_level": fallback_level,
                "error": last_error}
        self.calls.append(meta)
        raise JudgeCallError(f"{model} 调用失败（{self.max_retries} 次重试）: {last_error}")


# ---------------------------------------------------------------- 课程渲染与 prompt

def _blocks_to_text(blocks: list[dict]) -> str:
    parts = []
    for b in blocks or []:
        btype = b.get("type", "")
        if btype == "markdown":
            parts.append(b.get("markdown", ""))
        elif btype == "key_point":
            parts.append(f"【{b.get('title', '要点')}】\n" + "\n".join(f"- {p}" for p in b.get("points", [])))
        elif btype == "example":
            parts.append(f"【示例：{b.get('title', '')}】\n场景：{b.get('context', '')}\n{b.get('content', '')}\n要点：{b.get('takeaway', '')}")
        elif btype == "comparison":
            header = " | ".join(b.get("columns", []))
            rows = "\n".join(" | ".join(str(c) for c in r) for r in b.get("rows", []))
            parts.append(f"【对比表】\n{header}\n{rows}")
        elif btype == "definition":
            parts.append(f"【定义：{b.get('term', '')}】{b.get('definition', '')}")
        elif btype == "diagram":
            parts.append(f"【图示】{b.get('caption', b.get('source', '')[:200])}")
        else:
            text = b.get("markdown") or b.get("content") or b.get("text") or ""
            if text:
                parts.append(str(text))
    return "\n\n".join(p for p in parts if p)


def render_course_text(course: dict, max_chars: int = 12000) -> str:
    """把 course.json（蓝图+章节计划+任务内容块）渲染为评审用纯文本。

    只渲染教学内容字段，不渲染 model/run_id/版本等元数据（匿名盲评安全）。
    对缺失结构容错：能渲染多少渲染多少。
    """
    if not isinstance(course, dict):
        return ""
    parts: list[str] = []
    blueprint = course.get("blueprint") or {}
    topic = course.get("courseTopic") or blueprint.get("topic") or course.get("topic") or ""
    if topic:
        parts.append(f"课程主题：{topic}")
    goal = blueprint.get("learningGoal") or (course.get("architecture") or {}).get("thesis", {}).get("targetCapability")
    if goal:
        parts.append(f"课程目标：{goal}")
    for obj in blueprint.get("courseObjectives") or course.get("objectives") or []:
        text = obj.get("observableOutcome") or obj.get("description") or obj.get("text") or ""
        if text:
            parts.append(f"学习目标[{obj.get('objectiveId', '?')}]：{text}")

    contents = course.get("taskContents") or {}
    chapters = course.get("chapters") or blueprint.get("chapters") or []
    for ch in chapters:
        if not isinstance(ch, dict):
            continue
        parts.append(f"\n## 章节：{ch.get('title', ch.get('chapterId', ''))}")
        if ch.get("deliverable"):
            parts.append(f"章节交付物：{ch['deliverable']}")
        tasks = ch.get("tasks") or []
        for task in tasks:
            parts.append(_render_task(task, contents))
    # 顶层 tasks（无章节包装的 trace 形态）
    for task in course.get("tasks") or []:
        parts.append(_render_task(task, contents))
    text = "\n".join(p for p in parts if p)
    if len(text) > max_chars:
        text = text[:max_chars] + "\n…（内容过长已截断）"
    return text


def _render_task(task: dict, contents: dict) -> str:
    if not isinstance(task, dict):
        return ""
    task_id = task.get("taskId", "")
    lines = [f"\n### 任务：{task.get('title', task_id)}"]
    if task.get("taskGoal"):
        lines.append(f"任务目标：{task['taskGoal']}")
    if task.get("observableOutcome"):
        lines.append(f"可观察产出：{task['observableOutcome']}")
    blocks = task.get("blocks")
    if blocks is None:
        entry = contents.get(task_id)
        if isinstance(entry, dict):
            blocks = entry.get("blocks")
        elif isinstance(entry, list):
            blocks = entry
    if blocks:
        lines.append(_blocks_to_text(blocks))
    cp = task.get("checkpoint") or task.get("checkpoints")
    if cp:
        cps = cp if isinstance(cp, list) else [cp]
        for c in cps:
            if isinstance(c, dict) and c.get("prompt"):
                lines.append(f"【检查点测验】{c['prompt']}")
    return "\n".join(lines)


PAIR_SYSTEM_PROMPT = """你是课程质量评审专家。对比两份同学科课程 A 与 B，按五个维度独立判断，再给出总体偏好。
五维 rubric（各维先给 A/B 打 1-5 分，5=优秀）：
1. factual_accuracy 事实准确：陈述是否正确、有依据，有无幻觉或过时事实。
2. alignment 目标对齐：内容是否承载学习目标，测验是否测量目标。
3. cognitive_load 认知负荷：信息密度与脚手架是否匹配初学者，有无超载或冗余堆砌。
4. depth 讲解深度：是否触及机制与边界条件，还是停留在浅表定义。
5. coherence 结构连贯：章节/任务推进是否连贯，先修是否铺垫到位。
只依据文本质量判断，忽略长度差异带来的表面丰富感；示例失真、takeaway 空泛要扣分。
输出严格 JSON：
{"dimensions": {"factual_accuracy": {"a_score": 1-5, "b_score": 1-5, "comment": "一句话"}, "alignment": {...}, "cognitive_load": {...}, "depth": {...}, "coherence": {...}}, "winner": "A" 或 "B" 或 "tie", "reason": "总体偏好的一句话理由"}"""


def build_pair_messages(text_a: str, text_b: str) -> list[dict]:
    user = f"## 课程 A\n{text_a}\n\n## 课程 B\n{text_b}\n\n请按系统提示输出 JSON。"
    return [{"role": "system", "content": PAIR_SYSTEM_PROMPT},
            {"role": "user", "content": user}]


def _normalize_winner(value) -> str:
    v = str(value or "").strip().lower()
    if v in ("a", "course_a", "课程a"):
        return "A"
    if v in ("b", "course_b", "课程b"):
        return "B"
    return "tie"


def _extract_dimensions(data: dict) -> dict:
    dims = {}
    raw = data.get("dimensions") or {}
    for name in DIMENSIONS:
        entry = raw.get(name) or {}
        dims[name] = {
            "a_score": entry.get("a_score"),
            "b_score": entry.get("b_score"),
            "comment": entry.get("comment", ""),
        }
    return dims


# ---------------------------------------------------------------- 成对评审

async def judge_pair_once(
    gateway: JudgeGateway,
    model: str,
    text_first: str,
    text_second: str,
    max_tokens: int | None = None,
) -> dict:
    """单次方向评审：返回 {"winner": "A"/"B"/"tie"（位置语义）, "dimensions", "reason", "meta"}。"""
    result = await gateway.complete_json(build_pair_messages(text_first, text_second), model,
                                         max_tokens=max_tokens)
    data = result["data"]
    return {
        "winner": _normalize_winner(data.get("winner")),
        "dimensions": _extract_dimensions(data),
        "reason": str(data.get("reason", "")),
        "meta": result["meta"],
    }


def _combine_directions(canonical_votes: list[str], first_choices: list[str]) -> dict:
    """把双向结果合成单个 judge 的裁决。

    canonical_votes: 两次评审换算到真实课程 id 后的胜者（"a"/"b"/"tie"）。
    规则：多数票；1:1（含两次都选同一位置的 position_bias）→ tie。
    """
    a_wins = canonical_votes.count("a")
    b_wins = canonical_votes.count("b")
    if a_wins > b_wins:
        winner = "a"
    elif b_wins > a_wins:
        winner = "b"
    else:
        winner = "tie"
    position_bias = (
        len(first_choices) == 2
        and first_choices[0] == first_choices[1]
        and first_choices[0] in ("A", "B")
        and a_wins == b_wins
    )
    return {"winner": winner, "a_wins": a_wins, "b_wins": b_wins,
            "ties": canonical_votes.count("tie"), "position_bias": position_bias,
            "position_consistent": not position_bias}


async def evaluate_pair(
    course_a: dict,
    course_b: dict,
    *,
    config: dict | None = None,
    gateway: JudgeGateway | None = None,
    pair_id: str = "pair-1",
    max_chars: int = 12000,
) -> dict:
    """评审团完整成对评测：每 judge 双向各一次 → 单 judge 裁决 → 多数票聚合。

    返回 dict 含 winner（"a"/"b"/"tie"/"error"）、votes、agreement_rate、
    per_judge 明细、dimension_averages、llm_calls 审计。
    """
    config = config or load_judges_config()
    gateway = gateway or JudgeGateway(max_retries=config["max_retries"],
                                      temperature=config["temperature"],
                                      max_tokens=config["max_tokens"])
    text_a = render_course_text(course_a, max_chars=max_chars)
    text_b = render_course_text(course_b, max_chars=max_chars)

    per_judge = []
    for member in config["panel"]:
        model = member["model"]
        judge_id = member.get("id") or model
        record: dict = {"judge": judge_id, "model": model}
        try:
            forward = await judge_pair_once(gateway, model, text_a, text_b, config["max_tokens"])
            reverse = await judge_pair_once(gateway, model, text_b, text_a, config["max_tokens"])
        except JudgeCallError as exc:
            record.update({"status": "failed", "error": str(exc), "fallback": "excluded"})
            per_judge.append(record)
            continue
        # 位置 → 真实课程：正向 A=a,B=b；反向 A=b,B=a
        votes = []
        for verdict, first_is_a in ((forward, True), (reverse, False)):
            w = verdict["winner"]
            if w == "tie":
                votes.append("tie")
            elif (w == "A") == first_is_a:
                votes.append("a")
            else:
                votes.append("b")
        combined = _combine_directions(votes, [forward["winner"], reverse["winner"]])
        record.update({
            "status": "ok",
            "winner": combined["winner"],
            "position_bias": combined["position_bias"],
            "forward_winner": forward["winner"],
            "reverse_winner": reverse["winner"],
            "reason": forward["reason"] or reverse["reason"],
            "dimensions": forward["dimensions"],
            "dimensions_reverse": reverse["dimensions"],
        })
        per_judge.append(record)

    ok_judges = [j for j in per_judge if j.get("status") == "ok"]
    aggregation = aggregate_panel(ok_judges)
    winner = aggregation["winner"] if ok_judges else "error"
    return {
        "pair_id": pair_id,
        "winner": winner,
        "votes": aggregation["votes"],
        "agreement_rate": aggregation["agreement_rate"],
        "judges_ok": len(ok_judges),
        "judges_failed": len(per_judge) - len(ok_judges),
        "per_judge": per_judge,
        "dimension_averages": aggregation["dimension_averages"],
        "llm_calls": gateway.calls,
    }


def aggregate_panel(judge_verdicts: list[dict]) -> dict:
    """评审团聚合：多数票定胜负；一致率 = 两两 judge 裁决相同的比例。"""
    votes = {"a": 0, "b": 0, "tie": 0}
    for j in judge_verdicts:
        votes[j.get("winner", "tie")] = votes.get(j.get("winner", "tie"), 0) + 1
    if votes["a"] > votes["b"] and votes["a"] > votes["tie"]:
        winner = "a"
    elif votes["b"] > votes["a"] and votes["b"] > votes["tie"]:
        winner = "b"
    elif votes["tie"] > votes["a"] and votes["tie"] > votes["b"]:
        winner = "tie"
    else:
        winner = "tie"  # 平票保守判 tie
    pairs = list(itertools.combinations(judge_verdicts, 2))
    agree = sum(1 for x, y in pairs if x.get("winner") == y.get("winner"))
    agreement = agree / len(pairs) if pairs else 1.0

    dim_avg = {}
    for name in DIMENSIONS:
        a_scores = [j["dimensions"][name]["a_score"] for j in judge_verdicts
                    if isinstance(j.get("dimensions", {}).get(name, {}).get("a_score"), (int, float))]
        b_scores = [j["dimensions"][name]["b_score"] for j in judge_verdicts
                    if isinstance(j.get("dimensions", {}).get(name, {}).get("b_score"), (int, float))]
        dim_avg[name] = {
            "a": round(sum(a_scores) / len(a_scores), 2) if a_scores else None,
            "b": round(sum(b_scores) / len(b_scores), 2) if b_scores else None,
        }
    return {"winner": winner, "votes": votes, "agreement_rate": agreement,
            "dimension_averages": dim_avg}


# ---------------------------------------------------------------- 多对聚合

def win_rates(matches: list[dict]) -> dict:
    """简化胜率聚合。matches: [{"a": id, "b": id, "winner": id 或 "tie"}]。

    胜率 = (胜场 + 0.5×平局) / 参与场次；未参与者不出现。
    """
    stats: dict[str, dict] = {}
    for m in matches:
        a, b, w = m.get("a"), m.get("b"), m.get("winner")
        if not a or not b:
            continue
        for cid in (a, b):
            stats.setdefault(cid, {"wins": 0, "losses": 0, "ties": 0, "matches": 0})
        stats[a]["matches"] += 1
        stats[b]["matches"] += 1
        if w == "tie":
            stats[a]["ties"] += 1
            stats[b]["ties"] += 1
        elif w == a:
            stats[a]["wins"] += 1
            stats[b]["losses"] += 1
        elif w == b:
            stats[b]["wins"] += 1
            stats[a]["losses"] += 1
    out = {}
    for cid, s in stats.items():
        n = s["matches"]
        out[cid] = {**s, "win_rate": (s["wins"] + 0.5 * s["ties"]) / n if n else 0.0}
    return out


def fit_bradley_terry(
    matches: list[dict],
    ids: list[str] | None = None,
    iterations: int = 500,
    tol: float = 1e-10,
) -> dict[str, float]:
    """Bradley-Terry 能力分（MM 迭代，纯 Python）。

    matches: [{"a": id, "b": id, "winner": id 或 "tie"}]，平局各计半胜。
    返回归一化能力分（和为 1）；无对局者均分。确定性算法，无随机。
    """
    if ids is None:
        ids = sorted({m[k] for m in matches for k in ("a", "b") if m.get(k)})
    ids = list(ids)
    if not ids:
        return {}
    n = len(ids)
    index = {cid: i for i, cid in enumerate(ids)}
    wins = [0.0] * n
    pair_counts: dict[tuple[int, int], float] = {}
    for m in matches:
        a, b, w = m.get("a"), m.get("b"), m.get("winner")
        if a not in index or b not in index or a == b:
            continue
        i, j = index[a], index[b]
        key = (min(i, j), max(i, j))
        pair_counts[key] = pair_counts.get(key, 0.0) + 1
        if w == "tie":
            wins[i] += 0.5
            wins[j] += 0.5
        elif w == a:
            wins[i] += 1
        elif w == b:
            wins[j] += 1
    p = [1.0 / n] * n
    if not pair_counts:
        return {cid: 1.0 / n for cid in ids}
    for _ in range(iterations):
        new_p = [0.0] * n
        for i in range(n):
            denom = 0.0
            for (x, y), count in pair_counts.items():
                if i == x:
                    denom += count / (p[i] + p[y])
                elif i == y:
                    denom += count / (p[i] + p[x])
            new_p[i] = wins[i] / denom if denom > 0 and wins[i] > 0 else 1e-12
        total = sum(new_p)
        new_p = [v / total for v in new_p]
        delta = max(abs(new_p[i] - p[i]) for i in range(n))
        p = new_p
        if delta < tol:
            break
    return {cid: p[index[cid]] for cid in ids}


def estimate_calls(n_pairs: int, config: dict | None = None) -> dict:
    """成本估算：每对 = 评审团人数 × 2（双向）。"""
    config = config or load_judges_config()
    per_pair = len(config["panel"]) * 2
    return {"pairs": n_pairs, "judges": len(config["panel"]),
            "calls_per_pair": per_pair, "total_calls": n_pairs * per_pair}


# ---------------------------------------------------------------- CLI

def main() -> None:
    parser = argparse.ArgumentParser(description="异构评审团成对偏好评测（详见模块 docstring）")
    parser.add_argument("--course-a", help="课程 A 的 course.json 路径（--dry-run 时可省略）")
    parser.add_argument("--course-b", help="课程 B 的 course.json 路径（--dry-run 时可省略）")
    parser.add_argument("--config", help="judges.json 路径（默认模块旁配置）")
    parser.add_argument("--pair-id", default="pair-1")
    parser.add_argument("--out", help="结果 JSON 输出路径（缺省打印 stdout）")
    parser.add_argument("--dry-run", action="store_true", help="只打印调用计划，不访问网关")
    args = parser.parse_args()
    if not args.dry_run and not (args.course_a and args.course_b):
        parser.error("需要 --course-a 与 --course-b（或用 --dry-run 只看调用计划）")

    config = load_judges_config(args.config)

    def _load_lenient(path):
        if not path:
            return {}
        try:
            return json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    if args.dry_run:
        plan = estimate_calls(1, config)
        plan["prompt_chars"] = {"a": len(render_course_text(_load_lenient(args.course_a))),
                                "b": len(render_course_text(_load_lenient(args.course_b)))}
        plan["panel"] = [m["model"] for m in config["panel"]]
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return

    course_a = json.loads(Path(args.course_a).read_text(encoding="utf-8"))
    course_b = json.loads(Path(args.course_b).read_text(encoding="utf-8"))

    # 真实调用前加载 python-agent/.env（密钥不进源码）
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    except ImportError:
        pass
    result = asyncio.run(evaluate_pair(course_a, course_b, config=config, pair_id=args.pair_id))
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"已写入 {args.out}（winner={result['winner']}, 一致率={result['agreement_rate']:.2f}）")
    else:
        print(text)


if __name__ == "__main__":
    main()