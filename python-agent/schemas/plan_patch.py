# schemas/plan_patch.py — P4 动态调度：计划补丁请求与响应模型
# 契约对齐：types/learning-v2/chapter-plan.ts（ChapterPlanPatch）
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PatchOperationType = Literal["insert_task", "skip_task", "reorder_tasks", "adjust_depth"]
PatchReasonCode = Literal[
    "STRONG_PRIOR_EVIDENCE",
    "USER_REQUESTED_DEPTH",
    "DEPENDENCY_DISCOVERED",
    "REMEDIATION_GAP",
]


class PatchOperation(BaseModel):
    """单个计划操作（白名单外类型拒收）"""
    model_config = ConfigDict(extra="forbid")

    type: PatchOperationType
    newTask: dict | None = None
    targetTaskIds: list[str] = Field(default_factory=list)
    newOrder: list[str] | None = None
    depth: Literal["brief", "standard", "detailed"] | None = None


class GeneratePlanPatchRequest(BaseModel):
    """调度请求：基于证据信号生成补丁建议"""
    model_config = ConfigDict(extra="forbid")

    courseId: str
    chapterId: str
    planVersion: int
    courseTopic: str
    chapterTitle: str
    teachingGoal: str
    remainingTasks: list[dict] = Field(..., description="未展示任务（taskId/title/taskGoal/teachingPattern）")
    evidenceSummary: list[dict] = Field(..., description="学习证据摘要（objectiveId/outcome/score）")
    idempotencyKey: str


class PlanPatchResponse(BaseModel):
    """生成的补丁建议（客户端再过 canApplyPatch 校验）"""
    model_config = ConfigDict(extra="forbid")

    patchId: str
    basePlanVersion: int
    operations: list[PatchOperation]
    summary: str
    reasonCode: PatchReasonCode
    confidence: float = Field(..., ge=0, le=1)
