'use client';

// contexts/CourseContext.tsx
// P0 下线 V1 学习流后的课程上下文：只维护课程清单（V2 容器派生）+ 大纲对话 + 系统课程启动。
// V1 的节点生成、节点进度、模板课程 bundle 相关能力已随 V1 流程一并移除。

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { SystemCourseRecommendation } from '@/lib/data/system-courses';
import { createSystemCourseV2 } from '@/lib/data/system-courses';
import { createAndSaveStoredCourseV2 } from '@/lib/learning-v2/dispatch';
import { deleteCourseV2, listCoursesV2, type CourseListEntry } from '@/lib/learning-v2/course-list';
import { getSystemCourseRecommendations, getUserProfile } from '@/lib/storage';
import { ingestProfileMemory } from '@/lib/memory-client';

interface CourseContextType {
  /** 首页课程清单（V2 容器派生，按创建时间升序） */
  courses: CourseListEntry[];
  isHydrated: boolean;
  systemCourseRecommendations: SystemCourseRecommendation[];
  /** 启动系统推荐课程：映射为 V2 蓝图并落盘，失败时抛错由页面提示 */
  startSystemCourse: (courseId: string) => Promise<void>;
  deleteCourse: (courseId: string) => Promise<void>;
  refreshCourses: () => void;
  /** 课程大纲对话（生成课程的第一步） */
  submitOutlineMessage: (topic: string, userMessage?: string) => Promise<Response>;
}

const CourseContext = createContext<CourseContextType | null>(null);

export function CourseProvider({ children }: { children: React.ReactNode }) {
  const [courses, setCourses] = useState<CourseListEntry[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [systemCourseRecommendations] = useState<SystemCourseRecommendation[]>(() => getSystemCourseRecommendations());

  const refreshCourses = useCallback(() => {
    setCourses(listCoursesV2());
  }, []);

  useEffect(() => {
    refreshCourses();
    // 水合完成标记：页面据此区分「还在加载」和「确实没有数据」，避免无限 loading
    setIsHydrated(true);
  }, [refreshCourses]);

  const startSystemCourse = useCallback(async (courseId: string) => {
    await ingestProfileMemory(getUserProfile());
    const course = createSystemCourseV2(courseId);
    if (!course) {
      throw new Error('系统课程不存在');
    }
    const saved = await createAndSaveStoredCourseV2(course);
    if (!saved) {
      throw new Error('系统课程保存失败，请稍后再试');
    }
    refreshCourses();
  }, [refreshCourses]);

  const deleteCourse = useCallback(async (courseId: string) => {
    await deleteCourseV2(courseId);
    refreshCourses();
  }, [refreshCourses]);

  const submitOutlineMessage = useCallback(async (topic: string, userMessage?: string) => {
    const sessionId = userMessage ? sessionStorage.getItem('outlineSessionId') : undefined;
    await ingestProfileMemory(getUserProfile());

    const response = await fetch('/api/agents/outline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        userMessage,
        sessionId,
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
