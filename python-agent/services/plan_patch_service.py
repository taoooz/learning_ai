"""
P4 动态调度服务：基于证据信号生成计划补丁建议
客户端拿到建议后必须过 canApplyPatch 校验（版本/上限/只动未展示任务）才应用
"""
import json
import uuid

from lib.minimax import MiniMaxClient
from prompts.plan_patch import build_plan_patch_prompt
from schemas.plan_patch import PlanPatchResponse, PatchOperation

_PROMPT_VERSION = "plan-patch-v1"


def _format_tasks(tasks: list[dict]) -> str:
    if not tasks:
        return "（无剩余任务）"
    lines = []
    for t in tasks:
        lines.append(f"- {t.get('taskId')}: {t.get('title')}（目标: {t.get('taskGoal', '')}）")
    return "\n".join(lines)


def _format_evidence(evidence: list[dict]) -> str:
    if not evidence:
        return "（暂无证据）"
    lines = []
    for e in evidence:
        lines.append(f"- 目标 {e.get('objectiveId')}: {e.get('outcome')}（得分 {e.get('score', 'N/A')}）")
    return "\n".join(lines)


async def generate_plan_patch(
    course_topic: str,
    chapter_title: str,
    teaching_goal: str,
    plan_version: int,
    remaining_tasks: list[dict],
    evidence_summary: list[dict],
    client: MiniMaxClient | None = None,
) -> PlanPatchResponse:
    """LLM 生成计划补丁建议（可返回空 operations 表示无需调整）"""
    client = client or MiniMaxClient()
    system_prompt = build_plan_patch_prompt(
        course_topic=course_topic,
        chapter_title=chapter_title,
        teaching_goal=teaching_goal,
        remaining_tasks=_format_tasks(remaining_tasks),
        evidence_summary=_format_evidence(evidence_summary),
    )
    response = await client.chat(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "请分析证据并给出调度建议。只输出 JSON 对象。"},
        ],
        max_tokens=3000,
    )
    content = response["choices"][0]["message"]["content"]

    # 复用 checkpoint 的 JSON 提取（含 CJK 引号修复与重试由调用方承担；此处单次）
    from services.checkpoint_service import _extract_json
    raw = _extract_json(content.strip())

    operations = []
    for op in raw.get("operations", []):
        operations.append(PatchOperation(**op))

    reason_code = raw.get("reasonCode", "STRONG_PRIOR_EVIDENCE")
    confidence = raw.get("confidence", 0.5)
    if not isinstance(confidence, (int, float)) or not (0 <= confidence <= 1):
        confidence = 0.5

    return PlanPatchResponse(
        patchId=f"patch-{uuid.uuid4().hex[:12]}",
        basePlanVersion=plan_version,
        operations=operations,
        summary=raw.get("summary", ""),
        reasonCode=reason_code,
        confidence=round(float(confidence), 2),
    )
