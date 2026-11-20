// types/chat.ts

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isExpired?: boolean;
}

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
