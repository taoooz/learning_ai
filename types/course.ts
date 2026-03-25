// 可视化类型
export type VisualizationType =
  // 图表类型（Mermaid）
  | 'flowchart' | 'sequence' | 'class' | 'state' | 'er' | 'gantt' | 'mindmap'
  // 辅助元素类型
  | 'comparison' | 'table' | 'timeline' | 'legend' | 'keyPoints';

// 时间线事件
export interface TimelineEvent {
  time: string;      // 时间点
  title: string;     // 事件标题
  description?: string;
}

// 可视化配置
export interface Visualization {
  type: VisualizationType;
  title?: string;                    // 标题，如"React vs Vue 对比"
  mermaidCode?: string;              // Mermaid 语法（图表类型）
  complex?: boolean;                 // 是否复杂（需放大按钮）
  // 辅助元素专用字段
  items?: string[];                 // 用于 legend、keyPoints
  rows?: string[][];                // 用于 table、comparison
  columns?: string[];               // 用于 table、comparison
  events?: TimelineEvent[];         // 用于 timeline
}

export interface LearningCard {
  id: string;
  title: string;
  content: string;              // Markdown 内容
  imageUrl?: string;
  visualization?: Visualization; // 可视化配置
}

export interface Question {
  id: string;
  type: 'single' | 'multiple' | 'sorting';
  question: string;
  options?: string[];      // 单选/多选/排序题
  answer: string | string[];  // sorting 时为排列后的数组
  explanation: string;
  dimension?: 'memory' | 'understanding' | 'application' | 'analysis';
  difficulty?: 1 | 2 | 3;
  cardId?: string;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  type: 'single' | 'multiple' | 'fill';
  options?: string[];
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

// UserMemory 子类型
export interface Interest {
  topic: string;
  weight: number;           // 1-5
  source: 'course' | 'chat';
  courseId?: string;
  lastInteraction: number;
}

export interface KnowledgeGap {
  concept: string;
  topic: string;
  evidence: string[];
  severity: 'high' | 'medium' | 'low';
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
  interests: Interest[];
  knowledgeGaps: KnowledgeGap[];
  questionPatterns: QuestionPattern[];
}

export interface UserMemory {
  profile: UserProfile;
  learningHistory: LearningRecord[];
  extractedInsights: ExtractedInsights;
  lastUpdated: number;
  version: number;
}
