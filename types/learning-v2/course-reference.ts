// types/learning-v2/course-reference.ts
// 课程参考资料：学习过程沉淀的可复用资产。Lesson 负责过程，Reference 负责回看。

import type { LearningContentBlock, SourceRef } from './learning-stream';

export type CourseReferenceType =
  | 'cheatsheet'
  | 'checklist'
  | 'glossary'
  | 'decision_table'
  | 'process_map';

export interface CourseReference {
  referenceId: string;
  courseId: string;
  chapterId?: string;
  type: CourseReferenceType;
  title: string;
  blocks: LearningContentBlock[];
  sourceRefs?: SourceRef[];
  updatedAt: number;
}

export interface CourseGlossaryTerm {
  termId: string;
  preferredTerm: string;
  aliases: string[];
  definition: string;
  avoidTerms: string[];
  sourceRefs?: SourceRef[];
  updatedAt: number;
}
