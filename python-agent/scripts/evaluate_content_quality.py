#!/usr/bin/env python3
"""
切片 2：内容质量评测基线
用法：
    cd python-agent && .venv/bin/python scripts/evaluate_content_quality.py           # 程序判分（结构维度）
    cd python-agent && .venv/bin/python scripts/evaluate_content_quality.py --llm    # 附加 LLM rubric 评分（约 3 分钟）

固定 3 主题 × 不同模式，生成任务内容 → 程序判分（块类型覆盖/内容量）+ 可选 LLM rubric（类比质量/例子具体度/takeaway 概括力）
输出 JSON 评分报告到 stdout；exit 0=通过，1=不达标
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from schemas.learning_v2 import TaskStreamRequest  # noqa: E402
from services.task_content_service import stream_task_events  # noqa: E402

TOPICS_PATH = Path(__file__).resolve().parent.parent / "data" / "content-quality-topics.json"

PASS_THRESHOLD = 60  # 总分百分制及格线


# ---- 程序判分（结构维度） ----

def score_structure(topic: dict, blocks: list[dict]) -> dict:
    """块类型覆盖 + 内容量下限，每项 10 分，总分百分制"""
    checks = []
    block_types = [b["type"] for b in blocks]

    # 1. 块类型覆盖：expectedBlocks 中每个类型至少出现一次
    expected = topic.get("expectedBlocks", [])
    for et in expected:
        present = et in block_types
        checks.append({"name": f"块类型 {et}", "pass": present, "score": 10 if present else 0})

    # 2. markdown 内容量
    md_blocks = [b for b in blocks if b["type"] == "markdown"]
    total_md_chars = sum(len(b.get("markdown", "")) for b in md_blocks)
    min_md = topic.get("minMarkdownChars", 0)
    if min_md:
        ok = total_md_chars >= min_md
        partial = max(0, 10 - (min_md - total_md_chars) // 50) if total_md_chars > 0 else 0
        checks.append({"name": f"markdown ≥{min_md} 字", "pass": ok, "score": 10 if ok else partial})

    # 3. key_point 要点数
    kp_blocks = [b for b in blocks if b["type"] == "key_point"]
    min_kp = topic.get("minKeyPointCount", 0)
    if min_kp:
        total_points = sum(len(b.get("points", [])) for b in kp_blocks)
        ok = total_points >= min_kp
        checks.append({"name": f"key_point ≥{min_kp} 条", "pass": ok, "score": 10 if ok else 5 if total_points > 0 else 0})

    # 4. comparison 表格规格
    comp_blocks = [b for b in blocks if b["type"] == "comparison"]
    if comp_blocks:
        min_rows = topic.get("minComparisonRows", 3)
        min_cols = topic.get("minComparisonColumns", 3)
        best = max(comp_blocks, key=lambda b: len(b.get("rows", [])))
        ok = len(best.get("rows", [])) >= min_rows and len(best.get("columns", [])) >= min_cols
        checks.append({"name": f"comparison ≥{min_rows}行×{min_cols}列", "pass": ok, "score": 10 if ok else 5})

    # 5. example 内容量
    ex_blocks = [b for b in blocks if b["type"] == "example"]
    min_ex = topic.get("minExampleChars", 0)
    if min_ex:
        best_ex = max((len(b.get("content", "")) for b in ex_blocks), default=0)
        ok = best_ex >= min_ex
        checks.append({"name": f"example ≥{min_ex} 字", "pass": ok, "score": 10 if ok else 5 if best_ex > 0 else 0})

    total = sum(c["score"] for c in checks)
    max_possible = len(checks) * 10
    percent = round(total / max_possible * 100) if max_possible else 0
    return {"checks": checks, "percent": percent, "blockTypes": block_types, "totalMarkdownChars": total_md_chars}


# ---- LLM rubric 评分（质量维度） ----

RUBRIC_PROMPT = """你是一位中文教学内容评审专家。请对以下学习任务的内容质量进行 1-5 分评分（5=优秀）。

## 任务信息
- 课程主题：{topic}
- 任务标题：{task_title}
- 教学模式：{pattern}

## 内容
{content}

## 评分维度（每项 1-5 分）

1. **类比质量**：讲解中是否使用了贴切的生活化类比？类比是否准确且帮助理解？
2. **例子具体度**：例子是否有人物/场景/数字等具体信息？还是空泛概念性描述？
3. **takeaway 概括力**：结尾要点是否一句话精准概括了最核心的结论？
4. **结构丰富度**：多种表征（定义卡/例子/表格）是否各角度互补？还是重复同一信息？

## 输出格式（严格 JSON）
{{"analogy": 1-5, "example_specificity": 1-5, "takeaway": 1-5, "structure_richness": 1-5, "overall_comment": "一句话总评"}}"""


async def score_quality_llm(topic: dict, blocks: list[dict]) -> dict:
    """LLM rubric 评分，返回各维度分数"""
    from lib.minimax import MiniMaxClient

    content_parts = []
    for b in blocks:
        if b["type"] == "markdown":
            content_parts.append(b.get("markdown", ""))
        elif b["type"] == "key_point":
            title = b.get("title", "要点")
            content_parts.append(f"【{title}】\n" + "\n".join(f"- {p}" for p in b.get("points", [])))
        elif b["type"] == "example":
            content_parts.append(f"【示例：{b.get('title', '')}】\n场景：{b.get('context', '')}\n{b.get('content', '')}")
        elif b["type"] == "comparison":
            header = " | ".join(b.get("columns", []))
            rows = "\n".join(" | ".join(r) for r in b.get("rows", []))
            content_parts.append(f"【对比表】\n{header}\n{rows}")

    content = "\n\n".join(content_parts)
    prompt = RUBRIC_PROMPT.format(
        topic=topic["topic"], task_title=topic["taskTitle"], pattern=topic["pattern"], content=content
    )

    client = MiniMaxClient()
    response = await client.chat(messages=[{"role": "user", "content": prompt}], max_tokens=8000)
    text = (response.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
    # 提取 JSON
    import re
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {"error": f"LLM 未返回 JSON: {text[:100]}"}
    try:
        data = json.loads(match.group())
        dims = ["analogy", "example_specificity", "takeaway", "structure_richness"]
        scores = {d: data.get(d, 0) for d in dims}
        scores["average"] = round(sum(scores[d] for d in dims) / len(dims), 1)
        scores["comment"] = data.get("overall_comment", "")
        return scores
    except json.JSONDecodeError:
        return {"error": f"JSON 解析失败: {text[:100]}"}


# ---- 主流程 ----

async def evaluate_topic(topic: dict, with_llm: bool) -> dict:
    """生成单主题内容并评分"""
    request = TaskStreamRequest(
        courseId=f"eval-{topic['id']}", chapterId="eval-ch", planId="eval-plan", planVersion=1,
        taskId="eval-t1", attempt=1,
        task={
            "taskId": "eval-t1", "title": topic["taskTitle"], "taskGoal": topic["taskGoal"],
            "teachingPattern": topic["pattern"], "observableOutcome": topic["taskGoal"],
        },
        chapter={"title": "评测章节", "teachingGoal": f"理解{topic['topic']}的核心概念"},
        courseTopic=topic["topic"],
        learnerStartingPoint={"estimatedLevel": "beginner", "confirmedKnowledge": [], "likelyGaps": []},
    )

    events = []
    async for e in stream_task_events(request):
        events.append(e)

    # 提取 blocks
    task_completed = next((e for e in events if e["type"] == "task_completed"), None)
    if not task_completed:
        error_event = next((e for e in events if e["type"] == "request_error"), None)
        return {"id": topic["id"], "error": error_event["payload"]["message"] if error_event else "未收到 task_completed"}

    blocks = task_completed["payload"]["task"]["blocks"]
    structure = score_structure(topic, blocks)

    result = {"id": topic["id"], "pattern": topic["pattern"], "structure": structure}

    if with_llm:
        quality = await score_quality_llm(topic, blocks)
        result["quality"] = quality

    return result


async def main():
    with_llm = "--llm" in sys.argv
    topics = json.loads(TOPICS_PATH.read_text(encoding="utf-8"))

    print(f"评测 {len(topics)} 主题 {'（含 LLM rubric）' if with_llm else '（仅结构判分）'}\n")
    results = []
    for topic in topics:
        print(f"  生成: {topic['taskTitle']} ({topic['pattern']})...")
        result = await evaluate_topic(topic, with_llm)
        results.append(result)
        if "error" in result:
            print(f"  ❌ {result['error']}")
        else:
            print(f"  块类型: {result['structure']['blockTypes']}")
            print(f"  结构分: {result['structure']['percent']}%")
            if "quality" in result and "average" in result.get("quality", {}):
                q = result["quality"]
                print(f"  质量分: {q['average']}/5 — {q.get('comment', '')}")
        print()

    # 汇总
    passed = [r for r in results if "error" not in r and r["structure"]["percent"] >= PASS_THRESHOLD]
    total = len(results)
    avg_structure = round(sum(r["structure"]["percent"] for r in results if "error" not in r) / max(total, 0))
    avg_quality = None
    if with_llm:
        quality_scores = [r["quality"]["average"] for r in results if "error" not in r and "average" in r.get("quality", {})]
        avg_quality = round(sum(quality_scores) / len(quality_scores), 1) if quality_scores else None

    report = {
        "timestamp": str(asyncio.get_event_loop().time()),
        "totalTopics": total,
        "passed": len(passed),
        "avgStructureScore": avg_structure,
        "avgQualityScore": avg_quality,
        "passThreshold": PASS_THRESHOLD,
        "results": results,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))

    if len(passed) < total:
        print(f"\n❌ {total - len(passed)}/{total} 主题未达标")
        sys.exit(1)
    print(f"\n✅ {total}/{total} 主题达标")


if __name__ == "__main__":
    asyncio.run(main())
