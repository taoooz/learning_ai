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
  imageUrl?: string | null;
  visualization?: Visualization; // 可视化配置
}

export interface Question {
  id: string;
  type: 'single' | 'multiple' | 'fill_blank';
  question: string;
  options?: string[];
  answer: string | string[];
  sentence?: string;       // fill_blank 专用：包含 ___ 空位的句子
  concept?: string;
  dimension?: 'memory' | 'understanding' | 'application' | 'analysis';
  difficulty?: 1 | 2 | 3;
  cardId?: string;
  targetConceptId?: string;
}

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

export interface CourseNode {
  index: number;
  title: string;
  status: 'locked' | 'available' | 'completed';
  cards?: LearningCard[];
  questions?: Question[];
}

// API 返回的课程响应类型
export interface CourseTreeResponse {
  courseId: string;
  topic: string;
  totalNodes: number;
  nodes: Array<{
    index: number;
    title: string;
    status: 'locked' | 'available';
  }>;
}

export interface CourseTree {
  courseId: string;
  topic: string;
  courseGoal: string;
  totalNodes: number;
  nodes: CourseNode[];
}

export interface CanonicalConcept {
  id: string;
  name: string;
  aliases: string[];
}

export interface CourseBlueprintNode {
  index: number;
  title: string;
  teachingGoal: string;
  frame?: string;
  teachConceptIds: string[];
  prerequisiteConceptIds: string[];
  assessmentTargetIds?: string[];
  bridgeFromPreviousNode: string;
  personalizationHooks?: {
    mustRemediateConceptIds: string[];
    canCompressKnownConceptIds: string[];
    analogyFactIds: string[];
  };
  status: 'locked' | 'available' | 'completed';
}

export interface CourseBlueprint {
  courseId: string;
  topic: string;
  learnerPositioning: {
    estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced' | '初级' | '中级' | '高级';
    backgroundSummary?: string;
    skipBasics?: string[];
  };
  courseGoal: string;
  globalConcepts: CanonicalConcept[];
  nodes: CourseBlueprintNode[];
  coverage?: {
    introducedConceptIds: string[];
    assessedConceptIds: string[];
    remediatedConceptIds: string[];
  };
  generationNotes?: {
    compressedKnownConceptIds: string[];
    emphasizedRiskConceptIds: string[];
    selectedAnalogyFactIds: string[];
  };
}

export interface CourseTreeView {
  courseId: string;
  topic: string;
  courseGoal: string;
  totalNodes: number;
  nodes: Array<{
    index: number;
    title: string;
    status: 'locked' | 'available' | 'completed';
  }>;
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

export interface NodeLessonCard extends LearningCard {
  coveredConceptIds: string[];
}

export interface NodeLessonQuestion extends Question {
  targetConceptId: string;
}

export interface NodeLesson {
  courseId: string;
  nodeIndex: number;
  title: string;
  teachingGoal: string;
  teachConceptIds: string[];
  assessmentTargetIds: string[];
  cards: NodeLessonCard[];
  questions: NodeLessonQuestion[];
  validatorSummary?: {
    passed: boolean;
    issues: string[];
  };
}

export interface StoredCourseBundle {
  blueprint: CourseBlueprint;
  treeView: CourseTreeView;
  lessons: Record<number, NodeLesson>;
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

export interface StoredDataV2 {
  courses: StoredCourseBundle[];
  currentCourseId: string | null;
  courseProgress: CourseProgress;
  userProfile: UserProfile | null;
  recommendations: StoredRecommendation[];
}

export interface StoredRecommendation {
  title: string;
  reason: string;
  createdAt: number;
}

export type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';

export interface LearningInsight {
  workSummary: string[];
  educationSummary: string[];
  analogyExperiences: string[];
  learningStyle: '理论型' | '实践型' | '';
  technicalLevel: '入门级' | '业务级' | '专家型' | '';
  valuePriorities: string[];
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
