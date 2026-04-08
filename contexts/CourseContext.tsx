'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CourseTree, GenerationStatus, NodeLesson, CourseBlueprint, StoredCourseBundle, OutlineLearnerPositioning, OutlineResponse, LearningCard, Question } from '@/types/course';
import {
  activateSystemCourse,
  addCourseBundle,
  deleteCourse as deleteCourseFromStorage,
  getStoredCourseBundle,
  getStoredData,
  getStoredDataV2,
  getSystemCourseRecommendations,
  getUserProfile,
  saveCourseBlueprint,
  SystemCourseRecommendation,
  updateNodeLesson as saveNodeLesson,
} from '@/lib/storage';
import { getUserMemoryStoreSnapshot } from '@/hooks/useUserMemory';
import { createMemoryRepository } from '@/lib/memory/repository';
import { normalizeVisualization } from '@/lib/visualization';

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
  deleteCourse: (courseId: string) => void;
  addCourse: (bundle: StoredCourseBundle) => void;
  submitOutlineMessage: (topic: string, userMessage?: string, sessionId?: string) => Promise<OutlineResponse>;
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
  return Array.isArray(node?.questions);
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
    prevNode: prevNode ? { title: prevNode.title, concepts: prevNode.teachConceptIds || [] } : undefined,
    nextNode: nextNode ? { title: nextNode.title, concepts: nextNode.teachConceptIds || [] } : undefined,
  };
}

function normalizeGeneratedCards<T extends { visualization?: NodeLesson['cards'][number]['visualization'] }>(cards: T[] | undefined): T[] {
  return (cards || []).map((card) => ({
    ...card,
    visualization: normalizeVisualization(card.visualization),
  }));
}

function coerceNodeLessonCards(cards: LearningCard[] | NodeLesson['cards'] | undefined): NodeLesson['cards'] {
  return (cards || []).map((card) => ({
    ...card,
    coveredConceptIds: 'coveredConceptIds' in card && Array.isArray(card.coveredConceptIds)
      ? card.coveredConceptIds
      : [],
    visualization: normalizeVisualization(card.visualization),
  }));
}

function getGenerationErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
    const details = 'details' in data && typeof data.details === 'string' ? data.details : undefined;
    return details ? `${data.error}\n${details}` : data.error;
  }

  return fallback;
}

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [courses, setCourses] = useState<CourseTree[]>([]);
  const [currentCourse, setCurrentCourse] = useState<CourseTree | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [systemCourseRecommendations] = useState<SystemCourseRecommendation[]>(() => getSystemCourseRecommendations());
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);

  // 使用 ref 来跟踪最新的 sessionId，避免 useCallback 依赖问题
  const agentSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    agentSessionIdRef.current = agentSessionId;
  }, [agentSessionId]);

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

  const submitOutlineMessage = useCallback(async (topic: string, userMessage?: string, sessionId?: string) => {
    setGenerationStatus('generating');
    setGenerationError(null);
    try {
      // 使用 Memory Agent 获取精简的 planning payload
      const memoryRepository = createMemoryRepository();
      const planningPayload = memoryRepository.getPlanningPayload(topic);
      
      // 精简 userProfile，只传递关键字段
      const fullProfile = getUserProfile();
      const slimProfile = fullProfile ? {
        name: fullProfile.name,
        targetJob: fullProfile.targetJob,
        insights: fullProfile.insights, // insights 已经提炼了背景知识
        // 不传 education 和 workExperience，避免冗余
      } : null;
      
      const response = await fetch('/api/agents/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          userProfile: slimProfile,
          userMemory: planningPayload, // 只传递精简的 payload
          sessionId: sessionId || agentSessionIdRef.current,
          userMessage,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(getGenerationErrorMessage(data, '大纲生成失败，请稍后再试。'));
      }

      // 检查是否是流式响应
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('text/event-stream')) {
        // 返回 response 对象，让调用方处理流式数据
        setGenerationStatus('success');
        return response;
      }

      // 非流式响应
      const data = await response.json();
      if (data.sessionId) {
        setAgentSessionId(data.sessionId);
      }

      setGenerationStatus('success');
      return data;
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '大纲生成失败，请稍后再试。');
      setGenerationStatus('error');
      throw error;
    }
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
      // 获取用户记忆用于个性化
      const memoryRepository = createMemoryRepository();
      const userMemory = memoryRepository.getMemoryStoreV3();
      
      const response = await fetch('/api/generate/toc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          blueprint: outline,
          userMemory, // 传递用户记忆
        }),
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
      const nodeInfo = buildNodeInfoPayload(bundle, nodeIndex);

      const response = await fetch('/api/generate/node/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: bundle.blueprint.topic,
          nodeInfo,
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
    const requestKey = `${courseId}-${nodeIndex}`;
    const existingPromise = generatingQuestionsRef.current.get(requestKey);
    if (existingPromise) {
      return existingPromise;
    }

    const course = coursesRef.current.find((item) => item.courseId === courseId);
    const existingNode = course?.nodes[nodeIndex];

    if (!course || !existingNode || !shouldEnterLearningPhase(existingNode)) {
      return { questions: [] };
    }

    if (hasResolvedQuestions(existingNode)) {
      return { questions: existingNode.questions as NodeLesson['questions'] };
    }

    const promise = (async () => {
      setGenerationStatus('generating');
      setGenerationError(null);
      try {
        const bundle = getStoredCourseBundle(courseId);
        if (!bundle) throw new Error('Course bundle not found');

        const storedLesson = bundle.lessons[nodeIndex];
        const cards = storedLesson?.cards
          ? normalizeGeneratedCards(storedLesson.cards)
          : coerceNodeLessonCards(existingNode.cards);
        const nodeInfo = buildNodeInfoPayload(bundle, nodeIndex);
        const memoryRepository = createMemoryRepository();
        const userMemory = memoryRepository.getMemoryStoreV3();

        const response = await fetch('/api/generate/node/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: bundle.blueprint.topic,
            nodeInfo,
            cards,
            userMemory,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(getGenerationErrorMessage(data, '题目生成失败，请稍后再试。'));
        }

        const questions = data.questions || [];
        const lesson = {
          ...(storedLesson || {
            courseId,
            nodeIndex,
            title: bundle.blueprint.nodes[nodeIndex]?.title || '',
            teachingGoal: bundle.blueprint.nodes[nodeIndex]?.teachingGoal || '',
            teachConceptIds: bundle.blueprint.nodes[nodeIndex]?.teachConceptIds || [],
            assessmentTargetIds: bundle.blueprint.nodes[nodeIndex]?.teachConceptIds || [],
          }),
          cards,
          questions,
        } as NodeLesson;

        saveNodeLesson(courseId, nodeIndex, lesson);
        setCourses(prev => prev.map(item => {
          if (item.courseId !== courseId) return item;
          const nextCourse = { ...item };
          nextCourse.nodes[nodeIndex] = {
            ...nextCourse.nodes[nodeIndex],
            cards,
            questions,
          };
          return nextCourse;
        }));
        setCurrentCourse(prev => {
          if (!prev || prev.courseId !== courseId) return prev;
          const nextCourse = { ...prev };
          nextCourse.nodes[nodeIndex] = {
            ...nextCourse.nodes[nodeIndex],
            cards,
            questions,
          };
          return nextCourse;
        });

        setGenerationStatus('success');
        return { questions };
      } catch (error) {
        const message = error instanceof Error ? error.message : '题目生成失败，请稍后再试。';
        setGenerationError(message);
        setGenerationStatus('error');

        const bundle = getStoredCourseBundle(courseId);
        const storedLesson = bundle?.lessons[nodeIndex];
        const fallbackCards = storedLesson?.cards
          ? normalizeGeneratedCards(storedLesson.cards)
          : coerceNodeLessonCards(existingNode.cards);

        if (bundle) {
          const fallbackLesson = {
            ...(storedLesson || {
              courseId,
              nodeIndex,
              title: bundle.blueprint.nodes[nodeIndex]?.title || '',
              teachingGoal: bundle.blueprint.nodes[nodeIndex]?.teachingGoal || '',
              teachConceptIds: bundle.blueprint.nodes[nodeIndex]?.teachConceptIds || [],
              assessmentTargetIds: bundle.blueprint.nodes[nodeIndex]?.teachConceptIds || [],
            }),
            cards: fallbackCards,
            questions: [],
          } as NodeLesson;

          saveNodeLesson(courseId, nodeIndex, fallbackLesson);
          setCourses(prev => prev.map(item => {
            if (item.courseId !== courseId) return item;
            const nextCourse = { ...item };
            nextCourse.nodes[nodeIndex] = {
              ...nextCourse.nodes[nodeIndex],
              cards: fallbackCards,
              questions: [],
            };
            return nextCourse;
          }));
          setCurrentCourse(prev => {
            if (!prev || prev.courseId !== courseId) return prev;
            const nextCourse = { ...prev };
            nextCourse.nodes[nodeIndex] = {
              ...nextCourse.nodes[nodeIndex],
              cards: fallbackCards,
              questions: [],
            };
            return nextCourse;
          });
        }

        throw error;
      } finally {
        generatingQuestionsRef.current.delete(requestKey);
      }
    })();

    generatingQuestionsRef.current.set(requestKey, promise);
    return promise;
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

  // 用于缓存正在进行的请求 Promise
  const generatingNodesRef = useRef<Map<string, Promise<void>>>(new Map());
  const generatingQuestionsRef = useRef<Map<string, Promise<{ questions: NodeLesson['questions'] }>>>(new Map());

  const generateNodeContent = useCallback(async (courseId: string, nodeIndex: number) => {
    const requestKey = `${courseId}-${nodeIndex}`;
    
    const existingPromise = generatingNodesRef.current.get(requestKey);
    if (existingPromise) {
      return existingPromise;
    }
    
    const course = coursesRef.current.find(c => c.courseId === courseId);
    const bundle = getStoredCourseBundle(courseId);
    if (!bundle) throw new Error('Course bundle not found');
    const storedLesson = bundle.lessons[nodeIndex];
    const storedCards = storedLesson?.cards?.length ? normalizeGeneratedCards(storedLesson.cards) : undefined;
    const storedQuestions = storedLesson?.questions;

    if (storedCards && storedCards.length > 0) {
      setCourses(prev => prev.map(item => {
        if (item.courseId !== courseId) return item;
        const nextCourse = { ...item };
        nextCourse.nodes[nodeIndex] = {
          ...nextCourse.nodes[nodeIndex],
          cards: storedCards,
          questions: Array.isArray(storedQuestions) ? storedQuestions : nextCourse.nodes[nodeIndex].questions,
        };
        return nextCourse;
      }));
      setCurrentCourse(prev => {
        if (!prev || prev.courseId !== courseId) return prev;
        const nextCourse = { ...prev };
        nextCourse.nodes[nodeIndex] = {
          ...nextCourse.nodes[nodeIndex],
          cards: storedCards,
          questions: Array.isArray(storedQuestions) ? storedQuestions : nextCourse.nodes[nodeIndex].questions,
        };
        return nextCourse;
      });
      return;
    }

    if (!course || course.nodes[nodeIndex].cards) return;


    // 创建新的 Promise 并缓存
    const promise = (async () => {
      try {
        const memoryRepository = createMemoryRepository();
        const userMemory = memoryRepository.getMemoryStoreV3();
        const nodeInfo = buildNodeInfoPayload(bundle, nodeIndex);
        
        // 第一步：生成 Cards（快速返回）
        const cardsResponse = await fetch('/api/generate/node/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: course.topic,
            nodeInfo,
            userMemory,
          }),
        });

        if (!cardsResponse.ok) {
          const data = await cardsResponse.json();
          throw new Error(getGenerationErrorMessage(data, 'Cards 生成失败'));
        }

        const cardsData = await cardsResponse.json();
        const normalizedCards = coerceNodeLessonCards(cardsData.cards || []);

        // 立即保存 Cards，让用户可以开始学习
        const partialLesson = {
          courseId,
          nodeIndex,
          title: bundle.blueprint.nodes[nodeIndex]?.title || '',
          teachingGoal: bundle.blueprint.nodes[nodeIndex]?.teachingGoal || '',
          teachConceptIds: bundle.blueprint.nodes[nodeIndex]?.teachConceptIds || [],
          assessmentTargetIds: bundle.blueprint.nodes[nodeIndex]?.teachConceptIds || [],
          cards: normalizedCards,
        };
        saveNodeLesson(courseId, nodeIndex, partialLesson as NodeLesson);
        
        // 更新状态，触发 UI 刷新
        const updatedCourse = { ...course };
        updatedCourse.nodes[nodeIndex] = {
          ...updatedCourse.nodes[nodeIndex],
          cards: normalizedCards,
        };
        setCourses(prev => prev.map(c => c.courseId === courseId ? updatedCourse : c));
        setCurrentCourse(prev => {
          if (!prev || prev.courseId !== courseId) return prev;
          const nextCourse = { ...prev };
          nextCourse.nodes[nodeIndex] = {
            ...nextCourse.nodes[nodeIndex],
            cards: normalizedCards,
          };
          return nextCourse;
        });

      } catch (error) {
        console.error('[generateNodeContent] Error:', error);
        throw error;
      } finally {
        generatingNodesRef.current.delete(requestKey);
      }
    })();

    generatingNodesRef.current.set(requestKey, promise);
    return promise;
  }, []);

  // 预加载下一个节点内容（不阻塞主流程）
  const preloadNextNode = useCallback((courseId: string, currentNodeIndex: number) => {
    
    const course = coursesRef.current.find(c => c.courseId === courseId);
    if (!course) return;

    const nextIndex = getPendingNextNodeIndex(course.nodes, currentNodeIndex);
    if (nextIndex === null) return;

    
    // 使用 generateNodeContent，复用防重复机制
    generateNodeContent(courseId, nextIndex).catch(() => {
      // 静默失败，不影响主流程
    });
  }, [generateNodeContent]);

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
