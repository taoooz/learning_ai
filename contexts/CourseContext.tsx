'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CourseTree, GenerationStatus, NodeLesson, StoredCourseBundle, OutlineLearnerPositioning, LearningCard, Question } from '@/types/course';
import {
  activateSystemCourse,
  addCourseBundle,
  deleteCourse as deleteCourseFromStorage,
  getStoredCourseBundle,
  getStoredData,
  getSystemCourseRecommendations,
  getUserProfile,
  SystemCourseRecommendation,
  updateNodeLesson as saveNodeLesson,
} from '@/lib/storage';
import { getUserMemoryStoreSnapshot } from '@/lib/memory';

interface CourseContextType {
  courses: CourseTree[];
  currentCourse: CourseTree | null;
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

function getGenerationErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
    return data.error;
  }

  return fallback;
}

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

  const submitOutlineMessage = useCallback(async (topic: string, userMessage?: string) => {
    setGenerationStatus('generating');
    setGenerationError(null);

    // 只有回答澄清问题时才传 sessionId，首次生成不传（避免 sessionStorage 脏数据走错分支）
    const sessionId = userMessage ? sessionStorage.getItem('outlineSessionId') : undefined;

    const response = await fetch('/api/agents/outline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        userProfile: getUserProfile(),
        userMemory: getUserMemoryStoreSnapshot(),
        userMessage,
        sessionId,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setGenerationError(getGenerationErrorMessage(data, '大纲生成失败，请稍后再试。'));
      setGenerationStatus('error');
      throw new Error(getGenerationErrorMessage(data, '大纲生成失败，请稍后再试。'));
    }

    return response;
  }, []);

  const generateToc = useCallback(async (outline: {
    topic: string;
    learningDirection: string;
    learningGoal: string;
    learnerPositioning: OutlineLearnerPositioning;
  }) => {
    setGenerationStatus('generating');
    setGenerationError(null);
    try {
      const response = await fetch('/api/generate/toc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint: outline }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(getGenerationErrorMessage(data, '目录生成失败，请稍后再试。'));
      }

      setGenerationStatus('success');
      return data;
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '目录生成失败，请稍后再试。');
      setGenerationStatus('error');
      throw error;
    }
  }, []);

  const generateNodeCards = useCallback(async (
    courseId: string,
    nodeIndex: number,
    options: {
      learnerBackground: { backgroundSummary: string; skipBasics: string[] };
      prevNodeSummary?: { title: string; concepts: string[] };
      nextNodeSummary?: { title: string; concepts: string[] };
    }
  ) => {
    setGenerationStatus('generating');
    setGenerationError(null);
    try {
      const bundle = getStoredCourseBundle(courseId);
      if (!bundle) throw new Error('Course bundle not found');
      const node = bundle.blueprint.nodes[nodeIndex];

      const response = await fetch('/api/generate/node/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: bundle.blueprint.topic,
          nodeInfo: {
            teachingGoal: node.teachingGoal,
            teachConceptIds: node.teachConceptIds,
            prerequisiteConceptIds: node.prerequisiteConceptIds,
          },
          learnerBackground: options.learnerBackground,
          prevNodeSummary: options.prevNodeSummary,
          nextNodeSummary: options.nextNodeSummary,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(getGenerationErrorMessage(data, '卡片生成失败，请稍后再试。'));
      }

      setGenerationStatus('success');
      return data;
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '卡片生成失败，请稍后再试。');
      setGenerationStatus('error');
      throw error;
    }
  }, []);

  const generateNodeQuestions = useCallback(async (courseId: string, nodeIndex: number) => {
    setGenerationStatus('generating');
    setGenerationError(null);
    try {
      const bundle = getStoredCourseBundle(courseId);
      if (!bundle) throw new Error('Course bundle not found');
      const node = bundle.blueprint.nodes[nodeIndex];
      const lesson = bundle.lessons[nodeIndex];

      const response = await fetch('/api/generate/node/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: bundle.blueprint.topic,
          nodeInfo: {
            teachingGoal: node.teachingGoal,
            teachConceptIds: node.teachConceptIds,
            prerequisiteConceptIds: node.prerequisiteConceptIds,
          },
          cards: lesson.cards,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(getGenerationErrorMessage(data, '题目生成失败，请稍后再试。'));
      }

      setGenerationStatus('success');
      return data;
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '题目生成失败，请稍后再试。');
      setGenerationStatus('error');
      throw error;
    }
  }, []);

  const startSystemCourse = useCallback((courseId: string) => {
    const course = activateSystemCourse(courseId);
    if (!course) {
      throw new Error('系统课程不存在');
    }

    const storedData = getStoredData();
    setCourses(storedData.courses);
    setCurrentCourse(course);
  }, []);

  // 请求去重：避免同一个节点被并发请求多次
  const pendingNodeRequests = useRef<Map<string, Promise<void>>>(new Map());

  const generateNodeContent = useCallback(async (courseId: string, nodeIndex: number) => {
    const course = coursesRef.current.find(c => c.courseId === courseId);
    if (!course || course.nodes[nodeIndex].cards) return;

    const key = `${courseId}:${nodeIndex}`;
    const existing = pendingNodeRequests.current.get(key);
    if (existing) return existing;

    const bundle = getStoredCourseBundle(courseId);
    if (!bundle) throw new Error('Course bundle not found');

    const promise = (async () => {
      try {
        const nodeInfo = buildNodeInfoPayload(bundle, nodeIndex);
        const lp = bundle.blueprint.learnerPositioning as typeof bundle.blueprint.learnerPositioning & {
          backgroundSummary?: string;
        };

        const response = await fetch('/api/generate/node/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: bundle.blueprint.topic,
            nodeInfo: {
              title: nodeInfo.title,
              teachingGoal: nodeInfo.teachingGoal,
              teachConceptIds: nodeInfo.teachConceptIds,
              prerequisiteConceptIds: nodeInfo.prerequisiteConceptIds,
            },
            learnerBackground: {
              backgroundSummary: lp.backgroundSummary || '',
              skipBasics: lp.skipBasics || [],
            },
            prevNodeSummary: nodeInfo.prevNode,
            nextNodeSummary: nodeInfo.nextNode,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(getGenerationErrorMessage(data, '这一节内容生成失败，请稍后再试。'));
        }

        const cards = data.cards || [];
        const node = bundle.blueprint.nodes[nodeIndex];
        const lesson: NodeLesson = {
          courseId,
          nodeIndex,
          title: node.title,
          teachingGoal: node.teachingGoal,
          teachConceptIds: node.teachConceptIds || [],
          assessmentTargetIds: [],
          cards,
          questions: [],
        };
        updateNodeContent(courseId, nodeIndex, lesson);
      } catch (error) {
        throw (error instanceof Error ? error : new Error('这一节内容生成失败，请稍后再试。'));
      } finally {
        pendingNodeRequests.current.delete(key);
      }
    })();

    pendingNodeRequests.current.set(key, promise);
    return promise;
  }, []);

  // 预加载下一个节点内容（不阻塞主流程）
  const preloadNextNode = useCallback((courseId: string, currentNodeIndex: number) => {
    const course = coursesRef.current.find(c => c.courseId === courseId);
    if (!course) return;

    const nextIndex = currentNodeIndex + 1;
    if (nextIndex >= course.nodes.length) return;
    if (course.nodes[nextIndex].cards) return;

    // 不等待，直接在后台触发生成
    generateNodeContent(courseId, nextIndex).catch(() => {
      // 静默失败，不影响主流程
    });
  }, [generateNodeContent]); // 移除 courses 依赖，使用 ref

  const updateNodeContent = useCallback((
    courseId: string,
    nodeIndex: number,
    lesson: NodeLesson
  ) => {
    saveNodeLesson(courseId, nodeIndex, lesson);
    setCurrentCourse(prev => {
      if (!prev || prev.courseId !== courseId) return prev;
      const newNodes = [...prev.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], cards: lesson.cards, questions: lesson.questions };
      return { ...prev, nodes: newNodes };
    });
    setCourses(prev => prev.map(c => {
      if (c.courseId !== courseId) return c;
      const newNodes = [...c.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], cards: lesson.cards, questions: lesson.questions };
      return { ...c, nodes: newNodes };
    }));
  }, []);

  const updateNodeQuestions = useCallback((
    courseId: string,
    nodeIndex: number,
    questions: NodeLesson['questions']
  ) => {
    const bundle = getStoredCourseBundle(courseId);
    if (!bundle) return;
    const existingLesson = bundle.lessons[nodeIndex];
    if (!existingLesson) return;
    // 保留现有 lesson 的所有字段，只更新 questions
    const lesson: NodeLesson = {
      ...existingLesson,
      courseId,
      nodeIndex,
      questions: questions || [],
    };
    saveNodeLesson(courseId, nodeIndex, lesson);
    setCurrentCourse(prev => {
      if (!prev || prev.courseId !== courseId) return prev;
      const newNodes = [...prev.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], questions };
      return { ...prev, nodes: newNodes };
    });
    setCourses(prev => prev.map(c => {
      if (c.courseId !== courseId) return c;
      const newNodes = [...c.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], questions };
      return { ...c, nodes: newNodes };
    }));
  }, []);

  const deleteCourse = useCallback((courseId: string) => {
    deleteCourseFromStorage(courseId);
    setCourses(prev => prev.filter(c => c.courseId !== courseId));
    setCurrentCourse(prev => prev?.courseId === courseId ? null : prev);
  }, []);

  const addCourse = useCallback((bundle: StoredCourseBundle) => {
    // Save bundle to storage
    addCourseBundle(bundle);
    // Reload and update state so UI reflects the new course immediately
    const data = getStoredData();
    setCourses(data.courses);
    setCurrentCourse(data.courses.find(c => c.courseId === data.currentCourseId) || null);
  }, []);

  return (
    <CourseContext.Provider value={{
      courses,
      currentCourse,
      generationStatus,
      generationError,
      systemCourseRecommendations,
      startSystemCourse,
      generateNodeContent,
      preloadNextNode,
      updateNodeContent,
      updateNodeQuestions,
      deleteCourse,
      addCourse,
      submitOutlineMessage,
      generateToc,
      generateNodeCards,
      generateNodeQuestions,
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
