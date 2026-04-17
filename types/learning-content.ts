// types/learning-content.ts — 学习卡片、题目相关类型

import type { Visualization } from './visualization';

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

export interface NodeLessonCard extends LearningCard {
  coveredConceptIds: string[];
}

export interface NodeLessonQuestion extends Question {
  targetConceptId: string;
}
