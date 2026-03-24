export interface LearningCard {
  id: string;
  title: string;
  content: string;       // 支持 Markdown
  imageUrl?: string;
}

export interface Question {
  id: string;
  type: 'single' | 'multiple' | 'fill';
  question: string;
  options?: string[];      // 单选/多选
  answer: string | string[];
  explanation: string;
  dimension?: 'memory' | 'understanding' | 'application' | 'analysis';
  difficulty?: 1 | 2 | 3;
  cardId?: string;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
}

export interface ClarificationAnswer {
  id: string;
  question: string;
  answer: string;
}

export interface CourseNode {
  index: number;
  title: string;
  cardCount: number;
  status: 'locked' | 'available' | 'completed';
  cards?: LearningCard[];
  questions?: Question[];
}

// API 返回的课程响应类型
export interface CourseTreeResponse {
  courseId: string;
  topic: string;
  difficultySummary: string;
  totalNodes: number;
  nodes: Array<{
    index: number;
    title: string;
    cardCount: number;
    status: 'locked' | 'available';
  }>;
}

export interface CourseTree {
  courseId: string;
  topic: string;
  difficultySummary: string;
  totalNodes: number;
  nodes: CourseNode[];
}

export interface CourseProgress {
  [courseId: string]: {
    [nodeIndex: number]: 'completed' | 'in_progress';
  };
}

export interface StoredData {
  courses: CourseTree[];
  currentCourseId: string | null;
  courseProgress: CourseProgress;
  userProfile: UserProfile | null;
}

export type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';

export interface LearningInsight {
  knowledgeBackground: string[];
  analogyExperiences: string[];
  summary: string;
}

export interface WorkExperience {
  id: string;
  company: string;
  position: string;
  description?: string;
}

export interface Education {
  id: string;
  school: string;
  major: string;
}

export interface UserProfile {
  name?: string;
  targetJob: string;
  workExperience: WorkExperience[];
  education: Education[];
  insights?: LearningInsight;
}