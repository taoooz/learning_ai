from pydantic import BaseModel, Field
from typing import Literal, Optional


class LearnerPositioning(BaseModel):
    """用户定位"""
    estimatedLevel: Literal["beginner", "intermediate", "advanced"]
    difficultySummary: str
    backgroundSummary: str
    skipBasics: list[str] = Field(default_factory=list)
    whyThisCourseFits: str


class OutlineBlueprint(BaseModel):
    """课程纲要 Blueprint"""
    learningDirection: str
    learningGoal: str
    learnerPositioning: LearnerPositioning


class ClarificationQuestion(BaseModel):
    """澄清问题"""
    id: str
    question: str
    options: list[str] = Field(default_factory=list)


class OutlineResponse(BaseModel):
    """Outline 响应"""
    type: Literal["confirmation", "questions", "reconsider"]
    blueprint: Optional[OutlineBlueprint] = None
    questions: Optional[list[ClarificationQuestion]] = None
    message: Optional[str] = None
    sessionId: Optional[str] = None


class OutlineRequest(BaseModel):
    """生成 Outline 请求"""
    topic: str = Field(..., description="课程主题")
    userProfile: dict = Field(default_factory=dict, description="用户画像")
    planningMemory: dict = Field(default_factory=dict, description="精简的规划记忆 payload")


class OutlineAnswerRequest(BaseModel):
    """提交问题答案请求"""
    sessionId: str = Field(..., description="Session ID")
    answer: str = Field(..., description="用户答案")
