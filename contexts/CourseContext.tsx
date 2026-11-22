'use client';

// contexts/CourseContext.tsx
// 课程上下文：只维护课程清单（当前课程容器派生）+ 大纲对话 + 系统课程启动。
// 旧版节点生成、节点进度和模板课程 bundle 能力均已移除。

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { SystemCourseRecommendation } from '@/lib/data/system-courses';
import { createSystemCourse } from '@/lib/data/system-courses';
import { createAndSaveStoredCourse } from '@/lib/learning-v2/dispatch';
import { deleteCourse, listCourses, type CourseListEntry } from '@/lib/learning-v2/course-list';
import { getSystemCourseRecommendations, getUserProfile } from '@/lib/storage';
import { ingestProfileMemory } from '@/lib/memory-client';
import type { ClarificationAnswer } from '@/types/course';

interface CourseContextType {
  /** 首页课程清单（当前课程容器派生，按创建时间升序） */
  courses: CourseListEntry[];
  isHydrated: boolean;
  systemCourseRecommendations: SystemCourseRecommendation[];
  /** 启动系统推荐课程：映射为当前蓝图并落盘，失败时抛错由页面提示 */
  startSystemCourse: (courseId: string) => Promise<void>;
  deleteCourse: (courseId: string) => Promise<void>;
  refreshCourses: () => void;
  /** 课程大纲对话（生成课程的第一步） */
  submitOutlineMessage: (
    topic: string,
    userMessage?: string,
    clarificationAnswers?: ClarificationAnswer[],
  ) => Promise<Response>;
}

const CourseContext = createContext<CourseContextType | null>(null);

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [courses, setCourses] = useState<CourseListEntry[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [systemCourseRecommendations] = useState<SystemCourseRecommendation[]>(() => getSystemCourseRecommendations());

  const refreshCourses = useCallback(() => {
    setCourses(listCourses());
  }, []);

  useEffect(() => {
    refreshCourses();
    // 水合完成标记：页面据此区分「还在加载」和「确实没有数据」，避免无限 loading
    setIsHydrated(true);
  }, [refreshCourses]);

  const startSystemCourse = useCallback(async (courseId: string) => {
    await ingestProfileMemory(getUserProfile());
    const course = createSystemCourse(courseId);
    if (!course) {
      throw new Error('系统课程不存在');
    }
    const saved = await createAndSaveStoredCourse(course);
    if (!saved) {
      throw new Error('系统课程保存失败，请稍后再试');
    }
    refreshCourses();
  }, [refreshCourses]);

  const deleteCourse = useCallback(async (courseId: string) => {
    await deleteCourse(courseId);
    refreshCourses();
  }, [refreshCourses]);

  const submitOutlineMessage = useCallback(async (
    topic: string,
    userMessage?: string,
    clarificationAnswers?: ClarificationAnswer[],
  ) => {
    const hasClarificationAnswers = Boolean(clarificationAnswers?.length);
    const sessionId = userMessage || hasClarificationAnswers
      ? sessionStorage.getItem('outlineSessionId')
      : undefined;
    await ingestProfileMemory(getUserProfile());

    const response = await fetch('/api/agents/outline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        userMessage,
        sessionId,
        answers: clarificationAnswers,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        typeof data?.error === 'string' ? data.error : '大纲生成失败，请稍后再试。',
      );
    }

    return response;
  }, []);

  return (
    <CourseContext.Provider value={{
      courses,
      isHydrated,
      systemCourseRecommendations,
      startSystemCourse,
      deleteCourse,
      refreshCourses,
      submitOutlineMessage,
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
