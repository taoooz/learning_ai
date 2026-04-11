// lib/storage.ts
import {
  createStoredCourseBundleFromBlueprint,
  deriveCourseTreeFromStoredCourseBundle,
  deriveCourseTreeViewFromBlueprint,
  normalizeCourseBlueprint,
} from '@/lib/course-blueprint';
import type {
  CourseBlueprint,
  CourseTree,
  NodeLesson,
  StoredCourseBundle,
  StoredData,
  StoredDataV2,
  StoredRecommendation,
  UserProfile,
} from '../types/course';
import { cloneStoredCourseBundle, SYSTEM_COURSE_LIBRARY } from '@/lib/data/system-courses';

export { getSystemCourseRecommendations } from '@/lib/data/system-courses';
export type { SystemCourseRecommendation } from '@/lib/data/system-courses';

const STORAGE_KEY_PREFIX = 'ai-learning-data-v2';
const LEGACY_STORAGE_KEYS = ['ai-learning-data', 'userMemory', 'userMemoryV2'] as const;
const AUTH_STORAGE_KEY = 'ai-learning-auth';

// 获取当前用户邀请码（从 localStorage）
export function getCurrentUserInviteCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const { inviteCode } = JSON.parse(stored);
      return inviteCode || null;
    }
  } catch {}
  return null;
}

// 获取当前用户的存储 key
function getUserStorageKey(): string {
  const inviteCode = getCurrentUserInviteCode();
  return inviteCode ? `${STORAGE_KEY_PREFIX}:${inviteCode}` : STORAGE_KEY_PREFIX;
}

const defaultDataV2: StoredDataV2 = {
  courses: [],
  currentCourseId: null,
  courseProgress: {},
  userProfile: null,
  recommendations: [],
};

type StorageCleaner = Pick<Storage, 'removeItem'>;

export function clearLegacyLearningData(storage?: StorageCleaner | null): void {
  const target = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!target) return;
  for (const key of LEGACY_STORAGE_KEYS) {
    target.removeItem(key);
  }
}

function hydrateStoredData(data: StoredDataV2): StoredData {
  return {
    courses: data.courses.map((course) => deriveCourseTreeFromStoredCourseBundle(course)),
    currentCourseId: data.currentCourseId,
    courseProgress: data.courseProgress,
    userProfile: data.userProfile,
  };
}

export function getStoredDataV2(): StoredDataV2 {
  if (typeof window === 'undefined') return defaultDataV2;
  const userKey = getUserStorageKey();
  try {
    const raw = localStorage.getItem(userKey);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredDataV2;
      return {
        ...defaultDataV2,
        ...parsed,
        courses: Array.isArray(parsed.courses) ? parsed.courses : [],
        courseProgress: parsed.courseProgress || {},
      };
    }
    const inviteCode = getCurrentUserInviteCode();
    if (inviteCode) {
      const legacyRaw = localStorage.getItem(STORAGE_KEY_PREFIX);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw) as StoredDataV2;
        const migrated: StoredDataV2 = {
          ...defaultDataV2,
          ...parsed,
          courses: Array.isArray(parsed.courses) ? parsed.courses : [],
          courseProgress: parsed.courseProgress || {},
        };
        localStorage.setItem(userKey, JSON.stringify(migrated));
        return migrated;
      }
    }
    return defaultDataV2;
  } catch {
    return defaultDataV2;
  }
}

export function getStoredData(): StoredData {
  return hydrateStoredData(getStoredDataV2());
}

export function saveStoredDataV2(data: StoredDataV2): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getUserStorageKey(), JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save stored data:', error);
  }
}

export function saveStoredData(data: StoredData): void {
  if (typeof window === 'undefined') return;
  const current = getStoredDataV2();
  const next: StoredDataV2 = {
    courses: data.courses.map((course) => {
      const existing = current.courses.find((item) => item.blueprint.courseId === course.courseId);
      if (existing) {
        return {
          ...existing,
          treeView: {
            ...existing.treeView,
            totalNodes: course.totalNodes,
            nodes: course.nodes.map((node) => ({
              index: node.index,
              title: node.title,
              status: node.status,
            })),
          },
        };
      }
      const blueprint: CourseBlueprint = {
        courseId: course.courseId,
        topic: course.topic,
        learnerPositioning: {
          estimatedLevel: 'beginner',
        },
        courseGoal: course.topic,
        globalConcepts: [],
        nodes: course.nodes.map((node) => ({
          index: node.index,
          title: node.title,
          teachingGoal: node.title,
          teachConceptIds: [],
          prerequisiteConceptIds: [],
          assessmentTargetIds: [],
          bridgeFromPreviousNode: node.index === 0 ? '无' : `承接 ${course.nodes[node.index - 1]?.title || '上一节'}`,
          personalizationHooks: {
            mustRemediateConceptIds: [],
            canCompressKnownConceptIds: [],
            analogyFactIds: [],
          },
          status: node.status,
        })),
        coverage: {
          introducedConceptIds: [],
          assessedConceptIds: [],
          remediatedConceptIds: [],
        },
        generationNotes: {
          compressedKnownConceptIds: [],
          emphasizedRiskConceptIds: [],
          selectedAnalogyFactIds: [],
        },
      };
      const bundle = createStoredCourseBundleFromBlueprint(blueprint);
      for (const node of course.nodes) {
        if (!node.cards || !node.questions) continue;
        bundle.lessons[node.index] = {
          courseId: course.courseId,
          nodeIndex: node.index,
          title: node.title,
          teachingGoal: node.title,
          teachConceptIds: [],
          assessmentTargetIds: [],
          cards: node.cards.map((card) => ({ ...card, coveredConceptIds: [] })),
          questions: node.questions.map((question) => ({
            ...question,
            targetConceptId: question.targetConceptId || question.concept || '',
          })),
        };
      }
      return bundle;
    }),
    currentCourseId: data.currentCourseId,
    courseProgress: data.courseProgress,
    userProfile: data.userProfile,
    recommendations: current.recommendations || [],
  };
  saveStoredDataV2(next);
}

export function addCourseBundle(bundle: StoredCourseBundle): void {
  const data = getStoredDataV2();
  data.courses = [...data.courses.filter((course) => course.blueprint.courseId !== bundle.blueprint.courseId), bundle];
  data.currentCourseId = bundle.blueprint.courseId;
  saveStoredDataV2(data);
}

export function activateSystemCourse(courseId: string): CourseTree | null {
  const match = SYSTEM_COURSE_LIBRARY.find((item) => item.recommendation.courseId === courseId);
  if (!match) return null;

  const bundle = cloneStoredCourseBundle(match.bundle);
  addCourseBundle(bundle);
  return deriveCourseTreeFromStoredCourseBundle(bundle);
}

export function getCurrentCourse(): CourseTree | null {
  const data = getStoredData();
  if (!data.currentCourseId) return null;
  return data.courses.find(c => c.courseId === data.currentCourseId) || null;
}

export function getStoredCourseBundle(courseId: string): StoredCourseBundle | null {
  const data = getStoredDataV2();
  return data.courses.find((course) => course.blueprint.courseId === courseId) || null;
}

export function updateNodeLesson(courseId: string, nodeIndex: number, lesson: NodeLesson): void {
  const data = getStoredDataV2();
  const course = data.courses.find((item) => item.blueprint.courseId === courseId);
  if (!course) return;

  course.lessons[nodeIndex] = lesson;
  saveStoredDataV2(data);
}

export function markNodeCompleted(courseId: string, nodeIndex: number): void {
  const data = getStoredDataV2();
  if (!data.courseProgress[courseId]) {
    data.courseProgress[courseId] = {};
  }
  data.courseProgress[courseId][nodeIndex] = 'completed';

  const course = data.courses.find((item) => item.blueprint.courseId === courseId);
  if (course && course.treeView.nodes[nodeIndex] && course.blueprint.nodes[nodeIndex]) {
    course.treeView.nodes[nodeIndex].status = 'completed';
    course.blueprint.nodes[nodeIndex].status = 'completed';

    // 解锁下一个节点
    if (nodeIndex + 1 < course.treeView.nodes.length && course.treeView.nodes[nodeIndex + 1].status === 'locked') {
      course.treeView.nodes[nodeIndex + 1].status = 'available';
      course.blueprint.nodes[nodeIndex + 1].status = 'available';
    }
  }

  saveStoredDataV2(data);
}

export function getNodeProgress(courseId: string, nodeIndex: number): 'completed' | 'in_progress' | null {
  const data = getStoredData();
  return data.courseProgress[courseId]?.[nodeIndex] || null;
}

export function getUserProfile(): UserProfile | null {
  const data = getStoredDataV2();
  return data.userProfile;
}

export function saveUserProfile(profile: UserProfile): void {
  const data = getStoredDataV2();
  data.userProfile = profile;
  saveStoredDataV2(data);
}

export function deleteCourse(courseId: string): void {
  const data = getStoredDataV2();
  data.courses = data.courses.filter((course) => course.blueprint.courseId !== courseId);
  delete data.courseProgress[courseId];
  if (data.currentCourseId === courseId) {
    data.currentCourseId = data.courses.length > 0 ? data.courses[0].blueprint.courseId : null;
  }
  saveStoredDataV2(data);
}

export function saveCourseBlueprint(blueprint: CourseBlueprint): void {
  const data = getStoredDataV2();
  const normalizedBlueprint = normalizeCourseBlueprint(blueprint);
  const existing = data.courses.find((course) => course.blueprint.courseId === normalizedBlueprint.courseId);
  const treeView = deriveCourseTreeViewFromBlueprint(normalizedBlueprint);

  if (existing) {
    existing.blueprint = normalizedBlueprint;
    existing.treeView = treeView;
  } else {
    data.courses.push(createStoredCourseBundleFromBlueprint(normalizedBlueprint));
  }

  data.currentCourseId = normalizedBlueprint.courseId;
  saveStoredDataV2(data);
}

export function getRecommendations(): StoredRecommendation[] {
  const data = getStoredDataV2();
  return data.recommendations || [];
}

export function saveRecommendations(recommendations: Omit<StoredRecommendation, 'createdAt'>[]): void {
  const data = getStoredDataV2();
  data.recommendations = recommendations.map((r) => ({
    ...r,
    createdAt: Date.now(),
  }));
  saveStoredDataV2(data);
}
