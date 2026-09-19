"""
P3 结构化 Checkpoint 服务：生成 + 程序判分
- 生成：调用 LLM 产出 JSON 格式的 scenario_choice / sequence 题目
- 判分：纯程序对比 answer 与 correctAnswer，确定性结果，不经模型
"""
import json
import re
from uuid import uuid4

from pydantic import ValidationError

from lib.minimax import MiniMaxClient
from prompts.checkpoint import build_checkpoint_prompt
from schemas.checkpoint import CheckpointDefinitionModel, CheckpointEvaluationModel

_PROMPT_VERSION = "checkpoint-gen-v1"
_EVAL_VERSION = "checkpoint-eval-v1"


def _extract_json(text: str) -> dict:
    """从 LLM 输出中提取 JSON 对象（容忍代码围栏和前后杂文）"""
    text = text.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        return json.loads(fence_match.group(1))
    brace_match = re.search(r"\{.*\}", text, re.DOTALL)
    if brace_match:
        return json.loads(brace_match.group(0))
    raise ValueError("LLM 输出中未找到 JSON 对象")


def _validate_definition(raw: dict, task_id: str, objective_id: str) -> CheckpointDefinitionModel:
    """校验并补全 checkpoint 定义"""
    raw.setdefault("checkpointId", f"cp-{uuid4().hex[:12]}")
    raw.setdefault("taskId", task_id)
    raw["objectiveId"] = objective_id
    raw.setdefault("conceptKeys", [])
    raw.setdefault("estimatedSeconds", 45)
    return CheckpointDefinitionModel(**raw)


async def generate_checkpoint(
    course_topic: str,
    chapter_title: str,
    teaching_goal: str,
    task_id: str,
    task_title: str,
    task_goal: str,
    objective_id: str,
    task_content_summary: str,
    client: MiniMaxClient | None = None,
) -> CheckpointDefinitionModel:
    """调用 LLM 生成一道结构化 Checkpoint"""
    client = client or MiniMaxClient()
    system_prompt = build_checkpoint_prompt(
        course_topic=course_topic,
        chapter_title=chapter_title,
        teaching_goal=teaching_goal,
        task_title=task_title,
        task_goal=task_goal,
        task_content_summary=task_content_summary,
    )
    response = await client.chat(
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": "请生成一道理解检查题。"}],
        max_tokens=2000,
    )
    content = response["choices"][0]["message"]["content"]
    raw = _extract_json(content)
    return _validate_definition(raw, task_id, objective_id)


def evaluate_checkpoint(
    definition: CheckpointDefinitionModel,
    answer: str | list[str],
    attempt: int,
) -> CheckpointEvaluationModel:
    """结构化题程序判分：确定性对比，不经模型

    scenario_choice：字符串精确匹配
    sequence：列表精确匹配（顺序敏感）
    补救策略：attempt=1 错误 → remediate_here；attempt>=2 错误 → continue（标记 not_demonstrated，不锁死）
    """
    if definition.kind == "scenario_choice":
        correct = isinstance(answer, str) and answer.strip() == definition.correctAnswer.strip()
    elif definition.kind == "sequence":
        correct = isinstance(answer, list) and list(answer) == list(definition.correctAnswer)
    else:
        correct = False

    if correct:
        return CheckpointEvaluationModel(
            checkpointId=definition.checkpointId,
            outcome="demonstrated",
            score=1.0,
            confidence=1.0,
            feedback="回答正确，你理解了这个概念。",
            nextAction="continue",
            correct=True,
        )

    if attempt >= 2:
        # 补救最多两轮，仍未证明理解 → 允许继续但标记不稳定
        return CheckpointEvaluationModel(
            checkpointId=definition.checkpointId,
            outcome="not_demonstrated",
            score=0.0,
            confidence=1.0,
            feedback=f"这个目标还需要巩固。{definition.remediationHint} 可以继续学习，后续会再次遇到相关内容。",
            nextAction="continue",
            correct=False,
            correctAnswer=definition.correctAnswer,
        )

    return CheckpointEvaluationModel(
        checkpointId=definition.checkpointId,
        outcome="not_demonstrated",
        score=0.0,
        confidence=1.0,
        feedback=f"回答不正确。{definition.remediationHint}",
        nextAction="remediate_here",
        correct=False,
        correctAnswer=definition.correctAnswer,
    )
