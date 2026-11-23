"""Course Prompt Lab 的隔离调试请求模型。"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


PromptLabStageId = Literal[
    "outline_initial",
    "outline_answer",
    "architect_chapters",
    "architect_meta",
    "architect_review",
    "chapter_plan",
    "chapter_plan_review",
    "task_search_decision",
    "task_content",
]


class PromptLabCompileRequest(BaseModel):
    stage: PromptLabStageId
    inputs: dict = Field(default_factory=dict)


class PromptLabRunRequest(BaseModel):
    stage: PromptLabStageId
    inputs: dict = Field(default_factory=dict)
    system_prompt: str
    user_message: str = ""
    history: list[dict] = Field(default_factory=list)
    tools_enabled: bool = False
    max_tokens: int = Field(8000, ge=1, le=32000)
    max_searches: int = Field(0, ge=0, le=3)
    max_iterations: int = Field(1, ge=1, le=8)
    reasoning_effort: Optional[str] = None
