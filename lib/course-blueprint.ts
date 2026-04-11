import type { CourseBlueprint, CourseBlueprintNode, CourseTree, CourseTreeView, StoredCourseBundle } from '@/types/course';

// 统一规范化：移除空格和非字母数字字符，保留中文字符
function normalizeConceptLookupValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

// 概念 ID 规范化：统一处理，移除空格和分隔符，确保与 lookup 结果一致
function normalizeConceptId(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

export function createConceptIdFromName(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return normalized.startsWith('concept-') ? normalized : `concept-${normalized || 'untitled'}`;
}

export function deriveCourseTreeViewFromBlueprint(blueprint: CourseBlueprint): CourseTreeView {
  return {
    courseId: blueprint.courseId,
    topic: blueprint.topic,
    courseGoal: blueprint.courseGoal,
    totalNodes: blueprint.nodes.length,
    nodes: blueprint.nodes.map((node) => ({
      index: node.index,
      title: node.title,
      status: node.status,
    })),
  };
}

export function createStoredCourseBundleFromBlueprint(blueprint: CourseBlueprint): StoredCourseBundle {
  return {
    blueprint: normalizeCourseBlueprint(blueprint),
    treeView: deriveCourseTreeViewFromBlueprint(normalizeCourseBlueprint(blueprint)),
    lessons: {},
  };
}

export function deriveCourseTreeFromStoredCourseBundle(bundle: StoredCourseBundle): CourseTree {
  return {
    courseId: bundle.treeView.courseId,
    topic: bundle.treeView.topic,
    courseGoal: bundle.treeView.courseGoal,
    totalNodes: bundle.treeView.totalNodes,
    nodes: bundle.treeView.nodes.map((node) => {
      const lesson = bundle.lessons[node.index];
      return {
        index: node.index,
        title: node.title,
        status: node.status,
        cards: lesson?.cards,
        questions: lesson?.questions,
      };
    }),
  };
}

export function resolveConceptIdFromBlueprint(blueprint: CourseBlueprint, rawConcept: string): string {
  const lookup = normalizeConceptLookupValue(rawConcept);
  for (const concept of blueprint.globalConcepts) {
    // 概念 ID 匹配：移除分隔符后比较
    if (normalizeConceptId(concept.id) === lookup) return concept.id;
    // 概念名称匹配
    if (normalizeConceptLookupValue(concept.name) === lookup) return concept.id;
    // 别名匹配
    if (concept.aliases.some((alias) => normalizeConceptLookupValue(alias) === lookup)) {
      return concept.id;
    }
  }

  // Fallback：基于标准化后的名称生成 ID，确保与查询逻辑一致
  return `concept-${lookup}`;
}

export function resolveConceptNameFromBlueprint(blueprint: CourseBlueprint, conceptId: string): string {
  return blueprint.globalConcepts.find((concept) => concept.id === conceptId)?.name || conceptId;
}

export function getNodeAssessmentTargetIds(node: CourseBlueprintNode): string[] {
  return node.assessmentTargetIds?.length ? node.assessmentTargetIds : node.teachConceptIds;
}

export function getNodePersonalizationHooks(node: CourseBlueprintNode): NonNullable<CourseBlueprintNode['personalizationHooks']> {
  return {
    mustRemediateConceptIds: node.personalizationHooks?.mustRemediateConceptIds || [],
    canCompressKnownConceptIds: node.personalizationHooks?.canCompressKnownConceptIds || [],
    analogyFactIds: node.personalizationHooks?.analogyFactIds || [],
  };
}

export function normalizeCourseBlueprint(blueprint: CourseBlueprint): CourseBlueprint {
  const introducedConceptIds = new Set<string>();
  const assessedConceptIds = new Set<string>();
  const remediatedConceptIds = new Set<string>();

  const nodes = blueprint.nodes.map((node, normalizedIndex) => {
    const assessmentTargetIds = getNodeAssessmentTargetIds(node);
    const personalizationHooks = getNodePersonalizationHooks(node);

    for (const conceptId of node.teachConceptIds) {
      introducedConceptIds.add(conceptId);
    }
    for (const conceptId of assessmentTargetIds) {
      assessedConceptIds.add(conceptId);
    }
    for (const conceptId of personalizationHooks.mustRemediateConceptIds) {
      remediatedConceptIds.add(conceptId);
    }

    return {
      ...node,
      index: normalizedIndex,
      assessmentTargetIds,
      personalizationHooks,
    };
  });

  return {
    ...blueprint,
    nodes,
    coverage: blueprint.coverage || {
      introducedConceptIds: Array.from(introducedConceptIds),
      assessedConceptIds: Array.from(assessedConceptIds),
      remediatedConceptIds: Array.from(remediatedConceptIds),
    },
    generationNotes: blueprint.generationNotes || {
      compressedKnownConceptIds: [],
      emphasizedRiskConceptIds: Array.from(remediatedConceptIds),
      selectedAnalogyFactIds: [],
    },
  };
}
