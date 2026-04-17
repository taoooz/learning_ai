import { createStoredCourseBundleFromBlueprint, deriveCourseTreeViewFromBlueprint } from '@/lib/course-blueprint';
import type { CourseBlueprint, CourseBlueprintNode, NodeLesson, StoredCourseBundle } from '@/types/course';
import aiCourseJson from '@/data/system-courses/generated/system-ai-for-everyone.json';
import financeCourseJson from '@/data/system-courses/generated/system-personal-finance.json';

export interface SystemCourseRecommendation {
  courseId: string;
  title: string;
  summary: string;
  badge: string;
  cta: string;
}

export function cloneStoredCourseBundle(bundle: StoredCourseBundle): StoredCourseBundle {
  return JSON.parse(JSON.stringify(bundle)) as StoredCourseBundle;
}

// 推荐元数据（来自 catalog.ts，可直接内联避免 import data/ 目录）
const RECOMMENDATIONS: SystemCourseRecommendation[] = [
  {
    courseId: 'system-ai-for-everyone',
    title: 'AI 实战进阶课',
    summary: '面向已有 AI 使用基础的用户，深入理解大模型工作原理、提示词工程与 Agent 开发，理论与实战结合。',
    badge: '系统推荐',
    cta: '从第一节开始',
  },
  {
    courseId: 'system-personal-finance',
    title: '实战投资进阶课',
    summary: '面向有基础理财认知的用户，深入学习资产配置、基金投资、风险管理与投资心理，理论实战结合。',
    badge: '系统推荐',
    cta: '开始这门课',
  },
];

// 从 JSON lessons 构建 CourseBlueprint
function buildBlueprintFromLessons(
  courseId: string,
  topic: string,
  lessons: Record<string, NodeLesson>,
): CourseBlueprint {
  const lessonList = Object.values(lessons).sort((a, b) => a.nodeIndex - b.nodeIndex);

  // 收集所有 teachConceptIds 作为 globalConcepts
  const conceptIdSet = new Set<string>();
  for (const lesson of lessonList) {
    for (const id of lesson.teachConceptIds) {
      if (id) conceptIdSet.add(id);
    }
  }

  const globalConcepts = Array.from(conceptIdSet).map((id) => ({
    id,
    name: id.replace(/^concept-/, '').replace(/-/g, ' '),
    aliases: [],
  }));

  const nodes: CourseBlueprintNode[] = lessonList.map((lesson, i) => {
    const prevLesson = i > 0 ? lessonList[i - 1] : null;
    const prevConceptIds = prevLesson?.teachConceptIds || [];
    return {
      index: lesson.nodeIndex,
      title: lesson.title,
      teachingGoal: lesson.teachingGoal,
      teachConceptIds: lesson.teachConceptIds.filter(Boolean),
      prerequisiteConceptIds: prevConceptIds.filter((id) => lesson.teachConceptIds.every((t) => t !== id)),
      assessmentTargetIds: lesson.assessmentTargetIds?.length ? lesson.assessmentTargetIds : lesson.teachConceptIds,
      bridgeFromPreviousNode: prevLesson ? `在前一节基础上，继续深入学习${lesson.title}。` : `从零开始学习${lesson.title}。`,
      personalizationHooks: { mustRemediateConceptIds: [], canCompressKnownConceptIds: [], analogyFactIds: [] },
      status: i === 0 ? 'available' : 'locked',
    };
  });

  return {
    courseId,
    topic,
    learnerPositioning: { estimatedLevel: 'beginner' },
    courseGoal: lessonList[0]?.teachingGoal || '',
    globalConcepts,
    nodes,
  };
}

// 用详细 JSON 内容构建 bundle
function buildBundleFromJson(
  courseId: string,
  json: { courseId: string; title: string; lessons: Record<string, NodeLesson> },
): StoredCourseBundle {
  const blueprint = buildBlueprintFromLessons(courseId, json.title, json.lessons);
  return createStoredCourseBundleFromBlueprint(blueprint);
}

// system-ai-for-everyone：从详细 JSON
const AI_COURSE_BUNDLE = buildBundleFromJson('system-ai-for-everyone', aiCourseJson as unknown as Parameters<typeof buildBundleFromJson>[1]);

// system-personal-finance：从详细 JSON
const FINANCE_COURSE_BUNDLE = buildBundleFromJson('system-personal-finance', financeCourseJson as unknown as Parameters<typeof buildBundleFromJson>[1]);

export const SYSTEM_COURSE_LIBRARY: Array<{ recommendation: SystemCourseRecommendation; bundle: StoredCourseBundle }> = [
  {
    recommendation: RECOMMENDATIONS[0],
    bundle: cloneStoredCourseBundle(AI_COURSE_BUNDLE),
  },
  {
    recommendation: RECOMMENDATIONS[1],
    bundle: cloneStoredCourseBundle(FINANCE_COURSE_BUNDLE),
  },
];

export function getSystemCourseRecommendations(): SystemCourseRecommendation[] {
  return SYSTEM_COURSE_LIBRARY.map((item) => ({ ...item.recommendation }));
}
