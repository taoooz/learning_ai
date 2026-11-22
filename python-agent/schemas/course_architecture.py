"""Course Architect 的结构化输出与确定性校验。"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


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


class CourseChapterPlan(BaseModel):
    """第一阶段输出：只生成可先展示的章节目录。"""

    architectureVersion: Literal[1] = 1
    courseTopic: str
    chapters: list[ArchitectureChapter]


class CourseArchitectureMeta(BaseModel):
    """第二阶段输出：基于已确定的章节补全课程目标与概念关系。"""

    thesis: CourseThesis
    conceptGraph: list[ArchitectureConcept]
    examplePolicy: CourseExamplePolicy


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


def validate_course_chapters(chapters: list[ArchitectureChapter]) -> list[str]:
    """校验第一阶段章节；概念引用等跨阶段约束留给最终合并校验。"""
    issues: list[str] = []
    if not chapters:
        issues.append("课程至少需要一个章节。")
    if len(chapters) > 8:
        issues.append(f"章节数量 {len(chapters)} 过多，应合并相邻同层职责，优先收敛到 4～7 章。")

    chapter_ids = [chapter.chapterId for chapter in chapters]
    if len(chapter_ids) != len(set(chapter_ids)):
        issues.append("章节 ID 重复。")
    chapter_set = set(chapter_ids)

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
    issues = validate_course_chapters(architecture.chapters)
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
