import type { NodeLesson } from '@/types/course';

export interface NodeLessonValidationInput {
  teachConceptIds: string[];
  assessmentTargetIds: string[];
  riskConceptIds: string[];
}

export interface ValidationResult {
  passed: boolean;
  issues: string[];
}

export function validateNodeLesson(
  lesson: NodeLesson,
  input: NodeLessonValidationInput,
): ValidationResult {
  const issues: string[] = [];
  const expectedTeachConceptIds = new Set(input.teachConceptIds);
  const expectedAssessmentTargetIds = new Set(input.assessmentTargetIds);
  const cardIds = new Set(lesson.cards.map((card) => card.id));
  const coveredConceptIds = new Set<string>();
  const questionedConceptIds = new Set<string>();

  for (const card of lesson.cards) {
    if (!card.coveredConceptIds.length) {
      issues.push(`卡片 ${card.id} 缺少 coveredConceptIds，无法判断概念覆盖。`);
      continue;
    }

    for (const conceptId of card.coveredConceptIds) {
      coveredConceptIds.add(conceptId);
      if (!expectedTeachConceptIds.has(conceptId)) {
        issues.push(`卡片 ${card.id} 的 coveredConceptIds 包含未声明的 teachConceptId：${conceptId}`);
      }
    }
  }

  for (const conceptId of expectedTeachConceptIds) {
    if (!lesson.teachConceptIds.includes(conceptId)) {
      issues.push(`NodeLesson teachConceptIds 缺少预期概念：${conceptId}`);
    }

    if (!coveredConceptIds.has(conceptId)) {
      issues.push(`teachConceptIds 中的概念未被任何卡片 coveredConceptIds 覆盖：${conceptId}`);
    }
  }

  for (const question of lesson.questions) {
    questionedConceptIds.add(question.targetConceptId);

    if (!expectedAssessmentTargetIds.has(question.targetConceptId)) {
      issues.push(`题目 ${question.id} 的 targetConceptId 不在 assessmentTargetIds 内：${question.targetConceptId}`);
    }

    if (question.cardId && !cardIds.has(question.cardId)) {
      issues.push(`题目 ${question.id} 绑定了不存在的 cardId：${question.cardId}`);
    }
  }

  for (const conceptId of expectedAssessmentTargetIds) {
    if (!lesson.assessmentTargetIds.includes(conceptId)) {
      issues.push(`NodeLesson assessmentTargetIds 缺少预期概念：${conceptId}`);
    }
  }

  for (const conceptId of input.riskConceptIds) {
    if (expectedAssessmentTargetIds.has(conceptId) && !questionedConceptIds.has(conceptId)) {
      issues.push(`高风险概念缺少题目命中：${conceptId}`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}
