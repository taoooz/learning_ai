'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CourseTree, CourseNode, GenerationStatus } from '@/types/course';
import { getStoredData, addCourse as saveCourse, updateNodeContent as saveNodeContent, deleteCourse as deleteCourseFromStorage } from '@/lib/storage';

interface CourseContextType {
  courses: CourseTree[];
  currentCourse: CourseTree | null;
  generationStatus: GenerationStatus;
  generateCourse: (topic: string) => Promise<void>;
  generateNodeContent: (courseId: string, nodeIndex: number) => Promise<void>;
  preloadNextNode: (courseId: string, currentNodeIndex: number) => void;
  updateNodeContent: (courseId: string, nodeIndex: number, cards: CourseNode['cards'], questions: CourseNode['questions']) => void;
  deleteCourse: (courseId: string) => void;
}

const CourseContext = createContext<CourseContextType | null>(null);

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [courses, setCourses] = useState<CourseTree[]>([]);
  const [currentCourse, setCurrentCourse] = useState<CourseTree | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');

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
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });

      if (!response.ok) throw new Error('Generation failed');

      const course: CourseTree = await response.json();

      // 第一个节点设为 available
      if (course.nodes.length > 0) {
        course.nodes[0].status = 'available';
      }

      saveCourse(course);
      setCourses(prev => [...prev, course]);
      setCurrentCourse(course);
      setGenerationStatus('success');
    } catch {
      setGenerationStatus('error');
      throw new Error('Failed to generate course');
    }
  }, []);

  const generateNodeContent = useCallback(async (courseId: string, nodeIndex: number) => {
    const course = courses.find(c => c.courseId === courseId);
    if (!course || course.nodes[nodeIndex].cards) return;

    try {
      const response = await fetch('/api/generate/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        topic: course.topic,
        title: course.nodes[nodeIndex].title,
        cardCount: course.nodes[nodeIndex].cardCount,
      }),
      });

      if (!response.ok) throw new Error('Node generation failed');

      const { cards, questions } = await response.json();
      updateNodeContent(courseId, nodeIndex, cards, questions);
    } catch {
      throw new Error('Failed to generate node content');
    }
  }, [courses]);

  // 预加载下一个节点内容（不阻塞主流程）
  const preloadNextNode = useCallback((courseId: string, currentNodeIndex: number) => {
    const course = courses.find(c => c.courseId === courseId);
    if (!course) return;

    const nextIndex = currentNodeIndex + 1;
    if (nextIndex >= course.nodes.length) return;
    if (course.nodes[nextIndex].cards) return;

    // 不等待，直接在后台触发生成
    generateNodeContent(courseId, nextIndex).catch(() => {
      // 静默失败，不影响主流程
    });
  }, [courses, generateNodeContent]);

  const updateNodeContent = useCallback((
    courseId: string,
    nodeIndex: number,
    cards: CourseNode['cards'],
    questions: CourseNode['questions']
  ) => {
    saveNodeContent(courseId, nodeIndex, cards, questions);
    setCurrentCourse(prev => {
      if (!prev || prev.courseId !== courseId) return prev;
      const newNodes = [...prev.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], cards, questions };
      return { ...prev, nodes: newNodes };
    });
    setCourses(prev => prev.map(c => {
      if (c.courseId !== courseId) return c;
      const newNodes = [...c.nodes];
      newNodes[nodeIndex] = { ...newNodes[nodeIndex], cards, questions };
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
      generateCourse,
      generateNodeContent,
      preloadNextNode,
      updateNodeContent,
      deleteCourse,
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