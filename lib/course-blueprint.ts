import type { CourseBlueprint, CourseBlueprintNode, CourseTree, CourseTreeView, StoredCourseBundle } from '@/types/course';

function normalizeConceptLookupValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, '');
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
    difficultySummary: blueprint.learnerPositioning.difficultySummary,
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
    difficultySummary: bundle.treeView.difficultySummary,
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
    if (normalizeConceptLookupValue(concept.id) === lookup) return concept.id;
    if (normalizeConceptLookupValue(concept.name) === lookup) return concept.id;
    if (concept.aliases.some((alias) => normalizeConceptLookupValue(alias) === lookup)) {
      return concept.id;
    }
  }

  return createConceptIdFromName(rawConcept);
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

  const nodes = blueprint.nodes.map((node) => {
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
