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
  insights: LearningInsight;
}