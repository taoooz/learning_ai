'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CourseTree, GenerationStatus, NodeLesson } from '@/types/course';
import {
  activateSystemCourse,
  deleteCourse as deleteCourseFromStorage,
  getStoredCourseBundle,
  getStoredData,
  getSystemCourseRecommendations,
  getUserProfile,
  saveCourseBlueprint,
  SystemCourseRecommendation,
  updateNodeLesson as saveNodeLesson,
} from '@/lib/storage';
import { getUserMemoryStoreSnapshot } from '@/hooks/useUserMemory';
import { createMemoryRepository } from '@/lib/memory/repository';

interface ClarificationState {
  topic: string;
  questions: Array<{
    id: string;
    question: string;
    answer: string;
  }>;
}

interface CourseContextType {
  courses: CourseTree[];
  currentCourse: CourseTree | null;
  generationStatus: GenerationStatus;
  generationError: string | null;
  systemCourseRecommendations: SystemCourseRecommendation[];
  generateCourse: (topic: string) => Promise<void>;
  retryCourseGeneration: () => Promise<void>;
  startSystemCourse: (courseId: string) => void;
  generateNodeContent: (courseId: string, nodeIndex: number) => Promise<void>;
  preloadNextNode: (courseId: string, currentNodeIndex: number) => void;
  updateNodeContent: (courseId: string, nodeIndex: number, lesson: NodeLesson) => void;
  deleteCourse: (courseId: string) => void;
  clarification: ClarificationState | null;
  setClarification: React.Dispatch<React.SetStateAction<ClarificationState | null>>;
  submitClarification: () => Promise<void>;
}

const CourseContext = createContext<CourseContextType | null>(null);

interface CourseGenerationRequest {
  topic: string;
  clarificationAnswers?: ClarificationState['questions'];
}

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
  const [clarification, setClarification] = useState<ClarificationState | null>(null);
  const [systemCourseRecommendations] = useState<SystemCourseRecommendation[]>(() => getSystemCourseRecommendations());
  const lastGenerationRequestRef = useRef<CourseGenerationRequest | null>(null);

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

  const generateCourse = useCallback(async (topic: string) => {
    setGenerationStatus('generating');
    setGenerationError(null);
    lastGenerationRequestRef.current = { topic };
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          userProfile: getUserProfile(),
          userMemory: getUserMemoryStoreSnapshot(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(getGenerationErrorMessage(data, '课程生成失败，请稍后再试。'));
      }

      // 检查是否需要澄清
      if (data.questions && Array.isArray(data.questions)) {
        setClarification({
          topic,
          questions: data.questions.map((q: { id: string; question: string }) => ({
            ...q,
            answer: ''
          }))
        });
        setGenerationStatus('success');
        return;
      }

      // 直接返回课程
      saveCourseBlueprint(data.blueprint);
      createMemoryRepository().appendMemoryEvent({
        type: 'course_generated',
        topic,
        courseId: data.blueprint.courseId,
        occurredAt: Date.now(),
        payload: {
          goal: data.blueprint.courseGoal,
          conceptIds: data.blueprint.globalConcepts.map((item: { id: string }) => item.id),
        },
      });
      const storedData = getStoredData();
      const course = storedData.courses.find((item) => item.courseId === data.blueprint.courseId) || null;
      if (!course) throw new Error('Generated course missing after save');
      setCourses(storedData.courses);
      setCurrentCourse(course);

      // 课程目录生成完成，立即返回，让用户看到课程
      // 第一節內容在後台生成
      setGenerationStatus('success');

      // 後台生成第一節內容，不阻塞主流程
      const blueprint = data.blueprint;
      const courseForNode = course;
      setTimeout(() => {
        generateNodeContent(courseForNode.courseId, 0).catch(() => {
          // 第一節生成失敗不影響課程
        });
      }, 0);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '课程生成失败，请稍后再试。');
      setGenerationStatus('error');
      throw error;
    }
  }, []);

  const submitClarification = useCallback(async () => {
    if (!clarification) return;

    const unanswered = clarification.questions.filter(q => !q.answer.trim());
    if (unanswered.length > 0) {
      throw new Error('Please answer all questions');
    }

    setGenerationStatus('generating');
    setGenerationError(null);
    lastGenerationRequestRef.current = {
      topic: clarification.topic,
      clarificationAnswers: clarification.questions.map((item) => ({ ...item })),
    };
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: clarification.topic,
          clarificationAnswers: clarification.questions,
          userProfile: getUserProfile(),
          userMemory: getUserMemoryStoreSnapshot(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(getGenerationErrorMessage(data, '课程生成失败，请稍后再试。'));
      }
      saveCourseBlueprint(data.blueprint);
      createMemoryRepository().appendMemoryEvent({
        type: 'course_generated',
        topic: clarification.topic,
        courseId: data.blueprint.courseId,
        occurredAt: Date.now(),
        payload: {
          goal: data.blueprint.courseGoal,
          conceptIds: data.blueprint.globalConcepts.map((item: { id: string }) => item.id),
        },
      });
      const storedData = getStoredData();
      const course = storedData.courses.find((item) => item.courseId === data.blueprint.courseId) || null;
      if (!course) throw new Error('Generated course missing after save');
      setCourses(storedData.courses);
      setCurrentCourse(course);
      setClarification(null);
      setGenerationStatus('success');
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '课程生成失败，请稍后再试。');
      setGenerationStatus('error');
      throw error;
    }
  }, [clarification]);

  const retryCourseGeneration = useCallback(async () => {
    const request = lastGenerationRequestRef.current;
    if (!request) {
      throw new Error('没有可重试的课程生成请求');
    }

    if (request.clarificationAnswers?.length) {
      setGenerationStatus('generating');
      setGenerationError(null);
      setClarification({
        topic: request.topic,
        questions: request.clarificationAnswers.map((item) => ({ ...item })),
      });
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: request.topic,
            clarificationAnswers: request.clarificationAnswers,
            userProfile: getUserProfile(),
            userMemory: getUserMemoryStoreSnapshot(),
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(getGenerationErrorMessage(data, '课程生成失败，请稍后再试。'));
        }

        saveCourseBlueprint(data.blueprint);
        createMemoryRepository().appendMemoryEvent({
          type: 'course_generated',
          topic: request.topic,
          courseId: data.blueprint.courseId,
          occurredAt: Date.now(),
          payload: {
            goal: data.blueprint.courseGoal,
            conceptIds: data.blueprint.globalConcepts.map((item: { id: string }) => item.id),
          },
        });
        const storedData = getStoredData();
        const course = storedData.courses.find((item) => item.courseId === data.blueprint.courseId) || null;
        if (!course) throw new Error('Generated course missing after save');
        setCourses(storedData.courses);
        setCurrentCourse(course);
        setClarification(null);
        setGenerationStatus('success');
      } catch (error) {
        setGenerationError(error instanceof Error ? error.message : '课程生成失败，请稍后再试。');
        setGenerationStatus('error');
        throw error;
      }
      return;
    }

    await generateCourse(request.topic);
  }, [generateCourse]);

  const startSystemCourse = useCallback((courseId: string) => {
    const course = activateSystemCourse(courseId);
    if (!course) {
      throw new Error('系统课程不存在');
    }

    const storedData = getStoredData();
    setCourses(storedData.courses);
    setCurrentCourse(course);
  }, []);

  const generateNodeContent = useCallback(async (courseId: string, nodeIndex: number) => {
    const course = coursesRef.current.find(c => c.courseId === courseId);
    if (!course || course.nodes[nodeIndex].cards) return;
    const bundle = getStoredCourseBundle(courseId);
    if (!bundle) throw new Error('Course bundle not found');

    try {
      const response = await fetch('/api/generate/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: course.topic,
          blueprint: bundle.blueprint,
          nodeIndex,
          userProfile: getUserProfile(),
          userMemory: getUserMemoryStoreSnapshot(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(getGenerationErrorMessage(data, '这一节内容生成失败，请稍后再试。'));
      }

      const { generationMeta: _generationMeta, ...lessonPayload } = data;
      const lesson: NodeLesson = lessonPayload;
      updateNodeContent(courseId, nodeIndex, lesson);
    } catch (error) {
      throw (error instanceof Error ? error : new Error('这一节内容生成失败，请稍后再试。'));
    }
  }, []); // 移除 courses 依赖，使用 ref

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

  const deleteCourse = useCallback((courseId: string) => {
    deleteCourseFromStorage(courseId);
    setCourses(prev => prev.filter(c => c.courseId !== courseId));
    setCurrentCourse(prev => prev?.courseId === courseId ? null : prev);
  }, []);

  return (
    <CourseContext.Provider value={{
      courses,
      currentCourse,
      generationStatus,
      generationError,
      systemCourseRecommendations,
      generateCourse,
      retryCourseGeneration,
      startSystemCourse,
      generateNodeContent,
      preloadNextNode,
      updateNodeContent,
      deleteCourse,
      clarification,
      setClarification,
      submitClarification,
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
