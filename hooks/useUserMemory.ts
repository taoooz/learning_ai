// hooks/useUserMemory.ts
import { useCallback } from 'react';
import {
  analyzeChatMessageForMemory,
  createDefaultUserMemory,
  decayUserMemory,
  detectAssistantExplanationStyle,
  detectChatLearningPreferences,
  detectExplicitMasteredConcept,
  normalizeConceptKey,
  recordChatInsightInMemory,
  recordLearningPreferenceInMemory,
  recordMasteredConceptInMemory,
  recordQuestionAttemptInMemory,
  type ChatSignalInput,
  type QuestionAttemptPayload,
} from '@/lib/memory/aggregator';
import {
  getChatMemoryPayload,
  getPlanningMemoryPayload,
  getTeachingMemoryPayload,
} from '@/lib/memory/memory-agent';
import { createMemoryRepository } from '@/lib/memory/repository';
import { getUserProfile } from '@/lib/storage';
import type { ConversationSummary, MemoryStoreV3, UserMemory } from '@/types/course';

const MAX_QUESTION_PATTERNS = 50;

function getRepository() {
  return createMemoryRepository({ getProfile: getUserProfile });
}

export {
  analyzeChatMessageForMemory,
  createDefaultUserMemory,
  decayUserMemory,
  detectAssistantExplanationStyle,
  detectChatLearningPreferences,
  detectExplicitMasteredConcept,
  getChatMemoryPayload,
  getPlanningMemoryPayload,
  getTeachingMemoryPayload,
  normalizeConceptKey,
  recordChatInsightInMemory,
  recordLearningPreferenceInMemory,
  recordMasteredConceptInMemory,
  recordQuestionAttemptInMemory,
};

export function getUserMemorySnapshot(): UserMemory {
  return getRepository().getLegacyMemory();
}

export function getUserMemoryStoreSnapshot(): MemoryStoreV3 {
  return getRepository().getMemoryStoreV3();
}

export function useUserMemory() {
  const repository = getRepository();
  const memory = repository.getLegacyMemory();
  const memoryStore = repository.getMemoryStoreV3();

  const recordQuestionAttempt = useCallback((payload: QuestionAttemptPayload): void => {
    // 只写入 V3 事件
    repository.appendMemoryEvent({
      type: 'question_answered',
      topic: payload.topic,
      courseId: payload.courseId,
      occurredAt: Date.now(),
      payload: {
        conceptId: normalizeConceptKey(payload.concept),
        conceptName: normalizeConceptKey(payload.concept),
        question: payload.question,
        isCorrect: payload.isCorrect,
        difficulty: payload.difficulty,
        dimension: payload.dimension,
      },
    });
  }, [repository]);

  const markNodeCompleted = useCallback((courseId: string): void => {
    const record = memory.learningHistory.find((item) => item.courseId === courseId);
    if (!record) return;
    record.completedAt = Date.now();
    repository.saveLegacyMemory(memory);
  }, [memory, repository]);

  const addConversationSummary = useCallback((courseId: string, summary: string | Omit<ConversationSummary, 'courseId' | 'timestamp'>): void => {
    const summaryInput = typeof summary === 'string' ? { summary } : summary;
    const existing = memory.conversationSummaries?.find((item) => item.courseId === courseId);
    if (existing) {
      Object.assign(existing, summaryInput);
      existing.timestamp = Date.now();
    } else {
      if (!memory.conversationSummaries) {
        memory.conversationSummaries = [];
      }
      memory.conversationSummaries.push({
        courseId,
        ...summaryInput,
        timestamp: Date.now(),
      });
    }

    repository.saveLegacyMemory(memory);
    repository.appendMemoryEvent({
      type: 'chat_session_summarized',
      topic: courseId,
      courseId,
      occurredAt: Date.now(),
      payload: {
        id: `chat-summary-${courseId}`,
        summary: summaryInput.summary,
        conceptIds: summaryInput.unresolvedConcepts || [],
        explanationStyles: summaryInput.preferredExplanationStyles || [],
        followUp: summaryInput.followUp,
      },
    });
  }, [memory, repository]);

  const addLearningPreference = useCallback((preference: UserMemory['extractedInsights']['learningPreferences'][number]): void => {
    recordLearningPreferenceInMemory(memory, preference);
    repository.saveLegacyMemory(memory);
  }, [memory, repository]);

  const addMasteredConcept = useCallback((mastered: UserMemory['extractedInsights']['masteredConcepts'][number]): void => {
    recordMasteredConceptInMemory(memory, mastered);
    repository.saveLegacyMemory(memory);
  }, [memory, repository]);

  const getConversationSummary = useCallback((courseId: string): ConversationSummary | undefined => {
    return memory.conversationSummaries?.find((item) => item.courseId === courseId);
  }, [memory]);

  const recordChatSignals = useCallback((input: ChatSignalInput): void => {
    repository.appendMemoryEvent({
      type: 'chat_user_message',
      topic: input.topic,
      courseId: input.courseId,
      occurredAt: Date.now(),
      payload: {
        question: input.question,
        confusionConceptId: input.confusionConcept ? normalizeConceptKey(input.confusionConcept) : undefined,
        confusionConceptName: input.confusionConcept ? normalizeConceptKey(input.confusionConcept) : undefined,
      },
    });
  }, [repository]);

  return {
    userMemory: memory,
    memoryStore,
    // V1 写入方法已废弃，统一使用 V3 事件
    // updateInterests, addKnowledgeGap, addQuestionPattern, addLearningRecord 已删除
    markNodeCompleted,
    recordQuestionAttempt,
    addConversationSummary,
    addLearningPreference,
    addMasteredConcept,
    getConversationSummary,
    recordChatSignals,
  };
}
