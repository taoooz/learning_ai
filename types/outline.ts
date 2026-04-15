// types/outline.ts — Outline 纲要、澄清问题相关类型

export interface ClarificationQuestion {
  id: string;
  question: string;
  type: 'single' | 'multiple';
  options?: string[];
}

export interface ClarificationAnswer {
  id: string;
  question: string;
  answer: string;
}

// Outline API 返回的纲要类型（不包含章节结构，章节由 TOC API 生成）
export interface OutlineLearnerPositioning {
  estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced' | '初级' | '中级' | '高级';
  backgroundSummary?: string;
  skipBasics?: string[];
}

export interface OutlineBlueprint {
  learningDirection: string;
  learningKeypoint?: string;
  learningGoal: string;
  learnerPositioning: OutlineLearnerPositioning;
}

export interface OutlineResponse {
  type: 'confirmation' | 'questions' | 'reconsider';
  blueprint?: OutlineBlueprint;
  questions?: ClarificationQuestion[];
  message?: string;
}

// Outline SSE 事件类型（对应 Python Agent yield 的事件）
export type OutlineSSEEvent =
  | { type: 'thinking'; message: string }
  | { type: 'content_delta'; content: string }
  | { type: 'question_start'; questionNumber: number }
  | { type: 'questions'; questions: ClarificationQuestion[]; sessionId: string }
  | { type: 'blueprint_start' }
  | { type: 'blueprint_field'; field: string; value: any }
  | { type: 'confirmation'; blueprint: OutlineBlueprint; sessionId: string }
  | { type: 'session_created'; sessionId: string }
  | { type: 'error'; message: string };

// 流式状态（用于前端渲染）
export interface StreamingOutlineState {
  isThinking: boolean;
  thinkingMessage: string;
  contentDelta: string;
  blueprintFields: Partial<OutlineBlueprint>;
  finalResponse: OutlineResponse | null;
  sessionId: string | null;
  error: string | null;
}
