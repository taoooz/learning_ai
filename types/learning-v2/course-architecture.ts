// Course Architect 输出：课程设计决策层，不直接作为前端存储协议。
// 现有 CourseBlueprint 仍由确定性编译器产出。

export type ConceptTargetDepth = 'skip' | 'refresh' | 'understand' | 'apply' | 'transfer';

export interface CourseThesis {
  audience: string;
  currentBoundary: string[];
  targetCapability: string;
  learningDelta: string[];
  nonGoals: string[];
}

export interface ArchitectureConcept {
  conceptId: string;
  label: string;
  targetDepth: ConceptTargetDepth;
  rationale: string;
  prerequisiteConceptIds: string[];
  evidenceIds?: string[];
}

export interface ArchitectureChapter {
  chapterId: string;
  title: string;
  roleInCourse: string;
  conceptIds: string[];
  deliverable: string;
  prerequisites: string[];
  assessmentMode: 'none' | 'self_report' | 'checkpoint';
}

export interface CourseExamplePolicy {
  preferredDomains: string[];
  personalExampleLimit: number;
  avoidRepeatedScenarios: boolean;
}

export interface CourseArchitecture {
  architectureVersion: 1;
  courseTopic: string;
  thesis: CourseThesis;
  conceptGraph: ArchitectureConcept[];
  chapters: ArchitectureChapter[];
  examplePolicy: CourseExamplePolicy;
}
