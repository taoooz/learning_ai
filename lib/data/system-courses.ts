// lib/data/system-courses.ts
// 系统推荐课程：只保留元数据 + 章节大纲，统一走 V2 蓝图管线（mapTocToBlueprintV2）。
// 原先 v1 预生成的 lessons JSON 已废弃（P0：下线 V1 学习流），章节内容在用户学到时按需生成。

import { mapTocToBlueprintV2 } from '@/lib/learning-v2/blueprint-map';
import { createStoredCourseV2 } from '@/lib/learning-v2/storage';
import type { StoredCourseV2 } from '@/types/learning-v2';

export interface SystemCourseRecommendation {
  courseId: string;
  title: string;
  summary: string;
  badge: string;
  cta: string;
}

interface SystemCourseChapter {
  title: string;
  /** 章节教学说明，映射为蓝图章节目标 */
  description: string;
}

interface SystemCourseSpec {
  recommendation: SystemCourseRecommendation;
  /** 学习方向，用于推断学习意图类型 */
  learningDirection: string;
  /** 学完能达到什么，作为蓝图的 targetScenario */
  description: string;
  chapters: SystemCourseChapter[];
}

const SYSTEM_COURSE_SPECS: SystemCourseSpec[] = [
  {
    recommendation: {
      courseId: 'system-ai-for-everyone',
      title: 'AI实战进阶课',
      summary: '面向已有 AI 使用基础的用户，深入理解大模型工作原理、提示词工程与 Agent 开发，理论与实战结合。',
      badge: '系统推荐',
      cta: '从第一节开始',
    },
    learningDirection: '从原理到落地的 AI 应用开发',
    description: '理解大模型与 Agent 的核心原理，能独立完成提示词设计与 RAG 应用搭建。',
    chapters: [
      { title: 'Transformer架构与注意力机制', description: '深入理解 Transformer 架构和注意力机制的工作原理' },
      { title: '提示词工程进阶', description: '掌握结构化提示词、角色扮演、思维链等高级技巧' },
      { title: 'Agent与工具调用', description: '理解 Agent 架构，掌握工具调用和工作流设计方法' },
      { title: 'RAG与知识库实战', description: '掌握 RAG 架构、向量检索和知识库构建的核心技术' },
    ],
  },
  {
    recommendation: {
      courseId: 'system-personal-finance',
      title: '实战投资进阶课',
      summary: '面向有基础理财认知的用户，深入学习资产配置、基金投资、风险管理与投资心理，理论实战结合。',
      badge: '系统推荐',
      cta: '开始这门课',
    },
    learningDirection: '从资产配置到风险控制的个人投资体系',
    description: '建立可执行的投资框架，能独立完成资产配置、基金筛选与风险控制决策。',
    chapters: [
      { title: '资产配置与再平衡', description: '理解核心资产类别，掌握资产配置原则和定期再平衡策略' },
      { title: '基金投资策略', description: '掌握指数基金、主动管理基金的选择逻辑和定投策略' },
      { title: '股票估值方法', description: '学会 PE、PB、DCF 等估值方法，能独立判断个股吸引力' },
      { title: '风险管理与止损', description: '建立止损思维，理解仓位管理和风险控制原则' },
    ],
  },
];

export function getSystemCourseRecommendations(): SystemCourseRecommendation[] {
  return SYSTEM_COURSE_SPECS.map((spec) => ({ ...spec.recommendation }));
}

/**
 * 把系统课程的大纲映射为 V2 课程容器（纯函数，不落盘）。
 * courseId 不存在时返回 null，由调用方提示用户。
 */
export function createSystemCourseV2(courseId: string, now?: number): StoredCourseV2 | null {
  const spec = SYSTEM_COURSE_SPECS.find((item) => item.recommendation.courseId === courseId);
  if (!spec) return null;

  const { recommendation } = spec;
  const blueprint = mapTocToBlueprintV2({
    courseId,
    courseName: recommendation.title,
    description: spec.description,
    // 章节序号沿用 TOC 的 1 基约定（章节树按 index - 1 渲染节点数字）
    nodes: spec.chapters.map((chapter, i) => ({
      index: i + 1,
      title: chapter.title,
      description: chapter.description,
    })),
    outline: {
      topic: recommendation.title,
      learningDirection: spec.learningDirection,
      learningGoal: spec.description,
      learnerPositioning: { estimatedLevel: 'beginner' },
    },
    now,
  });

  return createStoredCourseV2(courseId, blueprint, now);
}
