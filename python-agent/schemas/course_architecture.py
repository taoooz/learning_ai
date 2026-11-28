"""Course Architect 的结构化输出与确定性校验。"""
from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field

# observableOutcome（=章节交付物）必须是可观察的行为/产物，
# 不能是"了解/熟悉/掌握"这类空泛认知动词（规格 v2_课程生成逻辑.md）。
# "掌握度"是名词（如"掌握度自评表"），用负向前瞻排除误杀。
_VAGUE_DELIVERABLE_RE = re.compile(r"^(了解|熟悉|掌握(?!度)|理解|认识|知道)")


class CourseThesis(BaseModel):
    audience: str
    currentBoundary: list[str] = Field(default_factory=list)
    targetCapability: str
    learningDelta: list[str] = Field(default_factory=list)
    nonGoals: list[str] = Field(default_factory=list)


class ArchitectureConcept(BaseModel):
    conceptId: str
    label: str
    targetDepth: Literal["skip", "refresh", "understand", "apply", "transfer"]
    rationale: str
    prerequisiteConceptIds: list[str] = Field(default_factory=list)
    evidenceIds: Optional[list[str]] = None


class ArchitectureChapter(BaseModel):
    chapterId: str
    title: str
    roleInCourse: str
    conceptIds: list[str] = Field(default_factory=list)
    deliverable: str
    prerequisites: list[str] = Field(default_factory=list)
    assessmentMode: Literal["none", "self_report", "checkpoint"] = "none"
    # 两层大纲（用户反馈#3）：staged 模式下归属的大阶段；flat 模式为 None。
    stageId: Optional[str] = None


class ArchitectureStage(BaseModel):
    """两层大纲的宏观阶段（复杂课题）：阶段→章节。flat 模式无 stages。"""
    stageId: str
    title: str
    stageGoal: str
    chapterIds: list[str] = Field(default_factory=list)


class CourseExamplePolicy(BaseModel):
    preferredDomains: list[str] = Field(default_factory=list)
    personalExampleLimit: int = 1
    avoidRepeatedScenarios: bool = True


class CourseArchitecture(BaseModel):
    architectureVersion: Literal[1] = 1
    courseTopic: str
    thesis: CourseThesis
    conceptGraph: list[ArchitectureConcept]
    chapters: list[ArchitectureChapter]
    examplePolicy: CourseExamplePolicy
    structureMode: Literal["flat", "staged"] = "flat"
    stages: Optional[list[ArchitectureStage]] = None


class CourseChapterPlan(BaseModel):
    """第一阶段输出：只生成可先展示的章节目录。"""

    architectureVersion: Literal[1] = 1
    courseTopic: str
    chapters: list[ArchitectureChapter]
    structureMode: Literal["flat", "staged"] = "flat"
    stages: Optional[list[ArchitectureStage]] = None


class CourseArchitectureMeta(BaseModel):
    """第二阶段输出：基于已确定的章节补全课程目标与概念关系。"""

    thesis: CourseThesis
    conceptGraph: list[ArchitectureConcept]
    examplePolicy: CourseExamplePolicy


# ---- response_format json_schema(strict) 输出契约 ----
# 与上方 pydantic 模型一一对应（回归测试校验字段集合一致）。
# strict 约束：所有字段 required、additionalProperties: false、无 default；
# 可空字段用 type 联合（evidenceIds: ["array", "null"]）。
# 2026-11-23 已用代表性大 schema 实测网关强制约束生效（scripts/probe_strict_schema.py）。

COURSE_CHAPTERS_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "architectureVersion": {"type": "integer", "enum": [1]},
        "courseTopic": {"type": "string"},
        "structureMode": {"type": "string", "enum": ["flat", "staged"]},
        "stages": {
            "type": ["array", "null"],
            "items": {
                "type": "object",
                "properties": {
                    "stageId": {"type": "string"},
                    "title": {"type": "string"},
                    "stageGoal": {"type": "string"},
                    "chapterIds": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["stageId", "title", "stageGoal", "chapterIds"],
                "additionalProperties": False,
            },
        },
        "chapters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "chapterId": {"type": "string"},
                    "title": {"type": "string"},
                    "roleInCourse": {"type": "string"},
                    "conceptIds": {"type": "array", "items": {"type": "string"}},
                    "deliverable": {"type": "string"},
                    "prerequisites": {"type": "array", "items": {"type": "string"}},
                    "assessmentMode": {"type": "string", "enum": ["none", "self_report", "checkpoint"]},
                    "stageId": {"type": ["string", "null"]},
                },
                "required": [
                    "chapterId", "title", "roleInCourse", "conceptIds",
                    "deliverable", "prerequisites", "assessmentMode", "stageId",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["architectureVersion", "courseTopic", "chapters", "structureMode", "stages"],
    "additionalProperties": False,
}

COURSE_META_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "thesis": {
            "type": "object",
            "properties": {
                "audience": {"type": "string"},
                "currentBoundary": {"type": "array", "items": {"type": "string"}},
                "targetCapability": {"type": "string"},
                "learningDelta": {"type": "array", "items": {"type": "string"}},
                "nonGoals": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["audience", "currentBoundary", "targetCapability", "learningDelta", "nonGoals"],
            "additionalProperties": False,
        },
        "conceptGraph": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "conceptId": {"type": "string"},
                    "label": {"type": "string"},
                    "targetDepth": {"type": "string", "enum": ["skip", "refresh", "understand", "apply", "transfer"]},
                    "rationale": {"type": "string"},
                    "prerequisiteConceptIds": {"type": "array", "items": {"type": "string"}},
                    "evidenceIds": {"type": ["array", "null"], "items": {"type": "string"}},
                },
                "required": [
                    "conceptId", "label", "targetDepth", "rationale",
                    "prerequisiteConceptIds", "evidenceIds",
                ],
                "additionalProperties": False,
            },
        },
        "examplePolicy": {
            "type": "object",
            "properties": {
                "preferredDomains": {"type": "array", "items": {"type": "string"}},
                "personalExampleLimit": {"type": "integer"},
                "avoidRepeatedScenarios": {"type": "boolean"},
            },
            "required": ["preferredDomains", "personalExampleLimit", "avoidRepeatedScenarios"],
            "additionalProperties": False,
        },
    },
    "required": ["thesis", "conceptGraph", "examplePolicy"],
    "additionalProperties": False,
}


def _find_cycle(edges: dict[str, list[str]]) -> list[str] | None:
    visited: set[str] = set()
    on_path: set[str] = set()
    path: list[str] = []

    def visit(node: str) -> list[str] | None:
        if node in on_path:
            return path[path.index(node):] + [node]
        if node in visited:
            return None
        visited.add(node)
        on_path.add(node)
        path.append(node)
        for neighbor in edges.get(node, []):
            cycle = visit(neighbor)
            if cycle:
                return cycle
        on_path.remove(node)
        path.pop()
        return None

    for node in edges:
        cycle = visit(node)
        if cycle:
            return cycle
    return None


def validate_course_chapters(
    chapters: list[ArchitectureChapter],
    structureMode: str = "flat",
    stages: Optional[list[ArchitectureStage]] = None,
) -> list[str]:
    """校验第一阶段章节；概念引用等跨阶段约束留给最终合并校验。"""
    issues: list[str] = []
    if not chapters:
        issues.append("课程至少需要一个章节。")
    # 灵活章数（用户反馈#3）：章数由认知增量决定，不再强制收敛 4～7；
    # flat 平铺上限 12，staged 两层结构总章上限 18，仅防膨胀。
    cap = 18 if structureMode == "staged" else 12
    if len(chapters) > cap:
        issues.append(f"章节数量 {len(chapters)} 超过硬上限 {cap}，请合并相邻同层职责的章节。")

    chapter_ids = [chapter.chapterId for chapter in chapters]
    if len(chapter_ids) != len(set(chapter_ids)):
        issues.append("章节 ID 重复。")
    chapter_set = set(chapter_ids)

    # 两层大纲阶段校验（staged 模式）。
    if structureMode == "staged":
        if not stages:
            issues.append("staged 模式必须提供 stages（宏观阶段）。")
        else:
            stage_ids = [stage.stageId for stage in stages]
            if len(stage_ids) != len(set(stage_ids)):
                issues.append("阶段 ID 重复。")
            stage_set = set(stage_ids)
            covered: set[str] = set()
            for stage in stages:
                if not stage.title.strip() or not stage.stageGoal.strip():
                    issues.append(f"阶段 {stage.stageId} 缺少标题或阶段目标。")
                if not stage.chapterIds:
                    issues.append(f"阶段 {stage.stageId} 未包含任何章节。")
                for cid in stage.chapterIds:
                    if cid not in chapter_set:
                        issues.append(f"阶段 {stage.stageId} 引用了不存在的章节：{cid}")
                    covered.add(cid)
            for chapter in chapters:
                if chapter.stageId and chapter.stageId not in stage_set:
                    issues.append(f"章节 {chapter.chapterId} 归属了不存在的阶段：{chapter.stageId}")
                if not chapter.stageId:
                    issues.append(f"staged 模式下章节 {chapter.chapterId} 必须归属一个阶段（stageId）。")
                elif chapter.chapterId not in covered:
                    issues.append(f"章节 {chapter.chapterId} 未出现在其所属阶段的 chapterIds 中。")

    deliverables: set[str] = set()
    for chapter in chapters:
        if not chapter.title.strip() or not chapter.roleInCourse.strip() or not chapter.deliverable.strip():
            issues.append(f"章节 {chapter.chapterId} 缺少标题、职责或交付物。")
        if not chapter.conceptIds:
            issues.append(f"章节 {chapter.chapterId} 未绑定任何概念。")
        normalized_deliverable = chapter.deliverable.strip().lower()
        if normalized_deliverable and normalized_deliverable in deliverables:
            issues.append(f"章节交付物重复：{chapter.deliverable}")
        deliverables.add(normalized_deliverable)
        if _VAGUE_DELIVERABLE_RE.match(chapter.deliverable.strip()):
            issues.append(
                f"章节 {chapter.chapterId} 的交付物以空泛认知动词开头（{chapter.deliverable}），"
                "请改为可观察的交付物或行为描述，例如一份方案、一张判断清单或能独立完成的动作。"
            )
        for prerequisite in chapter.prerequisites:
            if prerequisite not in chapter_set:
                issues.append(f"章节 {chapter.chapterId} 的前置章节不存在：{prerequisite}")

    chapter_edges = {
        chapter.chapterId: chapter.prerequisites
        for chapter in chapters
    }
    chapter_cycle = _find_cycle(chapter_edges)
    if chapter_cycle:
        issues.append(f"章节依赖存在循环：{' → '.join(chapter_cycle)}")
    return issues


def validate_course_architecture(architecture: CourseArchitecture) -> list[str]:
    """校验引用、职责和依赖；语义重复由独立架构审查负责。"""
    issues = validate_course_chapters(
        architecture.chapters, architecture.structureMode, architecture.stages
    )
    if not architecture.courseTopic.strip():
        issues.append("课程主题为空。")
    if not architecture.thesis.targetCapability.strip():
        issues.append("缺少课程目标能力。")
    if not architecture.thesis.learningDelta:
        issues.append("缺少可描述的认知增量。")

    concept_ids = [concept.conceptId for concept in architecture.conceptGraph]
    if len(concept_ids) != len(set(concept_ids)):
        issues.append("概念 ID 重复。")
    concept_set = set(concept_ids)

    for concept in architecture.conceptGraph:
        for prerequisite in concept.prerequisiteConceptIds:
            if prerequisite not in concept_set:
                issues.append(f"概念 {concept.conceptId} 的前置概念不存在：{prerequisite}")

    concept_edges = {
        concept.conceptId: concept.prerequisiteConceptIds
        for concept in architecture.conceptGraph
    }
    cycle = _find_cycle(concept_edges)
    if cycle:
        issues.append(f"概念依赖存在循环：{' → '.join(cycle)}")

    referenced_concepts: set[str] = set()
    for chapter in architecture.chapters:
        for concept_id in chapter.conceptIds:
            if concept_id not in concept_set:
                issues.append(f"章节 {chapter.chapterId} 引用了不存在的概念：{concept_id}")
            referenced_concepts.add(concept_id)

    for concept in architecture.conceptGraph:
        if concept.targetDepth != "skip" and concept.conceptId not in referenced_concepts:
            issues.append(f"非跳过概念未被任何章节覆盖：{concept.conceptId}")

    if not (0 <= architecture.examplePolicy.personalExampleLimit <= 3):
        issues.append("个人经历例子上限必须在 0～3。")

    return issues
