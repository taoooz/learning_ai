# schemas/tutor.py — P2 流内答疑请求模型
# 契约对齐：
# - InlineTutorRequest 与 lib/learning-v2/tutor-context.ts InlineTutorRequestPayload 逐字段对齐
# - InlineTutorResponse 与 types/learning-v2/events.ts TutorCompletedPayload 对齐
# - TutorAction 与 docs/architecture/v2_课程生成逻辑.md §2.6.2 教学动作对齐
# 最小上下文红线（设计文档 §3.2）：全部模型 extra='forbid'，
# 整门课程对象、全量聊天历史或任何未定义字段一律拒收
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TutorActionType = Literal["answer_inline", "expand_current", "switch_explanation", "proceed"]
TutorReasonCode = Literal[
    "LOCAL_QUESTION",
    "NEEDS_EXAMPLE",
    "NEEDS_MORE_DETAIL",
    "EXPLANATION_MISMATCH",
    "USER_READY",
]


class InlineTutorChapterInfo(BaseModel):
    """当前章节的最小信息（只含标题与教学目标）"""
    model_config = ConfigDict(extra="forbid")

    title: str
    teachingGoal: str


class InlineTutorTaskInfo(BaseModel):
    """当前任务的最小信息"""
    model_config = ConfigDict(extra="forbid")

    taskId: str
    title: str
    taskDescription: str


class InlineTutorQA(BaseModel):
    """当前任务的一组历史问答（客户端已按字符上限截断）"""
    model_config = ConfigDict(extra="forbid")

    question: str
    answer: str


class InlineTutorCurrentQuestion(BaseModel):
    """本次提问：问题文本与稳定 questionId"""
    model_config = ConfigDict(extra="forbid")

    questionId: str
    text: str


class InlineTutorRequest(BaseModel):
    """流内答疑请求：只携带最小上下文，严禁夹带课程全量对象或全量历史"""
    model_config = ConfigDict(extra="forbid")

    mode: Literal["inline_tutor"] = Field(..., description="固定为 inline_tutor")
    courseId: str = Field(..., description="课程实例 ID（事件外壳守卫字段，不进入幂等键格式）")
    courseTopic: str
    chapter: InlineTutorChapterInfo
    task: InlineTutorTaskInfo
    visibleContent: str = Field(..., description="当前任务已展示内容（客户端截断至 6000 字符）")
    recentInlineQA: list[InlineTutorQA] = Field(
        default_factory=list,
        description="当前任务最近 3 组问答（问题 ≤300 字符、回答 ≤1200 字符）",
    )
    question: InlineTutorCurrentQuestion
    idempotencyKey: str = Field(..., description="Tutor 请求幂等键（tutor:{chapterId}:v{planVersion}:{taskId}:{questionId}）")


class InlineTutorAnswerBlock(BaseModel):
    """Tutor 回答块：第一版只允许 markdown（设计文档 §2.1）"""
    model_config = ConfigDict(extra="forbid")

    type: Literal["markdown"]
    blockId: str
    markdown: str


class TutorActionField(BaseModel):
    """教学动作：模型根据问题分类判定（§2.6.2 P2 四意图）"""
    model_config = ConfigDict(extra="forbid")

    type: TutorActionType
    reasonCode: TutorReasonCode


class InlineTutorResponse(BaseModel):
    """流内答疑定稿响应（tutor_completed 载荷形状 + 生成元信息）"""
    model_config = ConfigDict(extra="forbid")

    questionId: str
    blocks: list[InlineTutorAnswerBlock]
    action: TutorActionField
    generationMeta: dict
