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
}

export interface CourseNode {
  index: number;
  title: string;
  description: string;
  cardCount: number;
  status: 'locked' | 'available' | 'completed';
  cards?: LearningCard[];
  questions?: Question[];
}

export interface CourseTree {
  courseId: string;
  topic: string;
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
}

export type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';