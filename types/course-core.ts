// types/course-core.ts — 课程结构、蓝图、存储相关类型

import type { LearningCard, Question, NodeLessonCard, NodeLessonQuestion } from './learning-content';
import type { UserProfile, StoredRecommendation } from './user-profile';

export interface CourseNode {
  index: number;
  title: string;
  status: 'locked' | 'available' | 'completed';
  cards?: LearningCard[];
  questions?: Question[];
}

// API 返回的课程响应类型
export interface CourseTreeResponse {
  courseId: string;
  topic: string;
  totalNodes: number;
  nodes: Array<{
    index: number;
    title: string;
    status: 'locked' | 'available';
  }>;
}

export interface CourseTree {
  courseId: string;
  topic: string;
  courseGoal: string;
  totalNodes: number;
  nodes: CourseNode[];
}

export interface CanonicalConcept {
  id: string;
  name: string;
  aliases: string[];
}

export interface CourseBlueprintNode {
  index: number;
  title: string;
  teachingGoal: string;
  frame?: string;
  teachConceptIds: string[];
  prerequisiteConceptIds: string[];
  assessmentTargetIds?: string[];
  bridgeFromPreviousNode: string;
  personalizationHooks?: {
    mustRemediateConceptIds: string[];
    canCompressKnownConceptIds: string[];
    analogyFactIds: string[];
  };
  status: 'locked' | 'available' | 'completed';
}

export interface CourseBlueprint {
  courseId: string;
  topic: string;
  learnerPositioning: {
    estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced' | '初级' | '中级' | '高级';
    backgroundSummary?: string;
    skipBasics?: string[];
  };
  courseGoal: string;
  globalConcepts: CanonicalConcept[];
  nodes: CourseBlueprintNode[];
  coverage?: {
    introducedConceptIds: string[];
    assessedConceptIds: string[];
    remediatedConceptIds: string[];
  };
  generationNotes?: {
    compressedKnownConceptIds: string[];
    emphasizedRiskConceptIds: string[];
    selectedAnalogyFactIds: string[];
  };
}

export interface CourseTreeView {
  courseId: string;
  topic: string;
  courseGoal: string;
  totalNodes: number;
  nodes: Array<{
    index: number;
    title: string;
    status: 'locked' | 'available' | 'completed';
  }>;
}

export interface NodeLesson {
  courseId: string;
  nodeIndex: number;
  title: string;
  teachingGoal: string;
  teachConceptIds: string[];
  assessmentTargetIds: string[];
  cards: NodeLessonCard[];
  questions: NodeLessonQuestion[];
  validatorSummary?: {
    passed: boolean;
    issues: string[];
  };
}

export interface StoredCourseBundle {
  blueprint: CourseBlueprint;
  treeView: CourseTreeView;
  lessons: Record<number, NodeLesson>;
}

export interface CourseProgress {
  [courseId: string]: {
    [nodeIndex: number]: 'completed' | 'in_progress';
  };
}

export interface StoredData {
  courses: CourseTree[];
  currentCourseId: string | null;
  courseProgress: CourseProgress;
  userProfile: UserProfile | null;
}

export interface StoredDataV2 {
  courses: StoredCourseBundle[];
  currentCourseId: string | null;
  courseProgress: CourseProgress;
  userProfile: UserProfile | null;
  recommendations: StoredRecommendation[];
}

export type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';
