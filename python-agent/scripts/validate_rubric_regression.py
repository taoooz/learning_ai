#!/usr/bin/env python3
"""
P3b Rubric 评分一致性回归验证（§2.7 红线：agreement >= 80% 才可启用开放式题型）

用法：
    cd python-agent && .venv/bin/python scripts/validate_rubric_regression.py
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from lib.minimax import MiniMaxClient  # noqa: E402
from schemas.checkpoint import CheckpointDefinitionModel  # noqa: E402
from services.checkpoint_service import evaluate_open_ended  # noqa: E402

SAMPLES_PATH = Path(__file__).resolve().parent.parent / "data" / "rubric-regression-samples.json"


def load_samples() -> dict:
    with open(SAMPLES_PATH, encoding="utf-8") as f:
        return json.load(f)


def make_definition(sample: dict) -> CheckpointDefinitionModel:
    return CheckpointDefinitionModel(
        checkpointId=f"regression-{sample['id']}",
        objectiveId="regression",
        taskId="regression",
        kind=sample["kind"],
        prompt=sample["prompt"],
        rubric=sample["rubric"],
        correctAnswer="open-ended",
        remediationHint="",
        estimatedSeconds=60,
    )


async def run():
    data = load_samples()
    samples = data["samples"]
    threshold = data["threshold"]
    client = MiniMaxClient()

    print(f"Rubric 一致性回归验证：{len(samples)} 个样本，阈值 {threshold:.0%}\n")
    agreements = []
    failures = []

    for sample in samples:
        definition = make_definition(sample)
        try:
            evaluation = await evaluate_open_ended(definition, sample["answer"], client=client)
        except Exception as exc:  # noqa: BLE001
            print(f"❌ {sample['id']} 评估异常: {exc}")
            failures.append((sample["id"], "exception", sample["expected"]))
            agreements.append(False)
            continue

        match = evaluation.outcome == sample["expected"]
        icon = "✅" if match else "❌"
        print(f"{icon} {sample['id']} ({sample['kind']}): model={evaluation.outcome} expected={sample['expected']} "
              f"score={evaluation.score} conf={evaluation.confidence}")
        if not match:
            failures.append((sample["id"], evaluation.outcome, sample["expected"]))
        agreements.append(match)

    passed = sum(agreements)
    agreement_rate = passed / len(agreements) if agreements else 0
    print(f"\n一致率: {passed}/{len(agreements)} = {agreement_rate:.0%}（阈值 {threshold:.0%}）")
    if failures:
        print("不一致明细:")
        for sid, model_out, expected in failures:
            print(f"  {sid}: model={model_out} expected={expected}")

    if agreement_rate >= threshold:
        print("\n✅ 达标：可启用开放式题型（self_explanation / micro_practice）")
        sys.exit(0)
    else:
        print("\n❌ 未达标：开放式题型保持禁用，须优化 Rubric prompt 后重跑")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(run())
