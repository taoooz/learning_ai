// hooks/useUserMemory.ts
import { useCallback } from 'react';
import { UserMemory, Interest, KnowledgeGap, QuestionPattern, LearningRecord, ConversationSummary } from '@/types/course';
import { getUserProfile } from '@/lib/storage';

const USER_MEMORY_KEY = 'userMemory';

const MAX_QUESTION_PATTERNS = 50;
const INTEREST_DECAY_DAYS = 30;
const INTEREST_DECAY_FACTOR = 0.5;

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
      const profile = getUserProfile() || {
        targetJob: '',
        workExperience: [],
        education: [],
      };
      const memory: UserMemory = { ...defaultMemory, profile };
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
    const now = Date.now();
    memory.extractedInsights.interests.forEach(interest => {
      const daysSinceInteraction = (now - interest.lastInteraction) / (1000 * 60 * 60 * 24);
      if (daysSinceInteraction > INTEREST_DECAY_DAYS) {
        interest.weight = Math.max(1, interest.weight * INTEREST_DECAY_FACTOR);
      }
    });

    const interests = memory.extractedInsights.interests;
    const existing = interests.find(i => i.topic === topic);

    if (existing) {
      existing.weight = Math.min(5, existing.weight + (source === 'course' ? 2 : 1));
      existing.lastInteraction = now;
    } else {
      interests.push({
        topic,
        weight: 1,
        source,
        courseId,
        lastInteraction: now,
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

    if (memory.extractedInsights.questionPatterns.length > MAX_QUESTION_PATTERNS) {
      memory.extractedInsights.questionPatterns.sort((a, b) => b.timestamp - a.timestamp);
      memory.extractedInsights.questionPatterns = memory.extractedInsights.questionPatterns.slice(0, MAX_QUESTION_PATTERNS);
    }

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

  const addConversationSummary = useCallback((courseId: string, summary: string): void => {
    const existing = memory.conversationSummaries?.find(s => s.courseId === courseId);
    if (existing) {
      existing.summary = summary;
      existing.timestamp = Date.now();
    } else {
      if (!memory.conversationSummaries) {
        memory.conversationSummaries = [];
      }
      memory.conversationSummaries.push({
        courseId,
        summary,
        timestamp: Date.now(),
      });
    }
    saveMemory(memory);
  }, [memory]);

  const getConversationSummary = useCallback((courseId: string): ConversationSummary | undefined => {
    return memory.conversationSummaries?.find(s => s.courseId === courseId);
  }, [memory]);

  return {
    userMemory: memory,
    updateInterests,
    addKnowledgeGap,
    addQuestionPattern,
    addLearningRecord,
    markNodeCompleted,
    addConversationSummary,
    getConversationSummary,
  };
}
