// hooks/useUserMemory.ts
import { useCallback } from 'react';
import {
  analyzeChatMessageForMemory,
  detectAssistantExplanationStyle,
  detectChatLearningPreferences,
  detectExplicitMasteredConcept,
  normalizeConceptKey,
  type ChatSignalInput,
  type DetectedLearningPreference,
  type DetectedMasteredConcept,
  type QuestionAttemptPayload,
} from '@/lib/memory/aggregator';
import {
  getChatMemoryPayload,
  getPlanningMemoryPayload,
  getTeachingMemoryPayload,
} from '@/lib/memory/memory-agent';
import { createMemoryRepository } from '@/lib/memory/repository';
import { getUserProfile } from '@/lib/storage';
import type { ConversationSummary, MemoryStoreV3 } from '@/types/course';

function getRepository() {
  return createMemoryRepository({ getProfile: getUserProfile });
}

export {
  analyzeChatMessageForMemory,
  detectAssistantExplanationStyle,
  detectChatLearningPreferences,
  detectExplicitMasteredConcept,
  getChatMemoryPayload,
  getPlanningMemoryPayload,
  getTeachingMemoryPayload,
  normalizeConceptKey,
};

export function getUserMemoryStoreSnapshot(): MemoryStoreV3 {
  return getRepository().getMemoryStoreV3();
}

export function useUserMemory() {
  const repository = getRepository();
  const memoryStore = repository.getMemoryStoreV3();

  const recordQuestionAttempt = useCallback((payload: QuestionAttemptPayload): void => {
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

  const addConversationSummary = useCallback((courseId: string, summary: string | Omit<ConversationSummary, 'courseId' | 'timestamp'>): void => {
    const summaryInput = typeof summary === 'string' ? { summary } : summary;
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
  }, [repository]);

  const addLearningPreference = useCallback((preference: DetectedLearningPreference): void => {
    // 写入 V3 profile.preferences
    const store = repository.getMemoryStoreV3();
    const existing = store.profile.preferences.find(
      (item) => item.kind === preference.kind && item.value === preference.value,
    );
    const updatedStore = { ...store, profile: { ...store.profile, preferences: [...store.profile.preferences] } };
    if (existing) {
      existing.confidence = Math.max(existing.confidence, preference.confidence);
      existing.updatedAt = Date.now();
    } else {
      updatedStore.profile.preferences.unshift({
        id: `preference:${preference.kind}:${preference.value}`,
        kind: preference.kind,
        value: preference.value,
        confidence: preference.confidence,
        source: 'chat',
        updatedAt: Date.now(),
      });
    }
    updatedStore.profile.preferences = updatedStore.profile.preferences.slice(0, 12);
    repository.saveMemoryStoreV3(updatedStore);
  }, [repository]);

  const addMasteredConcept = useCallback((mastered: DetectedMasteredConcept): void => {
    const normalizedConcept = normalizeConceptKey(mastered.concept);
    // 写入 V3 conceptProjection
    repository.appendMemoryEvent({
      type: 'node_completed',
      topic: mastered.topic,
      occurredAt: Date.now(),
      payload: {
        teachConceptIds: [normalizedConcept],
        teachConceptNames: [normalizedConcept],
        nodeTitle: `掌握概念：${normalizedConcept}`,
        teachingGoal: mastered.evidence,
      },
    });
  }, [repository]);

  const getConversationSummary = useCallback((courseId: string): ConversationSummary | undefined => {
    // 从 V3 episodicProjections 读取
    const store = repository.getMemoryStoreV3();
    const episode = store.projections.episodicProjections.find(
      (item) => item.courseId === courseId && item.kind === 'chat',
    );
    if (!episode) return undefined;
    return {
      courseId,
      summary: episode.summary,
      timestamp: episode.updatedAt,
      unresolvedConcepts: episode.conceptIds,
      preferredExplanationStyles: episode.explanationStyles,
      followUp: episode.followUp,
    };
  }, [repository]);

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
    userMemory: memoryStore,
    memoryStore,
    recordQuestionAttempt,
    addConversationSummary,
    addLearningPreference,
    addMasteredConcept,
    getConversationSummary,
    recordChatSignals,
  };
}
