'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { CourseTree, GenerationStatus, NodeLesson, StoredCourseBundle, OutlineLearnerPositioning, LearningCard, Question } from '@/types/course';
import {
  getStoredData,
  getSystemCourseRecommendations,
  SystemCourseRecommendation,
} from '@/lib/storage';
import { useCourseActions } from '@/hooks/useCourseActions';

interface CourseContextType {
  courses: CourseTree[];
  currentCourse: CourseTree | null;
  isHydrated: boolean;
  generationStatus: GenerationStatus;
  generationError: string | null;
  systemCourseRecommendations: SystemCourseRecommendation[];
  startSystemCourse: (courseId: string) => void;
  generateNodeContent: (courseId: string, nodeIndex: number) => Promise<void>;
  preloadNextNode: (courseId: string, currentNodeIndex: number) => void;
  updateNodeContent: (courseId: string, nodeIndex: number, lesson: NodeLesson) => void;
  updateNodeQuestions: (courseId: string, nodeIndex: number, questions: NodeLesson['questions']) => void;
  deleteCourse: (courseId: string) => void;
  addCourse: (bundle: StoredCourseBundle) => void;
  submitOutlineMessage: (topic: string, userMessage?: string) => Promise<Response>;
  generateToc: (outline: {
    topic: string;
    learningDirection: string;
    learningGoal: string;
    learnerPositioning: OutlineLearnerPositioning;
  }) => Promise<{
    courseName: string;
    courseDescription: string;
    nodes: Array<{ index: number; title: string; teachingGoal: string; description: string }>;
  }>;
  generateNodeCards: (
    courseId: string,
    nodeIndex: number,
    options: {
      learnerBackground: { backgroundSummary: string; skipBasics: string[] };
      prevNodeSummary?: { title: string; concepts: string[] };
      nextNodeSummary?: { title: string; concepts: string[] };
    }
  ) => Promise<{
    cards: NodeLesson['cards'];
  }>;
  generateNodeQuestions: (courseId: string, nodeIndex: number) => Promise<{
    questions: NodeLesson['questions'];
  }>;
}

const CourseContext = createContext<CourseContextType | null>(null);

export function shouldEnterLearningPhase(node?: { cards?: Array<unknown>; questions?: Array<unknown> }): boolean {
  return Array.isArray(node?.cards) && node.cards.length > 0;
}

export function hasResolvedQuestions(node?: { questions?: Array<unknown> }): boolean {
  // 必须有非空数组才视为已生成，空数组视为未生成（可重试）
  return Array.isArray(node?.questions) && node.questions.length > 0;
}

export function buildLearningSteps(cards?: LearningCard[], questions?: Question[]) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return [];
  }

  return [
    ...cards.map((card) => ({
      id: `card-${card.id}`,
      type: 'card' as const,
      card,
    })),
    ...(questions ?? []).map((question) => ({
      id: `question-${question.id}`,
      type: 'question' as const,
      question,
    })),
  ];
}

export function getPendingNextNodeIndex(
  nodes: Array<{ cards?: Array<unknown> }>,
  currentNodeIndex: number,
): number | null {
  const nextIndex = currentNodeIndex + 1;
  if (nextIndex >= nodes.length) {
    return null;
  }

  return Array.isArray(nodes[nextIndex]?.cards) && nodes[nextIndex].cards.length > 0
    ? null
    : nextIndex;
}

export function buildNodeContentPatch(input: {
  courseId: string;
  nodeIndex: number;
  cards: NodeLesson['cards'];
  questions?: NodeLesson['questions'];
}): Pick<NodeLesson, 'courseId' | 'nodeIndex' | 'cards' | 'questions'> {
  return {
    courseId: input.courseId,
    nodeIndex: input.nodeIndex,
    cards: input.cards,
    questions: input.questions ?? [],
  };
}

export function buildNodeInfoPayload(bundle: StoredCourseBundle, nodeIndex: number) {
  const node = bundle.blueprint.nodes[nodeIndex];
  const prevNode = nodeIndex > 0 ? bundle.blueprint.nodes[nodeIndex - 1] : undefined;
  const nextNode = nodeIndex < bundle.blueprint.nodes.length - 1 ? bundle.blueprint.nodes[nodeIndex + 1] : undefined;
  const learnerPositioning = bundle.blueprint.learnerPositioning as typeof bundle.blueprint.learnerPositioning & {
    backgroundSummary?: string;
  };

  return {
    title: node.title,
    teachingGoal: node.teachingGoal,
    teachConceptIds: node.teachConceptIds || [],
    prerequisiteConceptIds: node.prerequisiteConceptIds || [],
    courseName: bundle.blueprint.topic,
    courseDescription: bundle.blueprint.courseGoal,
    estimatedLevel: bundle.blueprint.learnerPositioning.estimatedLevel,
    backgroundSummary: learnerPositioning.backgroundSummary,
    frame: node.frame,
    prevNode: prevNode ? { title: prevNode.title, concepts: prevNode.teachConceptIds || [] } : undefined,
    nextNode: nextNode ? { title: nextNode.title, concepts: nextNode.teachConceptIds || [] } : undefined,
    skipBasics: bundle.blueprint.learnerPositioning.skipBasics || [],
  };
}

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [courses, setCourses] = useState<CourseTree[]>([]);
  const [currentCourse, setCurrentCourse] = useState<CourseTree | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [systemCourseRecommendations] = useState<SystemCourseRecommendation[]>(() => getSystemCourseRecommendations());

  // 使用 ref 来跟踪最新的 courses，避免依赖变化
  const coursesRef = useRef<CourseTree[]>([]);
  useEffect(() => {
    coursesRef.current = courses;
  }, [courses]);

  // 从 localStorage 恢复
  useEffect(() => {
    const data = getStoredData();
    setCourses(data.courses);
    if (data.currentCourseId) {
      setCurrentCourse(data.courses.find(c => c.courseId === data.currentCourseId) || null);
    }
    // 水合完成标记：页面据此区分"还在加载"和"确实没有数据"，避免无限 loading
    setIsHydrated(true);

    // 监听节点完成事件，刷新课程数据
    const handleNodeCompleted = () => {
      const data = getStoredData();
      setCourses(data.courses);
      if (data.currentCourseId) {
        setCurrentCourse(data.courses.find(c => c.courseId === data.currentCourseId) || null);
      }
    };

    window.addEventListener('node-completed', handleNodeCompleted);
    return () => window.removeEventListener('node-completed', handleNodeCompleted);
  }, []);

  const actions = useCourseActions({
    coursesRef,
    setCourses,
    setCurrentCourse,
    setGenerationStatus,
    setGenerationError,
  });

  return (
    <CourseContext.Provider value={{
      courses,
      currentCourse,
      isHydrated,
      generationStatus,
      generationError,
      systemCourseRecommendations,
      ...actions,
    }}>
      {children}
    </CourseContext.Provider>
  );
}

export function useCourse() {
  const context = useContext(CourseContext);
  if (!context) throw new Error('useCourse must be used within CourseProvider');
  return context;
}
