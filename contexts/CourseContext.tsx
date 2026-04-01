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

  // 用于缓存正在进行的请求 Promise
  const generatingNodesRef = useRef<Map<string, Promise<void>>>(new Map());

  const generateNodeContent = useCallback(async (courseId: string, nodeIndex: number) => {
    const requestKey = `${courseId}-${nodeIndex}`;
    
    // 打印调用栈
    console.log('[generateNodeContent] Called from:', new Error().stack?.split('\n').slice(2, 5).join('\n'));
    
    // 如果正在生成，返回现有的 Promise
    const existingPromise = generatingNodesRef.current.get(requestKey);
    if (existingPromise) {
      console.log('[generateNodeContent] Reusing existing promise:', requestKey);
      return existingPromise;
    }
    
    const course = coursesRef.current.find(c => c.courseId === courseId);
    if (!course || course.nodes[nodeIndex].cards) return;
    const bundle = getStoredCourseBundle(courseId);
    if (!bundle) throw new Error('Course bundle not found');

    console.log('[generateNodeContent] Starting generation:', requestKey);

    // 创建新的 Promise 并缓存
    const promise = (async () => {
      try {
        // 使用 Memory Agent 获取精简的 teaching payload
        const memoryRepository = createMemoryRepository();
        const node = bundle.blueprint.nodes[nodeIndex];
        const teachingPayload = memoryRepository.getTeachingPayload({
          topic: course.topic,
          nodeTitle: node.title,
          nodeConcepts: node.teachConceptIds || [],
          prerequisiteConcepts: node.prerequisiteConceptIds || [],
        });
        
        const response = await fetch('/api/generate/node', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
          topic: course.topic,
          blueprint: bundle.blueprint,
          nodeIndex,
          userProfile: getUserProfile(),
          userMemory: teachingPayload, // 只传递精简的 payload
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(getGenerationErrorMessage(data, '这一节内容生成失败，请稍后再试。'));
      }

      // 检查是否是流式响应
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('text/event-stream')) {
        // 流式处理
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        const lesson: Partial<NodeLesson> = {
          courseId,
          nodeIndex,
          cards: [],
          questions: [],
        };

        if (!reader) throw new Error('无法读取流式响应');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            
            let data = line.trim();
            while (data.startsWith('data:')) {
              data = data.slice(5).trim();
            }
            
            if (data === '[DONE]' || !data) continue;
            
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'meta') {
                lesson.title = parsed.title;
                lesson.teachingGoal = parsed.teachingGoal;
              } else if (parsed.type === 'card') {
                lesson.cards!.push(parsed.data);
                // 实时更新（创建新对象触发 React 更新）
                updateNodeContent(courseId, nodeIndex, { ...lesson } as NodeLesson);
              } else if (parsed.type === 'question') {
                lesson.questions!.push(parsed.data);
                // 实时更新（创建新对象触发 React 更新）
                updateNodeContent(courseId, nodeIndex, { ...lesson } as NodeLesson);
              }
            } catch (e) {
              console.warn('Failed to parse SSE:', e);
            }
          }
        }

        // 最终更新
        updateNodeContent(courseId, nodeIndex, lesson as NodeLesson);
      } else {
        // 非流式响应（兼容旧版）
        const data = await response.json();
        const lesson: NodeLesson = data;
        updateNodeContent(courseId, nodeIndex, lesson);
      }
      
      console.log('[generateNodeContent] Generation completed:', requestKey);
    } catch (error) {
      console.error('[generateNodeContent] Generation failed:', requestKey, error);
      throw (error instanceof Error ? error : new Error('这一节内容生成失败，请稍后再试。'));
    } finally {
      // 移除缓存
      generatingNodesRef.current.delete(requestKey);
    }
    })();

    // 缓存 Promise
    generatingNodesRef.current.set(requestKey, promise);
    return promise;
  }, []); // 移除 courses 依赖，使用 ref

  // 预加载下一个节点内容（不阻塞主流程）
  const preloadNextNode = useCallback((courseId: string, currentNodeIndex: number) => {
    console.log('[preloadNextNode] Called for:', courseId, currentNodeIndex);
    
    const course = coursesRef.current.find(c => c.courseId === courseId);
    if (!course) return;

    const nextIndex = currentNodeIndex + 1;
    if (nextIndex >= course.nodes.length) return;
    if (course.nodes[nextIndex].cards) return;

    console.log('[preloadNextNode] Preloading node:', nextIndex);
    
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
