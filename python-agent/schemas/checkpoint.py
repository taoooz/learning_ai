# schemas/checkpoint.py — P3 结构化 Checkpoint 请求与响应模型
# P3a 范围：scenario_choice / sequence 两种程序可判分题型
# 契约对齐：types/learning-v2/checkpoint.ts（TS 侧）

from typing import Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

CheckpointKindType = Literal["scenario_choice", "sequence", "self_explanation", "micro_practice"]
# P3b 上线红线（§2.7）：开放式类型须先通过回归样本一致性验证（agreement >= 80%）才可启用
OPEN_ENDED_KINDS = ("self_explanation", "micro_practice")


class CheckpointOption(BaseModel):
    """scenario_choice 选项"""
    model_config = ConfigDict(extra="ignore")

    id: str
    text: str


class SourceRefModel(BaseModel):
    """Checkpoint 题目引用的权威来源"""
    model_config = ConfigDict(extra="ignore")

    title: str
    url: str


class SequenceItem(BaseModel):
    """sequence 排序项"""
    model_config = ConfigDict(extra="ignore")

    id: str
    text: str


class CheckpointDefinitionModel(BaseModel):
    """生成的 Checkpoint 定义（SSE 下发）"""
    model_config = ConfigDict(extra="ignore")

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
    sourceRefs: list[SourceRefModel] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_answer_references(self):
        if self.kind == "scenario_choice":
            option_ids = {item.id for item in (self.options or [])}
            if not isinstance(self.correctAnswer, str) or self.correctAnswer not in option_ids:
                raise ValueError("scenario_choice 的 correctAnswer 必须引用现有 option id")
        elif self.kind == "sequence":
            sequence_ids = {item.id for item in (self.sequenceItems or [])}
            if not isinstance(self.correctAnswer, list):
                raise ValueError("sequence 的 correctAnswer 必须是数组")
            if len(self.correctAnswer) != len(sequence_ids) or set(self.correctAnswer) != sequence_ids:
                raise ValueError("sequence 的 correctAnswer 必须完整且唯一引用 sequenceItems id")
        return self


class CheckpointEvaluateRequest(BaseModel):
    """Checkpoint 判分请求；题目、范围、attempt 均由服务端权威读取/派生。"""
    model_config = ConfigDict(extra="forbid")

    checkpointId: str
    answer: Union[str, list[str]]
    idempotencyKey: str


class CheckpointGenerateRequest(BaseModel):
    """生成请求只接受 ID；教学字段由服务端课程与章节容器反查。"""
    model_config = ConfigDict(extra="forbid")

    courseId: str
    chapterId: str
    taskId: str
    idempotencyKey: str


class CheckpointRemediateRequest(BaseModel):
    """补救请求只接受 Checkpoint ID 与用户答案；轮次和任务上下文由服务端派生。"""
    model_config = ConfigDict(extra="forbid")

    checkpointId: str
    userAnswer: str
    idempotencyKey: str


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
