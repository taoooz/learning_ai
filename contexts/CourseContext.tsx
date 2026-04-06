'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CourseTree, GenerationStatus, NodeLesson, CourseBlueprint, StoredCourseBundle, OutlineLearnerPositioning, OutlineResponse } from '@/types/course';
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

function getGenerationErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
    return data.error;
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

  // 用于缓存正在进行的请求 Promise
  const generatingNodesRef = useRef<Map<string, Promise<void>>>(new Map());

  const generateNodeContent = useCallback(async (courseId: string, nodeIndex: number) => {
    const requestKey = `${courseId}-${nodeIndex}`;
    
    const existingPromise = generatingNodesRef.current.get(requestKey);
    if (existingPromise) {
      return existingPromise;
    }
    
    const course = coursesRef.current.find(c => c.courseId === courseId);
    if (!course || course.nodes[nodeIndex].cards) return;
    const bundle = getStoredCourseBundle(courseId);
    if (!bundle) throw new Error('Course bundle not found');


    // 创建新的 Promise 并缓存
    const promise = (async () => {
      try {
        const memoryRepository = createMemoryRepository();
        const node = bundle.blueprint.nodes[nodeIndex];
        const userMemory = memoryRepository.getMemoryStoreV3();
        
        // 第一步：生成 Cards（快速返回）
        const cardsResponse = await fetch('/api/generate/node/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: course.topic,
            nodeInfo: {
              title: node.title,
              teachingGoal: node.teachingGoal,
              teachConceptIds: node.teachConceptIds || [],
              prerequisiteConceptIds: node.prerequisiteConceptIds || [],
            },
            userMemory,
          }),
        });

        if (!cardsResponse.ok) {
          const data = await cardsResponse.json();
          throw new Error(getGenerationErrorMessage(data, 'Cards 生成失败'));
        }

        const cardsData = await cardsResponse.json();

        // 立即保存 Cards，让用户可以开始学习
        const partialLesson: Partial<NodeLesson> = {
          courseId,
          nodeIndex,
          cards: cardsData.cards || [],
          questions: [], // 暂时为空
        };
        saveNodeLesson(courseId, nodeIndex, partialLesson as NodeLesson);
        
        // 更新状态，触发 UI 刷新
        const updatedCourse = { ...course };
        updatedCourse.nodes[nodeIndex] = {
          ...updatedCourse.nodes[nodeIndex],
          cards: cardsData.cards || [],
        };
        setCourses(prev => prev.map(c => c.courseId === courseId ? updatedCourse : c));

        // 第二步：后台生成 Questions（不阻塞用户）
        const questionsResponse = await fetch('/api/generate/node/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: course.topic,
            nodeInfo: {
              title: node.title,
              teachingGoal: node.teachingGoal,
              teachConceptIds: node.teachConceptIds || [],
              prerequisiteConceptIds: node.prerequisiteConceptIds || [],
            },
            cards: cardsData.cards,
            userMemory,
          }),
        });

        if (!questionsResponse.ok) {
          console.warn('[generateNodeContent] Questions generation failed, using empty array');
        } else {
          const questionsData = await questionsResponse.json();

          // 保存完整的 Lesson
          const fullLesson: Partial<NodeLesson> = {
            courseId,
            nodeIndex,
            cards: cardsData.cards || [],
            questions: questionsData.questions || [],
          };
          saveNodeLesson(courseId, nodeIndex, fullLesson as NodeLesson);

          // 更新状态
          updatedCourse.nodes[nodeIndex] = {
            ...updatedCourse.nodes[nodeIndex],
            cards: cardsData.cards || [],
            questions: questionsData.questions || [],
          };
          setCourses(prev => prev.map(c => c.courseId === courseId ? updatedCourse : c));
        }

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

    const nextIndex = currentNodeIndex + 1;
    if (nextIndex >= course.nodes.length) return;
    if (course.nodes[nextIndex].cards) return;

    
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
