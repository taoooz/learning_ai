# V2 学习流请求模型
# 字段与 types/learning-v2/*.ts 契约对齐：
# - ChapterPlanRequest.blueprint 为完整 CourseBlueprintV2（blueprint.ts）
# - 计划输出结构见 chapter-plan.ts（ChapterPlan / PlannedTask）
from pydantic import BaseModel, Field
from typing import Optional


class ChapterPlanRequest(BaseModel):
    """章节计划生成请求"""
    courseId: str = Field(..., description="课程 ID")
    chapterId: str = Field(..., description="章节 ID")
    idempotencyKey: Optional[str] = Field(None, description="幂等键（P1a 仅随请求上送供日志）")
    blueprint: dict = Field(..., description="完整 CourseBlueprintV2（含 chapters / courseObjectives / learnerStartingPoint / topic）")


class TaskStreamTaskInfo(BaseModel):
    """待生成内容的任务描述"""
    taskId: str
    title: str
    taskGoal: str
    teachingPattern: str
    observableOutcome: str


class TaskStreamChapterInfo(BaseModel):
    """任务所属章节的上下文"""
    title: str
    teachingGoal: str


class TaskStreamLearnerStartingPoint(BaseModel):
    """学习者起点（对齐 blueprint.ts LearnerStartingPoint 的核心字段）"""
    estimatedLevel: str
    confirmedKnowledge: list[str] = Field(default_factory=list)
    likelyGaps: list[str] = Field(default_factory=list)


class PreviousTaskInfo(BaseModel):
    """本章已完成任务摘要（防内容重复用）"""
    title: str
    takeaway: Optional[str] = None


class TaskStreamRequest(BaseModel):
    """任务内容流式生成请求"""
    courseId: str
    chapterId: str
    planId: str
    planVersion: int
    taskId: str
    attempt: int
    idempotencyKey: Optional[str] = None
    task: TaskStreamTaskInfo
    chapter: TaskStreamChapterInfo
    courseTopic: str
    learnerStartingPoint: TaskStreamLearnerStartingPoint
    previousTasks: list[PreviousTaskInfo] = Field(default_factory=list)
    nextTaskTitle: Optional[str] = None


class ChapterRecapTaskInfo(BaseModel):
    """本章已完成任务的摘要（Recap 输入）"""
    title: str
    takeaway: Optional[str] = None


class ChapterRecapRequest(BaseModel):
    """章节 Recap 生成请求（非流式）"""
    courseId: str
    chapterId: str
    planId: str
    planVersion: int
    idempotencyKey: Optional[str] = Field(None, description="幂等键（P1b 仅随请求上送供日志）")
    courseTopic: str
    chapter: TaskStreamChapterInfo
    tasks: list[ChapterRecapTaskInfo] = Field(default_factory=list)
    nextChapterTitle: Optional[str] = None


class ChapterRecapResponse(BaseModel):
    """章节 Recap 响应，与 types/learning-v2/learning-stream.ts ChapterRecap 逐字段对齐。
    证据红线（画像文档 §7.1）：demonstratedObjectives / fragileObjectives /
    unresolvedQuestions 由服务端确定性填空数组，LLM 不得产出。"""
    chapterId: str
    keyTakeaways: list[str]
    demonstratedObjectives: list[str] = Field(default_factory=list)
    fragileObjectives: list[str] = Field(default_factory=list)
    unresolvedQuestions: list[str] = Field(default_factory=list)
    recommendedReview: Optional[str] = None
    nextChapterPreview: Optional[str] = None
    generationMeta: dict
