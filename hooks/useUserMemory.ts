// hooks/useUserMemory.ts
import { useCallback } from 'react';
import {
  analyzeChatMessageForMemory,
  appendChatSignalsToMemoryStore,
  createDefaultUserMemory,
  decayUserMemory,
  detectAssistantExplanationStyle,
  detectChatLearningPreferences,
  detectExplicitMasteredConcept,
  getChatMemoryPayload,
  getPlanningMemoryPayload,
  getTeachingMemoryPayload,
  isMemoryStoreV2,
  migrateUserMemoryToV2,
  normalizeConceptKey,
  recordChatInsightInMemory,
  recordLearningPreferenceInMemory,
  recordMasteredConceptInMemory,
  recordQuestionAttemptInMemory,
  type ChatSignalInput,
  type QuestionAttemptPayload,
} from '@/lib/memory/aggregator';
import { createMemoryRepository } from '@/lib/memory/repository';
import { getUserProfile } from '@/lib/storage';
import type { ConversationSummary, MemoryStoreV3, UserMemory } from '@/types/course';

const MAX_QUESTION_PATTERNS = 50;

function getRepository() {
  return createMemoryRepository({ getProfile: getUserProfile });
}

export {
  analyzeChatMessageForMemory,
  appendChatSignalsToMemoryStore,
  createDefaultUserMemory,
  decayUserMemory,
  detectAssistantExplanationStyle,
  detectChatLearningPreferences,
  detectExplicitMasteredConcept,
  getChatMemoryPayload,
  getPlanningMemoryPayload,
  getTeachingMemoryPayload,
  isMemoryStoreV2,
  migrateUserMemoryToV2,
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

  const updateInterests = useCallback((topic: string, source: 'course' | 'chat', courseId?: string): void => {
    const now = Date.now();
    decayUserMemory(memory, now);

    for (const interest of memory.extractedInsights.interests) {
      if (interest.topic !== topic) continue;
      interest.weight = Math.min(5, interest.weight + (source === 'course' ? 2 : 1));
      interest.lastInteraction = now;
      interest.confidence = source === 'course' ? 0.95 : Math.max(interest.confidence || 0.4, 0.6);
      repository.saveLegacyMemory(memory);
      return;
    }

    memory.extractedInsights.interests.push({
      topic,
      weight: 1,
      source,
      courseId,
      lastInteraction: now,
      confidence: source === 'course' ? 0.95 : 0.6,
    });
    repository.saveLegacyMemory(memory);
  }, [memory, repository]);

  const addKnowledgeGap = useCallback((concept: string, topic: string, evidence: string, confidence: number = 0.65): void => {
    recordChatInsightInMemory(memory, { concept, topic, evidence, confidence });
    repository.saveLegacyMemory(memory);
  }, [memory, repository]);

  const recordQuestionAttempt = useCallback((payload: QuestionAttemptPayload): void => {
    recordQuestionAttemptInMemory(memory, payload);
    repository.saveLegacyMemory(memory);
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
  }, [memory, repository]);

  const addQuestionPattern = useCallback((question: string, topic: string): void => {
    memory.extractedInsights.questionPatterns.push({
      question,
      topic,
      timestamp: Date.now(),
      confidence: 0.6,
      source: 'chat',
    });

    if (memory.extractedInsights.questionPatterns.length > MAX_QUESTION_PATTERNS) {
      memory.extractedInsights.questionPatterns.sort((a, b) => b.timestamp - a.timestamp);
      memory.extractedInsights.questionPatterns = memory.extractedInsights.questionPatterns.slice(0, MAX_QUESTION_PATTERNS);
    }

    repository.saveLegacyMemory(memory);
  }, [memory, repository]);

  const addLearningRecord = useCallback((record: Omit<UserMemory['learningHistory'][number], 'completedAt'>): void => {
    const existing = memory.learningHistory.find((item) => item.courseId === record.courseId);
    if (existing) {
      existing.nodesCompleted = record.nodesCompleted;
      existing.completedAt = Date.now();
    } else {
      memory.learningHistory.push({
        ...record,
        completedAt: Date.now(),
      });
    }

    repository.saveLegacyMemory(memory);
  }, [memory, repository]);

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
    const updatedStore = appendChatSignalsToMemoryStore(repository.getMemoryStore(), {
      ...input,
      confusionConcept: input.confusionConcept ? normalizeConceptKey(input.confusionConcept) : input.confusionConcept,
    });
    repository.saveMemoryStore(updatedStore);
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
    updateInterests,
    addKnowledgeGap,
    addQuestionPattern,
    addLearningRecord,
    markNodeCompleted,
    recordQuestionAttempt,
    addConversationSummary,
    addLearningPreference,
    addMasteredConcept,
    getConversationSummary,
    recordChatSignals,
  };
}
