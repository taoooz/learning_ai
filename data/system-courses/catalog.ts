export interface SystemCourseGenerationSeed {
  topic: string;
  learnerGoal: string;
  learnerDescription: string;
  mustCoverConceptNames: string[];
  riskConceptNames: string[];
  skippableConceptNames: string[];
  analogyFacts: Array<{ id: string; text: string }>;
  recentEpisodes: Array<{ topic: string; summary: string }>;
  recentRelevantQuestions: string[];
  preferredExplanationStyles: string[];
}

export interface SystemCourseCatalogEntry {
  courseId: string;
  title: string;
  summary: string;
  badge: string;
  cta: string;
  generation: SystemCourseGenerationSeed;
}

export const SYSTEM_COURSE_CATALOG: SystemCourseCatalogEntry[] = [
  {
    courseId: 'system-ai-for-everyone',
    title: 'AI 实战进阶课',
    summary: '面向已有 AI 使用基础的用户，深入理解大模型工作原理、提示词工程与 Agent 开发，理论与实战结合。',
    badge: '系统推荐',
    cta: '从第一节开始',
    generation: {
      topic: 'AI 实战进阶课',
      learnerGoal: '深入理解 AI 工作原理，掌握提示词工程与 Agent 开发，具备识别与规避 AI 风险的能力。',
      learnerDescription: '面向已有 AI 使用经验的用户，不讲基础概念，直接深入模型原理与实战应用。',
      mustCoverConceptNames: ['Transformer 架构', '注意力机制', '提示词工程', 'Agent 与工具调用', 'RAG 与知识库', 'AI 安全与风险防控'],
      riskConceptNames: ['AI 安全与风险防控', 'Agent 与工具调用'],
      skippableConceptNames: ['大语言模型基础概念'],
      analogyFacts: [],
      recentEpisodes: [],
      recentRelevantQuestions: [
        '为什么 AI 会产生幻觉？如何有效规避？',
        '如何设计一个能真正完成复杂任务的 Agent？',
      ],
      preferredExplanationStyles: ['先讲原理再讲应用', '代码与案例结合'],
    },
  },
  {
    courseId: 'system-personal-finance',
    title: '实战投资进阶课',
    summary: '面向有基础理财认知的用户，深入学习资产配置、基金投资、风险管理与投资心理，理论实战结合。',
    badge: '系统推荐',
    cta: '开始这门课',
    generation: {
      topic: '实战投资进阶课',
      learnerGoal: '建立完整的投资体系，掌握基金、股票、债券配置策略，具备识别市场风险与投资心理偏差的能力。',
      learnerDescription: '面向有基础理财认知的用户，不讲基础概念，直接深入投资策略与实战技巧。',
      mustCoverConceptNames: ['资产配置与再平衡', '基金投资策略', '股票估值方法', '债券与固收', '风险管理与止损', '投资心理与行为金融'],
      riskConceptNames: ['风险管理与止损', '投资心理与行为金融'],
      skippableConceptNames: ['复利基础概念', '应急金概念'],
      analogyFacts: [],
      recentEpisodes: [],
      recentRelevantQuestions: [
        '如何避免追涨杀跌的人性弱点？',
        '定投指数基金为什么能长期盈利？',
      ],
      preferredExplanationStyles: ['先讲原理再讲策略', '案例与数据结合'],
    },
  },
];
