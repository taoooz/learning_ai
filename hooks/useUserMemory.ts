// hooks/useUserMemory.ts
import { useCallback } from 'react';
import { UserMemory, Interest, KnowledgeGap, QuestionPattern, LearningRecord } from '@/types/course';
import { getUserProfile } from '@/lib/storage';

const USER_MEMORY_KEY = 'userMemory';

const defaultMemory: UserMemory = {
  profile: null as any,
  learningHistory: [],
  extractedInsights: {
    interests: [],
    knowledgeGaps: [],
    questionPatterns: [],
  },
  lastUpdated: Date.now(),
  version: 1,
};

function getMemory(): UserMemory {
  if (typeof window === 'undefined') return defaultMemory;

  try {
    const raw = localStorage.getItem(USER_MEMORY_KEY);
    if (!raw) {
      // 首次初始化，合并 userProfile
      const profile = getUserProfile();
      const memory = { ...defaultMemory, profile };
      localStorage.setItem(USER_MEMORY_KEY, JSON.stringify(memory));
      return memory;
    }
    return JSON.parse(raw) as UserMemory;
  } catch {
    return defaultMemory;
  }
}

function saveMemory(memory: UserMemory): void {
  if (typeof window === 'undefined') return;
  memory.lastUpdated = Date.now();
  memory.version += 1;
  localStorage.setItem(USER_MEMORY_KEY, JSON.stringify(memory));
}

export function useUserMemory() {
  const memory = getMemory();

  const updateInterests = useCallback((topic: string, source: 'course' | 'chat', courseId?: string): void => {
    const interests = memory.extractedInsights.interests;
    const existing = interests.find(i => i.topic === topic);

    if (existing) {
      existing.weight = Math.min(5, existing.weight + (source === 'course' ? 2 : 1));
      existing.lastInteraction = Date.now();
    } else {
      interests.push({
        topic,
        weight: 1,
        source,
        courseId,
        lastInteraction: Date.now(),
      });
    }

    saveMemory(memory);
  }, [memory]);

  const addKnowledgeGap = useCallback((concept: string, topic: string, evidence: string): void => {
    const gaps = memory.extractedInsights.knowledgeGaps;
    const existing = gaps.find(g => g.concept === concept && g.topic === topic);

    if (existing) {
      if (!existing.evidence.includes(evidence)) {
        existing.evidence.push(evidence);
      }
      // 多次问到，提高 severity
      if (existing.severity === 'low') existing.severity = 'medium';
    } else {
      gaps.push({
        concept,
        topic,
        evidence: [evidence],
        severity: 'low',
      });
    }

    saveMemory(memory);
  }, [memory]);

  const addQuestionPattern = useCallback((question: string, topic: string): void => {
    memory.extractedInsights.questionPatterns.push({
      question,
      topic,
      timestamp: Date.now(),
    });
    saveMemory(memory);
  }, [memory]);

  const addLearningRecord = useCallback((record: Omit<LearningRecord, 'completedAt'>): void => {
    const existing = memory.learningHistory.find(h => h.courseId === record.courseId);
    if (existing) {
      existing.nodesCompleted = record.nodesCompleted;
      existing.completedAt = Date.now();
    } else {
      memory.learningHistory.push({
        ...record,
        completedAt: Date.now(),
      });
    }
    saveMemory(memory);
  }, [memory]);

  // 标记节点完成（更新对应 learningRecord 的完成时间）
  const markNodeCompleted = useCallback((courseId: string): void => {
    const record = memory.learningHistory.find(h => h.courseId === courseId);
    if (record) {
      record.completedAt = Date.now();
      saveMemory(memory);
    }
  }, [memory]);

  return {
    userMemory: memory,
    updateInterests,
    addKnowledgeGap,
    addQuestionPattern,
    addLearningRecord,
    markNodeCompleted,
  };
}
