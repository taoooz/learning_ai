// types/memory.ts — 历史 prompt payload 与对话摘要类型
// Memory V4 的事实模型见 types/memory-v4.ts；本文件不再承载 V3 Store。

import type { UserProfile } from './user-profile';

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
