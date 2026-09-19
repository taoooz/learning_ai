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


# CJK 字符与全角标点（用于修复 LLM 在 JSON 字符串值内使用 ASCII 引号包中文的问题）
_CJK_CLASS = r'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]'


def _repair_cjk_quotes(text: str) -> str:
    """修复 JSON 字符串值内未转义的 ASCII 引号（LLM 用 "中文" 引用时的常见问题）

    启发式：紧邻 CJK 字符的 ASCII 双引号是内容引号，替换为 Unicode 弯引号。
    结构性引号（键名、冒号后、逗号前）两侧至少有一侧是 ASCII 字符，不受影响。
    """
    import re
    return re.sub(
        f'(?<={_CJK_CLASS})"(?={_CJK_CLASS})',
        '\u201d',
        text,
    )


def _extract_json(text: str) -> dict:
    """从 LLM 输出中提取 JSON 对象（容忍代码围栏和前后杂文）

    解析优先级：直接 loads → 围栏提取 → 花括号正则提取
    每级失败时先尝试 CJK 引号修复再解析
    """
    text = text.strip()
    # 1. 直接解析（最常见：模型输出纯净 JSON）
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 2. 围栏提取
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        try:
            return json.loads(fence_match.group(1))
        except json.JSONDecodeError:
            return json.loads(_repair_cjk_quotes(fence_match.group(1)))
    # 3. 花括号正则提取（贪婪匹配到最后一个 }）
    brace_match = re.search(r"\{.*\}", text, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except json.JSONDecodeError:
            repaired = _repair_cjk_quotes(brace_match.group(0))
            return json.loads(repaired)
    # 4. 全文修复后再试
    repaired = _repair_cjk_quotes(text)
    try:
        return json.loads(repaired)
    except json.JSONDecodeError:
        pass
    raise ValueError("LLM 输出中未找到 JSON 对象")


def _validate_definition(raw: dict, task_id: str, objective_id: str) -> CheckpointDefinitionModel:
    """校验并补全 checkpoint 定义"""
    raw.setdefault("checkpointId", f"cp-{uuid4().hex[:12]}")
    raw.setdefault("taskId", task_id)
    raw["objectiveId"] = objective_id
    raw.setdefault("conceptKeys", [])
    raw.setdefault("estimatedSeconds", 45)
    return CheckpointDefinitionModel(**raw)


async def _call_for_json(
    client: MiniMaxClient,
    system_prompt: str,
    user_message: str,
    max_tokens: int = 2000,
    retries: int = 3,
) -> dict:
    """调用 LLM 并提取 JSON；解析失败时重试（glm-5.3-flash 偶尔空 content 或 JSON 内含特殊字符）"""
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        response = await client.chat(
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}],
            max_tokens=max_tokens,
        )
        message = response["choices"][0]["message"]
        content = message.get("content") or ""
        if not content.strip():
            # 思考模式偶尔 content 为空（全部输出进 reasoning_content）：重试
            print(f"[Checkpoint] content 为空（第 {attempt} 次），reasoning {len(message.get('reasoning_content', '') or '')} 字")
            last_error = ValueError("模型输出 content 为空")
            continue
        try:
            return _extract_json(content)
        except (ValueError, json.JSONDecodeError) as exc:
            last_error = exc
            print(f"[Checkpoint] JSON 提取失败（第 {attempt} 次）: {exc}，content 前 100 字: {content[:100]!r}")
    raise last_error or ValueError("JSON 提取失败")


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
    """调用 LLM 生成一道结构化 Checkpoint（含重试）"""
    client = client or MiniMaxClient()
    system_prompt = build_checkpoint_prompt(
        course_topic=course_topic,
        chapter_title=chapter_title,
        teaching_goal=teaching_goal,
        task_title=task_title,
        task_goal=task_goal,
        task_content_summary=task_content_summary,
    )
    raw = await _call_for_json(client, system_prompt, "请生成一道理解检查题。只输出 JSON 对象，不要输出其他文字。")
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


async def generate_remediation(
    course_topic: str,
    chapter_title: str,
    task_id: str,
    task_title: str,
    task_goal: str,
    original_prompt: str,
    user_answer: str,
    correct_answer: str,
    original_hint: str,
    task_content_summary: str,
    client: MiniMaxClient | None = None,
) -> dict:
    """LLM 生成补救内容 + 等价不同题的新检查（§2.7 补救流程，含重试）"""
    from prompts.checkpoint import REMEDIATION_PROMPT

    client = client or MiniMaxClient()
    system_prompt = (
        REMEDIATION_PROMPT["role"]
        + "\n"
        + REMEDIATION_PROMPT["remediation_context"].format(
            course_topic=course_topic,
            chapter_title=chapter_title,
            task_title=task_title,
            task_goal=task_goal,
            original_prompt=original_prompt,
            user_answer=user_answer,
            correct_answer=correct_answer,
            original_hint=original_hint,
            task_content_summary=task_content_summary,
        )
        + "\n"
        + REMEDIATION_PROMPT["output_format"]
    )
    raw = await _call_for_json(client, system_prompt, "请生成补救内容和新检查题。只输出 JSON 对象，不要输出其他文字。")
    if "remediationContent" not in raw or "newCheckpoint" not in raw:
        raise ValueError("补救响应缺少 remediationContent 或 newCheckpoint")
    return _normalize_new_checkpoint(raw)


def _normalize_new_checkpoint(raw: dict) -> dict:
    """模型输出格式不稳定时做类型修正（如 options 输出为纯字符串数组）"""
    nc = raw["newCheckpoint"]
    if nc.get("kind") == "scenario_choice" and isinstance(nc.get("options"), list):
        normalized = []
        for index, opt in enumerate(nc["options"]):
            if isinstance(opt, dict) and "id" in opt and "text" in opt:
                normalized.append(opt)
            elif isinstance(opt, str):
                normalized.append({"id": chr(ord("a") + index), "text": opt})
        nc["options"] = normalized
    if nc.get("kind") == "sequence" and isinstance(nc.get("sequenceItems"), list):
        normalized = []
        for index, item in enumerate(nc["sequenceItems"]):
            if isinstance(item, dict) and "id" in item and "text" in item:
                normalized.append(item)
            elif isinstance(item, str):
                normalized.append({"id": f"s{index + 1}", "text": item})
        nc["sequenceItems"] = normalized
    return raw


async def evaluate_open_ended(
    definition: CheckpointDefinitionModel,
    answer: str,
    client: MiniMaxClient | None = None,
) -> CheckpointEvaluationModel:
    """开放式题型 LLM Rubric 评分（§2.7：须经回归样本验证达标后启用）

    P3b 红线：confidence < 0.5 时降级为 partial 且不产出证据（评分不可信）。
    """
    from prompts.checkpoint import OPEN_ENDED_EVAL_PROMPT

    client = client or MiniMaxClient()
    system_prompt = OPEN_ENDED_EVAL_PROMPT.format(
        prompt=definition.prompt,
        rubric=definition.rubric or "无具体 Rubric，请根据回答与题目的相关性及完整性评分。",
        answer=answer,
    )
    raw = await _call_for_json(
        client,
        system_prompt,
        "请根据 Rubric 对上述回答进行评分。只输出 JSON 对象。feedback 中引用回答内容时使用「」而非引号。",
        max_tokens=4000,
    )

    outcome = raw.get("outcome", "not_demonstrated")
    if outcome not in ("demonstrated", "partial", "not_demonstrated"):
        outcome = "not_demonstrated"
    score = raw.get("score")
    if not isinstance(score, (int, float)) or not (0 <= score <= 1):
        score = {"demonstrated": 0.9, "partial": 0.5, "not_demonstrated": 0.2}[outcome]
    confidence = raw.get("confidence")
    if not isinstance(confidence, (int, float)) or not (0 <= confidence <= 1):
        confidence = 0.5

    # P3b 红线：评分置信度过低时不产出能力证据（degraded 路径）
    if confidence < 0.5:
        return CheckpointEvaluationModel(
            checkpointId=definition.checkpointId,
            outcome="partial",
            score=min(score, 0.5),
            confidence=confidence,
            feedback=f"{raw.get('feedback', '')}（评估置信度较低，此结果不作为能力证据）",
            nextAction="continue",
            correct=score >= 0.5,
        )

    next_action = "continue" if outcome == "demonstrated" else "remediate_here"
    correct = outcome == "demonstrated"

    return CheckpointEvaluationModel(
        checkpointId=definition.checkpointId,
        outcome=outcome,
        score=round(float(score), 2),
        confidence=round(float(confidence), 2),
        feedback=raw.get("feedback", ""),
        nextAction=next_action,
        correct=correct,
    )
