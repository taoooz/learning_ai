import type { CourseBlueprint } from '@/types/course';
import { getNodeAssessmentTargetIds, getNodePersonalizationHooks } from '@/lib/course-blueprint';

const GENERIC_TITLE_PATTERNS = [
  /^入门篇$/,
  /^基础篇$/,
  /^进阶篇$/,
  /^提高篇$/,
  /^补充内容$/,
  /^补充$/,
  /^总结篇$/,
];

export interface CourseBlueprintValidationInput {
  mustCoverConceptIds: string[];
  riskConceptIds: string[];
}

export interface ValidationResult {
  passed: boolean;
  issues: string[];
}

export function validateCourseBlueprint(
  blueprint: CourseBlueprint,
  input: CourseBlueprintValidationInput,
): ValidationResult {
  const issues: string[] = [];
  const globalConceptIds = new Set(blueprint.globalConcepts.map((item) => item.id));
  const introducedConceptIds = new Set(blueprint.coverage?.introducedConceptIds || []);
  const remediatedConceptIds = new Set(blueprint.coverage?.remediatedConceptIds || []);
  const seenTeachConceptIds = new Set<string>();

  for (const node of blueprint.nodes) {
    if (!node.teachConceptIds.length) {
      issues.push(`节点 ${node.index} 缺少 teachConceptIds，无法建立可教学结构。`);
    }

    if (GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(node.title.trim()))) {
      issues.push(`节点 ${node.index} 使用空泛标题：${node.title}`);
    }

    for (const conceptId of node.teachConceptIds) {
      seenTeachConceptIds.add(conceptId);
      introducedConceptIds.add(conceptId);
      if (!globalConceptIds.has(conceptId)) {
        issues.push(`节点 ${node.index} 的 teachConceptIds 包含未声明的概念：${conceptId}`);
      }
    }

    for (const conceptId of getNodeAssessmentTargetIds(node)) {
      if (!globalConceptIds.has(conceptId)) {
        issues.push(`节点 ${node.index} 的 assessmentTargetIds 包含未声明的概念：${conceptId}`);
      }
    }

    for (const prerequisiteConceptId of node.prerequisiteConceptIds) {
      if (!seenTeachConceptIds.has(prerequisiteConceptId)) {
        issues.push(`节点 ${node.index} 的 prerequisiteConceptIds 引用了尚未在前序节点出现的概念：${prerequisiteConceptId}`);
      }
    }
  }

  for (const conceptId of input.mustCoverConceptIds) {
    if (!introducedConceptIds.has(conceptId) && !seenTeachConceptIds.has(conceptId)) {
      issues.push(`mustCoverConceptIds 中的概念未被课程覆盖：${conceptId}`);
    }
  }

  for (const conceptId of input.riskConceptIds) {
    const remediatedByNode = blueprint.nodes.some((node) => getNodePersonalizationHooks(node).mustRemediateConceptIds.includes(conceptId));
    if (!remediatedConceptIds.has(conceptId) && !remediatedByNode) {
      const taughtByNode = blueprint.nodes.some((node) => node.teachConceptIds.includes(conceptId));
      if (!taughtByNode) {
        issues.push(`riskConceptIds 中的概念没有被课程触达：${conceptId}`);
      }
    }
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}
