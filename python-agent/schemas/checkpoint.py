# schemas/checkpoint.py — P3 结构化 Checkpoint 请求与响应模型
# P3a 范围：scenario_choice / sequence 两种程序可判分题型
# 契约对齐：types/learning-v2/checkpoint.ts（TS 侧）

from typing import Literal, Union

from pydantic import BaseModel, ConfigDict, Field

CheckpointKindType = Literal["scenario_choice", "sequence", "self_explanation", "micro_practice"]
# P3b 上线红线（§2.7）：开放式类型须先通过回归样本一致性验证（agreement >= 80%）才可启用
OPEN_ENDED_KINDS = ("self_explanation", "micro_practice")


class CheckpointOption(BaseModel):
    """scenario_choice 选项"""
    model_config = ConfigDict(extra="forbid")

    id: str
    text: str


class SequenceItem(BaseModel):
    """sequence 排序项"""
    model_config = ConfigDict(extra="forbid")

    id: str
    text: str


class CheckpointDefinitionModel(BaseModel):
    """生成的 Checkpoint 定义（SSE 下发）"""
    model_config = ConfigDict(extra="forbid")

    checkpointId: str
    objectiveId: str
    taskId: str
    conceptKeys: list[str] = Field(default_factory=list)
    kind: CheckpointKindType
    prompt: str
    rubric: str | None = None
    options: list[CheckpointOption] | None = None
    sequenceItems: list[SequenceItem] | None = None
    correctAnswer: Union[str, list[str]]
    remediationHint: str
    estimatedSeconds: int = Field(default=45, ge=10, le=120)


class CheckpointEvaluateRequest(BaseModel):
    """结构化题判分请求（程序判分，不经模型）；checkpoint 定义经请求携带"""
    model_config = ConfigDict(extra="forbid")

    courseId: str
    chapterId: str
    taskId: str
    checkpointId: str
    answer: Union[str, list[str]]
    attempt: int = Field(default=1, ge=1, le=3)
    idempotencyKey: str
    checkpoint: CheckpointDefinitionModel


class CheckpointEvaluationModel(BaseModel):
    """评估结果"""
    model_config = ConfigDict(extra="forbid")

    checkpointId: str
    outcome: Literal["demonstrated", "partial", "not_demonstrated", "skipped"]
    score: float | None = None
    confidence: float = 1.0
    feedback: str
    nextAction: Literal["continue", "remediate_here", "insert_remediation_task"]
    correct: bool
    correctAnswer: Union[str, list[str]] | None = None
