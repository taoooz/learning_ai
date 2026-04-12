'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { markNodeCompleted, getStoredCourseBundle, getStoredData } from '@/lib/storage';
import { recordStudyStandalone } from '@/hooks/useStreak';
import { createMemoryRepository } from '@/lib/memory/repository';

interface ProgressContextType {
  completedNodes: Set<string>; // "courseId-nodeIndex" 格式
  markCompleted: (courseId: string, nodeIndex: number) => void;
  isCompleted: (courseId: string, nodeIndex: number) => boolean;
  refreshProgress: () => void;
}

const ProgressContext = createContext<ProgressContextType | null>(null);

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [completedNodes, setCompletedNodes] = useState<Set<string>>(new Set());

  const refreshProgress = useCallback(() => {
    const data = getStoredData();
    const set = new Set<string>();
    Object.entries(data.courseProgress).forEach(([courseId, progress]) => {
      Object.entries(progress).forEach(([nodeIndex, status]) => {
        if (status === 'completed') {
          set.add(`${courseId}-${nodeIndex}`);
        }
      });
    });
    setCompletedNodes(set);
  }, []);

  useEffect(() => {
    refreshProgress();
  }, [refreshProgress]);

  const markCompleted = useCallback((courseId: string, nodeIndex: number) => {
    recordStudyStandalone();
    markNodeCompleted(courseId, nodeIndex);
    const bundle = getStoredCourseBundle(courseId);
    const node = bundle?.blueprint.nodes[nodeIndex];
    if (bundle && node) {
      createMemoryRepository().appendMemoryEvent({
        type: 'node_completed',
        topic: bundle.blueprint.topic,
        courseId,
        nodeIndex,
        occurredAt: Date.now(),
        payload: {
          nodeTitle: node.title,
          teachingGoal: node.teachingGoal,
          teachConceptIds: node.teachConceptIds,
          teachConceptNames: node.teachConceptIds.map((conceptId) => bundle.blueprint.globalConcepts.find((item) => item.id === conceptId)?.name || conceptId),
        },
      });
    }
    // 触发自定义事件通知 CourseContext 刷新
    window.dispatchEvent(new CustomEvent('node-completed', { detail: { courseId, nodeIndex } }));
    refreshProgress();
  }, [refreshProgress]);

  const isCompleted = useCallback((courseId: string, nodeIndex: number) => {
    return completedNodes.has(`${courseId}-${nodeIndex}`);
  }, [completedNodes]);

  return (
    <ProgressContext.Provider value={{ completedNodes, markCompleted, isCompleted, refreshProgress }}>
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgress() {
  const context = useContext(ProgressContext);
  if (!context) throw new Error('useProgress must be used within ProgressProvider');
  return context;
}
