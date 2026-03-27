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
    title: '人人都该懂的 AI 课',
    summary: '给只用过 ChatGPT、豆包这类产品的用户，补上真正该懂的 AI 常识、边界和正确使用方法。',
    badge: '系统推荐',
    cta: '从第一节开始',
    generation: {
      topic: '人人都该懂的 AI 课',
      learnerGoal: '建立普通人该有的 AI 基本认知，理解大模型、提示词、Agent、幻觉与安全边界。',
      learnerDescription: '面向对 AI 一知半解，只用过 ChatGPT、豆包类产品的普通用户。',
      mustCoverConceptNames: ['大语言模型', '提示词与上下文', '工具调用与 Agent', '幻觉与校验'],
      riskConceptNames: ['工具调用与 Agent', '幻觉与校验'],
      skippableConceptNames: [],
      analogyFacts: [],
      recentEpisodes: [],
      recentRelevantQuestions: [
        '为什么同一句话，AI 有时回答得很好，有时又很不靠谱？',
        'Agent 和普通聊天机器人到底有什么区别？',
      ],
      preferredExplanationStyles: ['先讲直觉再讲定义', '分步拆解'],
    },
  },
  {
    courseId: 'system-personal-finance',
    title: '普通人应该如何理财',
    summary: '给打工人的普世理财方法，先稳住现金流，再用长期复利慢慢把资产做厚。',
    badge: '系统推荐',
    cta: '开始这门课',
    generation: {
      topic: '普通人应该如何理财',
      learnerGoal: '给普通打工人建立普适理财框架，先稳现金流和风险，再靠长期复利做积累。',
      learnerDescription: '适用于打工人的普世理财方法，不追热点，耐心追求复利。',
      mustCoverConceptNames: ['现金流与应急金', '消费与负债', '长期复利', '资产配置与风险'],
      riskConceptNames: ['消费与负债', '资产配置与风险'],
      skippableConceptNames: [],
      analogyFacts: [],
      recentEpisodes: [],
      recentRelevantQuestions: [
        '为什么很多人一理财就总想先找收益最高的产品？',
        '普通人到底该先还债、存钱还是开始投资？',
      ],
      preferredExplanationStyles: ['先讲原则再讲动作', '分步拆解'],
    },
  },
];
