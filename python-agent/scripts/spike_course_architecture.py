"""Course Architect dry-run：生成架构并输出校验报告，不接入主应用链路。"""
import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path


def _load_env() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _sample_inputs(topic: str) -> tuple[dict, dict, dict]:
    outline = {
        "topic": topic,
        "learningDirection": "从实际业务链路理解推荐系统如何工作",
        "learningGoal": "能判断推荐问题属于哪个链路环节，并能提出验证方案",
        "learnerPositioning": {
            "estimatedLevel": "intermediate",
            "backgroundSummary": "做过内容运营，参与过推荐位配置和效果复盘",
            "skipBasics": ["推荐系统基本概念"],
            "likelyGaps": ["召回与排序边界", "离线评估"],
            "levelConfidence": 0.75,
            "preferredExampleDomains": ["电商推荐", "内容平台"],
            "personalExampleLimit": 1,
        },
    }
    learner = outline["learnerPositioning"]
    memory = {
        "scene": "course_architecture",
        "core": {
            "goals": [{"text": "提升推荐系统设计能力"}],
            "constraints": [],
            "activePreferences": [{"text": "希望例子贴近真实工作，但不要反复讲同一段经历"}],
            "riskConcepts": [],
            "reviewQueue": [],
        },
        "learningState": {"conceptStates": [], "topicStates": []},
        "index": [],
        "bodies": [],
        "evidence": [],
        "fallback": "none",
    }
    return outline, learner, memory


def _build_inputs(spec: dict) -> tuple[str, dict, dict, dict]:
    topic = spec["topic"]
    learner = spec["learnerPositioning"]
    learning_goal = spec.get("learningGoal") or f"完成 {topic} 的独立学习目标"
    outline = {
        "topic": topic,
        "learningDirection": learning_goal,
        "learningGoal": learning_goal,
        "learnerPositioning": learner,
    }
    memory = {
        "scene": "course_architecture",
        "core": {
            "goals": [{"text": learning_goal}],
            "constraints": [],
            "activePreferences": [],
            "riskConcepts": [],
            "reviewQueue": [],
        },
        "learningState": {"conceptStates": [], "topicStates": []},
        "index": [],
        "bodies": [],
        "evidence": [],
        "fallback": "none",
    }
    return topic, outline, learner, memory


def _safe_filename(index: int, topic: str) -> str:
    safe = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff_-]+", "-", topic).strip("-")
    return f"{index:02d}-{safe[:48] or 'topic'}.json"


async def _run_batch(specs: list[dict], output_dir: Path, concurrency: int) -> None:
    from services.course_architect_service import generate_course_architecture

    output_dir.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(max(1, concurrency))
    summary: list[dict] = []

    async def run_one(index: int, spec: dict) -> None:
        async with semaphore:
            started = time.monotonic()
            topic, outline, learner, memory = _build_inputs(spec)
            try:
                result = await generate_course_architecture(
                    topic=topic,
                    outline=outline,
                    learner=learner,
                    memory_context=memory,
                )
                architecture = result["architecture"]
                payload = {"spec": spec, "result": result}
                summary_item = {
                    "index": index,
                    "topic": topic,
                    "ok": True,
                    "issues": result["issues"],
                    "review_skipped": result.get("reviewSkipped", False),
                    "review_unavailable": result.get("reviewUnavailable", False),
                    "chapter_count": len(architecture["chapters"]),
                    "concept_count": len(architecture["conceptGraph"]),
                    "depths": sorted({item["targetDepth"] for item in architecture["conceptGraph"]}),
                }
            except Exception as exc:  # noqa: BLE001 批跑记录单题失败，不丢其他结果
                payload = {"spec": spec, "error": str(exc)}
                summary_item = {
                    "index": index,
                    "topic": topic,
                    "ok": False,
                    "error": str(exc),
                    "chapter_count": 0,
                    "concept_count": 0,
                    "depths": [],
                }
            summary_item["latency_ms"] = round((time.monotonic() - started) * 1000)
            (output_dir / _safe_filename(index, topic)).write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            summary.append(summary_item)

    await asyncio.gather(*(run_one(index, spec) for index, spec in enumerate(specs, start=1)))
    summary.sort(key=lambda item: item["index"])
    (output_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


async def main() -> None:
    parser = argparse.ArgumentParser(description="Course Architect dry-run")
    parser.add_argument("--topic", default="推荐系统核心链路")
    parser.add_argument("--output", help="可选：将完整结果写入该 JSON 文件")
    parser.add_argument("--topics-file", help="可选：批量主题 JSON 文件")
    parser.add_argument("--output-dir", default="/tmp/course-architecture-batch")
    parser.add_argument("--concurrency", type=int, default=2)
    args = parser.parse_args()

    _load_env()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from services.course_architect_service import generate_course_architecture

    if args.topics_file:
        specs = json.loads(Path(args.topics_file).read_text(encoding="utf-8"))
        if not isinstance(specs, list) or not specs:
            raise SystemExit("topics-file 必须是非空 JSON 数组")
        await _run_batch(specs, Path(args.output_dir), args.concurrency)
        return

    outline, learner, memory = _sample_inputs(args.topic)
    result = await generate_course_architecture(
        topic=args.topic,
        outline=outline,
        learner=learner,
        memory_context=memory,
    )
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    asyncio.run(main())
