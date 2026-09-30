// types/learning-v2/teaching-state.ts
// 课程级教学状态：记录课程内连续教学决策，不等同于全局用户 Memory。

export type PendingArtifactKind =
  | 'checkpoint_result'
  | 'assignment_observation'
  | 'quiz_result'
  | 'user_feedback';

export interface PendingTeachingArtifact {
  kind: PendingArtifactKind;
  chapterId?: string;
  description: string;
  /** 用户尚未提交时为空 */
  content?: string;
  createdAt: number;
}

export interface TeachingInsight {
  insightId: string;
  content: string;
  sourceUrl?: string;
  /** 建议复用的章节 */
  suggestedChapterId?: string;
  status: 'candidate' | 'used' | 'discarded';
  createdAt: number;
}

export interface CourseTeachingNote {
  noteId: string;
  kind: 'preference' | 'mission_direction' | 'next_step' | 'teaching_facts';
  content: string;
  createdAt: number;
}

export interface CourseTeachingState {
  /** 当前教学焦点章节；用于注入章节计划和任务 prompt */
  currentChapterId?: string;
  /** 用户仍未反馈的学习材料 */
  pendingArtifacts: PendingTeachingArtifact[];
  /** 后续课程可复用的新事实或教学素材 */
  insights: TeachingInsight[];
  /** 课程级教师备注，不进入全局 Memory */
  notes: CourseTeachingNote[];
  updatedAt: number;
}
