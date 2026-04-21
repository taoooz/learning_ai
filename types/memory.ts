// types/memory.ts — 记忆系统相关类型（V3 记忆模型、Payload、迁移格式）

import type { UserProfile } from './user-profile';

export interface MemoryStableFact {
  id: string;
  kind: 'identity' | 'goal' | 'knowledge_background' | 'analogy_experience';
  text: string;
  confidence: number;
  source: 'profile';
  updatedAt: number;
}

export interface MemoryGoal {
  id: string;
  topic: string;
  goalText: string;
  priority: 'high' | 'medium' | 'low';
  source: 'user_input' | 'profile';
  confidence: number;
  updatedAt: number;
}

export interface LearningPreference {
  id: string;
  kind: 'pace' | 'explanation_style' | 'analogy_style' | 'difficulty_preference';
  value: string;
  confidence: number;
  source: 'profile' | 'chat' | 'behavior';
  updatedAt: number;
}

export interface TopicState {
  topic: string;
  familiarityScore: number;
  estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
  transferableBackground: string[];
  mustCoverConcepts: string[];
  skippableBasics: string[];
  riskConcepts: string[];
  confidence: number;
  updatedAt: number;
}

export interface ConceptState {
  topic: string;
  concept: string;
  masteryScore: number;
  status: 'unknown' | 'learning' | 'fragile' | 'mastered';
  evidenceCount: number;
  recentErrors: number;
  recentSuccesses: number;
  lastSeenAt?: number;
  nextReviewAt?: number;
  misconceptionHints: string[];
  confidence: number;
  updatedAt: number;
}

export interface MemoryEvent {
  type:
    | 'course_generated'
    | 'node_started'
    | 'question_answered'
    | 'chat_user_message'
    | 'chat_session_summarized'
    | 'node_completed';
  topic: string;
  courseId?: string;
  nodeIndex?: number;
  occurredAt: number;
  payload: Record<string, unknown>;
}

export interface ConceptProjection {
  topic: string;
  conceptId: string;
  conceptName: string;
  masteryScore: number;
  status: 'unknown' | 'learning' | 'fragile' | 'mastered';
  recentErrors: number;
  recentSuccesses: number;
  misconceptionHints: string[];
  confidence: number;
  lastSeenAt?: number;
  nextReviewAt?: number;
  updatedAt: number;
}

export interface TopicProjection {
  topic: string;
  familiarityScore: number;
  estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
  mustCoverConceptIds: string[];
  skippableConceptIds: string[];
  riskConceptIds: string[];
  confidence: number;
  updatedAt: number;
}

export interface EpisodicProjection {
  id: string;
  topic: string;
  courseId?: string;
  kind: 'course' | 'chat';
  summary: string;
  conceptIds: string[];
  explanationStyles: string[];
  followUp?: string;
  updatedAt: number;
}

export interface LearningSummary {
  /** 整体学习旅程描述（100字以内） */
  journey: string;
  /** 当前重点学习方向 */
  currentFocus: string;
  /** 已表现出的学习偏好（LLM 洞察，非正则检测） */
  learnerInsights: string[];
  /** 需要关注的薄弱点 */
  areasToWatch: string[];
  /** 上次精炼时间 */
  updatedAt: number;
}

export interface MemoryRefineResult {
  /** 学习旅程总结，null 表示无需更新 */
  summary: LearningSummary | null;
  /** LLM 洞察到的学习偏好更新 */
  preferenceUpdates: Array<{
    kind: LearningPreference['kind'];
    value: string;
    evidence: string;
    confidence: number;
  }>;
  /** 概念理解修正（如发现误判） */
  conceptCorrections: Array<{
    concept: string;
    topic: string;
    correctedMastery: number;
    reason: string;
  }>;
}

export interface MemoryStoreV3 {
  version: 3;
  learnerId: string;
  profile: {
    stableFacts: MemoryStableFact[];
    goals: MemoryGoal[];
    preferences: LearningPreference[];
  };
  events: MemoryEvent[];
  projections: {
    conceptProjections: ConceptProjection[];
    topicProjections: TopicProjection[];
    episodicProjections: EpisodicProjection[];
  };
  /** LLM 生成的学习旅程总结（定期精炼） */
  learningSummary?: LearningSummary;
  updatedAt: number;
}

export interface PlanningMemoryPayload {
  learnerSnapshot: {
    targetGoal?: string;
    estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
    confidence: number;
  };
  transferableBackground: string[];
  mustCoverConcepts: string[];
  skippableBasics: string[];
  riskConcepts: string[];
  recentRelevantCourses: Array<{
    topic: string;
    summary: string;
  }>;
  learningSummary?: LearningSummary;
}

export interface CourseBlueprintPromptPayload {
  learnerSnapshot: {
    targetGoal?: string;
    estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
    confidence: number;
  };
  mustCoverConceptIds: string[];
  mustCoverConceptNames: string[];
  skippableConceptIds: string[];
  skippableConceptNames: string[];
  riskConceptIds: string[];
  riskConceptNames: string[];
  analogyFacts: Array<{
    id: string;
    text: string;
  }>;
  recentEpisodes: Array<{
    topic: string;
    summary: string;
  }>;
}

export interface TeachingMemoryPayload {
  nodeTopic: string;
  nodeTitle: string;
  prerequisiteConceptStates: Array<{
    concept: string;
    status: ConceptState['status'];
    masteryScore: number;
  }>;
  targetConceptStates: Array<{
    concept: string;
    status: ConceptState['status'];
    masteryScore: number;
    misconceptionHints: string[];
  }>;
  recentQuestionSummaries: string[];
  analogyHints: string[];
  preferredExplanationStyles: string[];
}

export interface NodeLessonPromptPayload {
  nodeTitle: string;
  teachingGoal: string;
  analogyFacts: Array<{
    id: string;
    text: string;
  }>;
  preferredExplanationStyles: string[];
  recentRelevantQuestions: string[];
}

export interface ChatMemoryPayload {
  topic: string;
  focusConceptStates: Array<{
    concept: string;
    status: ConceptState['status'];
    masteryScore: number;
    misconceptionHints: string[];
  }>;
  riskConcepts: string[];
  recentQuestionSummaries: string[];
  analogyHints: string[];
  preferredExplanationStyles: string[];
  topicSummary?: string;
  learningSummary?: LearningSummary;
}

// UserMemory 子类型
export interface KnowledgeGap {
  concept: string;
  topic: string;
  confidence?: number;
  source?: string;
  severity?: 'high' | 'medium' | 'low';
}

export interface ConceptMasteryItem {
  concept: string;
  topic: string;
  accuracy: number;
  needsReview: boolean;
  source?: string;
  confidence?: number;
}

export interface QuestionPattern {
  question: string;
  topic: string;
  timestamp: number;
}

export interface LearningRecord {
  courseId: string;
  topic: string;
  nodesCompleted: number;
  totalNodes: number;
  completedAt?: number;
}

export interface ExtractedInsights {
  knowledgeGaps: KnowledgeGap[];
  conceptMastery: ConceptMasteryItem[];
  questionPatterns: QuestionPattern[];
}

export interface UserMemory {
  profile: UserProfile;
  learningHistory: LearningRecord[];
  extractedInsights: ExtractedInsights;
  lastUpdated: number;
  version: number;
}

// MemoryStoreV2 中间格式（V1 → V3 转换层）
export interface MemoryStoreV2 {
  version: 2;
  profile: {
    stableFacts: MemoryStableFact[];
    signals: unknown[];
    topicStates: TopicState[];
    conceptStates: ConceptState[];
  };
  summaries: unknown[];
  states: unknown[];
  updatedAt: number;
}

// 对话摘要（过期对话生成）
export interface ConversationSummary {
  courseId: string;
  summary: string;
  timestamp: number;
  mainQuestions?: string[];
  unresolvedConcepts?: string[];
  preferredExplanationStyles?: string[];
  explanationPath?: string;
  resolutionStatus?: 'resolved' | 'partial' | 'open';
  followUp?: string;
}
