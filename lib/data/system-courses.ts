import { deriveCourseTreeViewFromBlueprint } from '@/lib/course-blueprint';
import type { CourseBlueprint, NodeLesson, StoredCourseBundle } from '@/types/course';

export interface SystemCourseRecommendation {
  courseId: string;
  title: string;
  summary: string;
  badge: string;
  cta: string;
}

function systemCard(id: string, title: string, content: string, coveredConceptIds: string[]): NodeLesson['cards'][number] {
  return { id, title, content, imageUrl: null, coveredConceptIds };
}

function systemQuestion(config: {
  id: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  targetConceptId: string;
  cardId: string;
  concept: string;
  difficulty?: 1 | 2 | 3;
  dimension?: 'memory' | 'understanding' | 'application' | 'analysis';
}): NodeLesson['questions'][number] {
  return {
    id: config.id,
    type: 'single',
    question: config.question,
    options: config.options,
    answer: config.answer,
    explanation: config.explanation,
    targetConceptId: config.targetConceptId,
    cardId: config.cardId,
    concept: config.concept,
    difficulty: config.difficulty || 1,
    dimension: config.dimension || 'understanding',
  };
}

function createSystemBundle(blueprint: CourseBlueprint, lessons: Record<number, NodeLesson>): StoredCourseBundle {
  return {
    blueprint,
    treeView: deriveCourseTreeViewFromBlueprint(blueprint),
    lessons,
  };
}

export function cloneStoredCourseBundle(bundle: StoredCourseBundle): StoredCourseBundle {
  return JSON.parse(JSON.stringify(bundle)) as StoredCourseBundle;
}

export const SYSTEM_COURSE_LIBRARY: Array<{ recommendation: SystemCourseRecommendation; bundle: StoredCourseBundle }> = [
  {
    recommendation: {
      courseId: 'system-ai-for-everyone',
      title: '人人都该懂的 AI 课',
      summary: '给只用过 ChatGPT、豆包这类产品的用户，补上真正该懂的 AI 常识、边界和正确使用方法。',
      badge: '系统推荐',
      cta: '从第一节开始',
    },
    bundle: createSystemBundle(
      {
        courseId: 'system-ai-for-everyone',
        topic: '人人都该懂的 AI 课',
        learnerPositioning: {
          estimatedLevel: 'beginner',
          difficultySummary: '适合对 AI 一知半解、想建立完整常识框架的普通用户。',
          whyThisCourseFits: '从你最常接触的聊天式 AI 出发，先建立理解，再谈使用和边界。',
        },
        courseGoal: '学完后能理解 AI 产品的基本原理、常见误区和正确使用边界，不再只会"碰运气式提问"。',
        globalConcepts: [
          { id: 'concept-llm', name: '大语言模型', aliases: ['LLM'] },
          { id: 'concept-context', name: '上下文与提示词', aliases: ['context'] },
          { id: 'concept-tool-agent', name: '工具调用与 Agent', aliases: ['Agent'] },
          { id: 'concept-hallucination', name: '幻觉与校验', aliases: ['hallucination'] },
        ],
        nodes: [
          {
            index: 0,
            title: 'AI 聊天产品到底在做什么',
            teachingGoal: '先建立大语言模型的基本直觉，知道它像什么、不像什么。',
            teachConceptIds: ['concept-llm'],
            prerequisiteConceptIds: [],
            assessmentTargetIds: ['concept-llm'],
            bridgeFromPreviousNode: '从零开始建立对 AI 的共同语言。',
            personalizationHooks: { mustRemediateConceptIds: [], canCompressKnownConceptIds: [], analogyFactIds: [] },
            status: 'available',
          },
          {
            index: 1,
            title: '为什么同一句话，AI 有时灵有时不灵',
            teachingGoal: '理解上下文、提示词和输入质量为什么会直接影响结果。',
            teachConceptIds: ['concept-context'],
            prerequisiteConceptIds: ['concept-llm'],
            assessmentTargetIds: ['concept-context'],
            bridgeFromPreviousNode: '理解模型之后，再看你和模型之间是怎么沟通的。',
            personalizationHooks: { mustRemediateConceptIds: [], canCompressKnownConceptIds: [], analogyFactIds: [] },
            status: 'locked',
          },
          {
            index: 2,
            title: '工具、Agent 和普通聊天有什么区别',
            teachingGoal: '搞清楚聊天、工具调用和 Agent 的能力边界，避免把概念混成一团。',
            teachConceptIds: ['concept-tool-agent'],
            prerequisiteConceptIds: ['concept-llm', 'concept-context'],
            assessmentTargetIds: ['concept-tool-agent'],
            bridgeFromPreviousNode: '当沟通方式清楚后，再看 AI 什么时候会开始"做事"。',
            personalizationHooks: { mustRemediateConceptIds: [], canCompressKnownConceptIds: [], analogyFactIds: [] },
            status: 'locked',
          },
          {
            index: 3,
            title: '普通人怎么更安全地用 AI',
            teachingGoal: '理解幻觉、校验和隐私边界，形成更稳妥的 AI 使用习惯。',
            teachConceptIds: ['concept-hallucination'],
            prerequisiteConceptIds: ['concept-llm', 'concept-context'],
            assessmentTargetIds: ['concept-hallucination'],
            bridgeFromPreviousNode: '知道 AI 能做什么后，更重要的是知道什么时候不能直接信它。',
            personalizationHooks: { mustRemediateConceptIds: ['concept-hallucination'], canCompressKnownConceptIds: [], analogyFactIds: [] },
            status: 'locked',
          },
        ],
        coverage: {
          introducedConceptIds: ['concept-llm', 'concept-context', 'concept-tool-agent', 'concept-hallucination'],
          assessedConceptIds: ['concept-llm', 'concept-context', 'concept-tool-agent', 'concept-hallucination'],
          remediatedConceptIds: ['concept-hallucination'],
        },
        generationNotes: {
          compressedKnownConceptIds: [],
          emphasizedRiskConceptIds: ['concept-hallucination'],
          selectedAnalogyFactIds: [],
        },
      },
      {
        0: {
          courseId: 'system-ai-for-everyone',
          nodeIndex: 0,
          title: 'AI 聊天产品到底在做什么',
          teachingGoal: '先建立大语言模型的基本直觉，知道它像什么、不像什么。',
          teachConceptIds: ['concept-llm'],
          assessmentTargetIds: ['concept-llm'],
          cards: [
            systemCard('ai-card-1', '它不是"懂了"，而是在预测', '大语言模型最核心的工作，不是像人一样真正理解世界，而是根据上下文预测"下一个最可能出现的词"。这件事听起来简单，但当训练数据足够大时，就会表现出很强的语言能力。', ['concept-llm']),
            systemCard('ai-card-2', '为什么它看起来像在思考', '因为语言里本来就包含了大量模式。模型把这些模式学得非常熟，所以它回答问题时常常会像"想明白了"，但你要记住，这和人类的理解机制并不一样。', ['concept-llm']),
            systemCard('ai-card-3', '先建立一个正确比喻', '把它理解成"一个非常会接话、会总结、会重组信息的概率系统"会更接近事实。这个比喻不完美，但比"它什么都懂"更安全。', ['concept-llm']),
          ],
          questions: [
            systemQuestion({
              id: 'ai-q-1',
              question: '下面哪种理解更接近大语言模型的工作方式？',
              options: ['A. 它像搜索引擎，只会把网页内容搬过来', 'B. 它会根据上下文预测最可能的后续内容', 'C. 它像人类一样真正理解了所有知识', 'D. 它只会记住固定答案模板'],
              answer: 'B',
              explanation: '大语言模型的核心机制是基于上下文做概率预测，不等于真正像人类一样理解世界。',
              targetConceptId: 'concept-llm',
              cardId: 'ai-card-1',
              concept: '大语言模型',
              difficulty: 1,
            }),
          ],
        },
        1: {
          courseId: 'system-ai-for-everyone',
          nodeIndex: 1,
          title: '为什么同一句话，AI 有时灵有时不灵',
          teachingGoal: '理解上下文、提示词和输入质量为什么会直接影响结果。',
          teachConceptIds: ['concept-context'],
          assessmentTargetIds: ['concept-context'],
          cards: [
            systemCard('ai-card-4', 'AI 不是猜你心里想什么', '模型只能看到你给它的输入和当前上下文，看不到你脑中的意图。所以"提示词写得不清楚"不是形式问题，而是输入信息不足。', ['concept-context']),
            systemCard('ai-card-5', '上下文像对话现场', '同一句话，放在不同上下文里，含义会完全不同。模型也是这样：你前面提供了什么背景、目标和限制，会直接决定它后面的表现。', ['concept-context']),
            systemCard('ai-card-6', '好提示词不是花哨，是减少歧义', '普通用户最有用的做法，不是背几十种高级模板，而是把目标、对象、限制、输出形式说清楚。这样结果会明显更稳。', ['concept-context']),
          ],
          questions: [
            systemQuestion({
              id: 'ai-q-2',
              question: '为什么同一个问题，AI 在不同场景下可能回答质量差很多？',
              options: ['A. 因为模型每天心情不一样', 'B. 因为上下文和输入信息质量会影响它的判断', 'C. 因为 AI 只会回答固定标准题', 'D. 因为中文天然不适合和 AI 沟通'],
              answer: 'B',
              explanation: '模型对当前上下文非常敏感，输入越清楚、约束越明确，输出越稳定。',
              targetConceptId: 'concept-context',
              cardId: 'ai-card-5',
              concept: '上下文与提示词',
              difficulty: 1,
            }),
          ],
        },
        2: {
          courseId: 'system-ai-for-everyone',
          nodeIndex: 2,
          title: '工具、Agent 和普通聊天有什么区别',
          teachingGoal: '搞清楚聊天、工具调用和 Agent 的能力边界，避免把概念混成一团。',
          teachConceptIds: ['concept-tool-agent'],
          assessmentTargetIds: ['concept-tool-agent'],
          cards: [
            systemCard('ai-card-7', '普通聊天主要是"说"', '普通聊天式 AI 的强项是解释、总结、改写和生成文本，但它默认并不会真的去替你查数据库、发邮件或下单。', ['concept-tool-agent']),
            systemCard('ai-card-8', '工具调用开始让它"做"', '当模型被接上搜索、日历、表格、数据库等工具后，它就不只是说答案，而是可以调用外部能力完成任务。', ['concept-tool-agent']),
            systemCard('ai-card-9', 'Agent 是会规划的一整套流程', 'Agent 不只是单次工具调用，而是围绕目标做多步判断、调用能力、处理结果，再决定下一步怎么做。', ['concept-tool-agent']),
          ],
          questions: [
            systemQuestion({
              id: 'ai-q-3',
              question: '下面哪种情况最接近 Agent，而不只是普通聊天？',
              options: ['A. 帮你改一段文案', 'B. 自动拆解任务、查资料、整理结果再给出下一步建议', 'C. 解释一个术语含义', 'D. 把一段话翻译成英文'],
              answer: 'B',
              explanation: 'Agent 的关键是围绕目标做多步规划和执行，不只是一次性生成一段文本。',
              targetConceptId: 'concept-tool-agent',
              cardId: 'ai-card-9',
              concept: '工具调用与 Agent',
              difficulty: 2,
              dimension: 'application',
            }),
          ],
        },
        3: {
          courseId: 'system-ai-for-everyone',
          nodeIndex: 3,
          title: '普通人怎么更安全地用 AI',
          teachingGoal: '理解幻觉、校验和隐私边界，形成更稳妥的 AI 使用习惯。',
          teachConceptIds: ['concept-hallucination'],
          assessmentTargetIds: ['concept-hallucination'],
          cards: [
            systemCard('ai-card-10', 'AI 会一本正经地说错话', '幻觉不是"偶尔口误"，而是模型在信息不足或判断失误时，仍然流畅地生成了看似合理但并不准确的内容。', ['concept-hallucination']),
            systemCard('ai-card-11', '越关键的信息，越要二次校验', '医疗、法律、财务、简历投递、公开发布内容，这些场景都不该把 AI 回答当成直接事实，而要把它当"草稿或线索"。', ['concept-hallucination']),
            systemCard('ai-card-12', '隐私和权限边界也要一起考虑', '不是所有信息都适合直接贴给 AI。涉及客户数据、公司机密、证件隐私和敏感财务信息时，要先确认产品权限和合规边界。', ['concept-hallucination']),
          ],
          questions: [
            systemQuestion({
              id: 'ai-q-4',
              question: '在下面哪种场景里，最应该对 AI 输出做二次核验？',
              options: ['A. 想几个朋友圈标题', 'B. 写祝福语草稿', 'C. 根据 AI 建议直接做个人医疗判断', 'D. 把一段话改得更口语化'],
              answer: 'C',
              explanation: '涉及高风险决策时，AI 只能作为辅助，不应该代替专业判断和事实核验。',
              targetConceptId: 'concept-hallucination',
              cardId: 'ai-card-11',
              concept: '幻觉与校验',
              difficulty: 2,
              dimension: 'application',
            }),
          ],
        },
      },
    ),
  },
  {
    recommendation: {
      courseId: 'system-personal-finance',
      title: '普通人应该如何理财',
      summary: '给打工人的普世理财方法，先稳住现金流，再用长期复利慢慢把资产做厚。',
      badge: '系统推荐',
      cta: '开始这门课',
    },
    bundle: createSystemBundle(
      {
        courseId: 'system-personal-finance',
        topic: '普通人应该如何理财',
        learnerPositioning: {
          estimatedLevel: 'beginner',
          difficultySummary: '适合想理财但不知道从哪里开始的普通打工人。',
          whyThisCourseFits: '先解决现金流和风险，再理解复利与长期配置，避免一上来追热点。',
        },
        courseGoal: '学完后能搭出一个适合普通人的理财基本盘：先防守，再积累，最后靠长期复利慢慢变厚。',
        globalConcepts: [
          { id: 'concept-cashflow', name: '现金流与应急金', aliases: ['应急储备'] },
          { id: 'concept-debt', name: '债务与消费决策', aliases: ['负债管理'] },
          { id: 'concept-compound', name: '长期复利', aliases: ['复利'] },
          { id: 'concept-allocation', name: '资产配置与风险', aliases: ['配置'] },
        ],
        nodes: [
          {
            index: 0,
            title: '先把现金流和应急金稳住',
            teachingGoal: '理解理财的第一步不是投资，而是先让生活不被突发情况打断。',
            teachConceptIds: ['concept-cashflow'],
            prerequisiteConceptIds: [],
            assessmentTargetIds: ['concept-cashflow'],
            bridgeFromPreviousNode: '从最基础也最容易被忽视的现金流开始。',
            personalizationHooks: { mustRemediateConceptIds: [], canCompressKnownConceptIds: [], analogyFactIds: [] },
            status: 'available',
          },
          {
            index: 1,
            title: '消费、负债和理财先后顺序',
            teachingGoal: '建立"先处理高成本负债，再谈投资收益"的基本判断。',
            teachConceptIds: ['concept-debt'],
            prerequisiteConceptIds: ['concept-cashflow'],
            assessmentTargetIds: ['concept-debt'],
            bridgeFromPreviousNode: '现金流稳住后，下一步是别让高成本负债不断漏钱。',
            personalizationHooks: { mustRemediateConceptIds: ['concept-debt'], canCompressKnownConceptIds: [], analogyFactIds: [] },
            status: 'locked',
          },
          {
            index: 2,
            title: '为什么普通人更该耐心追求复利',
            teachingGoal: '理解复利不是暴富技巧，而是让时间替你工作。',
            teachConceptIds: ['concept-compound'],
            prerequisiteConceptIds: ['concept-cashflow', 'concept-debt'],
            assessmentTargetIds: ['concept-compound'],
            bridgeFromPreviousNode: '堵住漏洞之后，才谈得上让资金稳定积累。',
            personalizationHooks: { mustRemediateConceptIds: [], canCompressKnownConceptIds: [], analogyFactIds: [] },
            status: 'locked',
          },
          {
            index: 3,
            title: '给自己搭一个能长期坚持的理财系统',
            teachingGoal: '把现金流、风险和长期配置组合成一个普通人可执行的框架。',
            teachConceptIds: ['concept-allocation'],
            prerequisiteConceptIds: ['concept-cashflow', 'concept-compound'],
            assessmentTargetIds: ['concept-allocation'],
            bridgeFromPreviousNode: '当你理解了积累逻辑，就该把钱放进一个能长期执行的系统里。',
            personalizationHooks: { mustRemediateConceptIds: [], canCompressKnownConceptIds: [], analogyFactIds: [] },
            status: 'locked',
          },
        ],
        coverage: {
          introducedConceptIds: ['concept-cashflow', 'concept-debt', 'concept-compound', 'concept-allocation'],
          assessedConceptIds: ['concept-cashflow', 'concept-debt', 'concept-compound', 'concept-allocation'],
          remediatedConceptIds: ['concept-debt'],
        },
        generationNotes: {
          compressedKnownConceptIds: [],
          emphasizedRiskConceptIds: ['concept-debt'],
          selectedAnalogyFactIds: [],
        },
      },
      {
        0: {
          courseId: 'system-personal-finance',
          nodeIndex: 0,
          title: '先把现金流和应急金稳住',
          teachingGoal: '理解理财的第一步不是投资，而是先让生活不被突发情况打断。',
          teachConceptIds: ['concept-cashflow'],
          assessmentTargetIds: ['concept-cashflow'],
          cards: [
            systemCard('fin-card-1', '理财不是一开始就买产品', '很多人一想到理财，就先去找基金、股票、保险或高收益产品。但对普通人来说，真正的起点通常是先把每月现金流看清楚。', ['concept-cashflow']),
            systemCard('fin-card-2', '应急金是你的防守层', '应急金不是"躺着浪费"，而是在失业、生病、家庭突发支出时，避免你被迫借钱、卖资产或者中断长期计划。', ['concept-cashflow']),
            systemCard('fin-card-3', '先活得稳，后面才谈得上复利', '如果你每次一有突发情况就打乱节奏，再好的投资计划也会被迫中断。普通人的理财系统必须先保证稳。', ['concept-cashflow']),
          ],
          questions: [
            systemQuestion({
              id: 'fin-q-1',
              question: '对普通打工人来说，理财最先该做的通常是什么？',
              options: ['A. 找高收益机会', 'B. 先看清现金流并建立应急金', 'C. 一开始就满仓长期投资', 'D. 先追热门板块'],
              answer: 'B',
              explanation: '理财的起点通常不是追收益，而是先让生活现金流和风险承受能力稳定下来。',
              targetConceptId: 'concept-cashflow',
              cardId: 'fin-card-2',
              concept: '现金流与应急金',
              difficulty: 1,
            }),
          ],
        },
        1: {
          courseId: 'system-personal-finance',
          nodeIndex: 1,
          title: '消费、负债和理财先后顺序',
          teachingGoal: '建立"先处理高成本负债，再谈投资收益"的基本判断。',
          teachConceptIds: ['concept-debt'],
          assessmentTargetIds: ['concept-debt'],
          cards: [
            systemCard('fin-card-4', '高利率负债会吃掉你的努力', '如果你一边背着高利率消费贷或信用卡分期，一边追求年化 5% 或 8% 的投资收益，很多时候是在拿水桶接漏水的船。', ['concept-debt']),
            systemCard('fin-card-5', '消费选择也是理财的一部分', '理财不只是"投资什么"，还包括"少踩什么坑"。冲动消费、长期分期、把面子支出当刚需，都会拖慢积累速度。', ['concept-debt']),
            systemCard('fin-card-6', '先后顺序比技巧更重要', '普通人更需要建立顺序：先稳现金流，再处理高成本负债，再进入长期投资，而不是所有动作一起做。', ['concept-debt']),
          ],
          questions: [
            systemQuestion({
              id: 'fin-q-2',
              question: '下面哪种做法更符合普通人的理财顺序？',
              options: ['A. 一边背高利率分期，一边先追投资收益', 'B. 先处理高成本负债，再谈长期投资', 'C. 不用看负债，理财只看收益率', 'D. 理财和消费是两回事'],
              answer: 'B',
              explanation: '高成本负债会持续侵蚀资产增长，通常应优先处理。',
              targetConceptId: 'concept-debt',
              cardId: 'fin-card-6',
              concept: '债务与消费决策',
              difficulty: 2,
              dimension: 'application',
            }),
          ],
        },
        2: {
          courseId: 'system-personal-finance',
          nodeIndex: 2,
          title: '为什么普通人更该耐心追求复利',
          teachingGoal: '理解复利不是暴富技巧，而是让时间替你工作。',
          teachConceptIds: ['concept-compound'],
          assessmentTargetIds: ['concept-compound'],
          cards: [
            systemCard('fin-card-7', '复利的核心不是"神奇收益"', '复利真正厉害的地方，不在于某一年赚很多，而在于长期稳定累积后，后面的增长开始建立在前面积累之上。', ['concept-compound']),
            systemCard('fin-card-8', '时间是普通人最重要的资产', '普通人很难靠一次判断改变命运，但可以靠十年、二十年的长期积累，把时间变成自己最强的伙伴。', ['concept-compound']),
            systemCard('fin-card-9', '追热点往往和复利相反', '频繁切换、追短期故事、因为情绪中断计划，都会破坏复利最需要的"持续"和"稳定"。', ['concept-compound']),
          ],
          questions: [
            systemQuestion({
              id: 'fin-q-3',
              question: '复利最依赖的条件是什么？',
              options: ['A. 每次都抓到最热机会', 'B. 长期、稳定、持续投入', 'C. 一年翻倍两三次', 'D. 只要高风险就一定更快'],
              answer: 'B',
              explanation: '复利依赖的是长期和稳定，而不是短期暴涨。',
              targetConceptId: 'concept-compound',
              cardId: 'fin-card-8',
              concept: '长期复利',
              difficulty: 1,
            }),
          ],
        },
        3: {
          courseId: 'system-personal-finance',
          nodeIndex: 3,
          title: '给自己搭一个能长期坚持的理财系统',
          teachingGoal: '把现金流、风险和长期配置组合成一个普通人可执行的框架。',
          teachConceptIds: ['concept-allocation'],
          assessmentTargetIds: ['concept-allocation'],
          cards: [
            systemCard('fin-card-10', '理财系统的目标是"能坚持"', '好系统不是最复杂的，而是你能按月、按年执行下去的。它应该让你少靠情绪，多靠规则。', ['concept-allocation']),
            systemCard('fin-card-11', '先想清楚风险承受能力', '能承受多大波动、多久会用钱、家庭责任重不重，这些都比"别人买什么"更重要。', ['concept-allocation']),
            systemCard('fin-card-12', '配置是为了让你不靠单点押注', '普通人更适合通过分散配置和长期纪律，而不是把未来押在某一个短期高光资产上。', ['concept-allocation']),
          ],
          questions: [
            systemQuestion({
              id: 'fin-q-4',
              question: '对普通人来说，资产配置更重要的意义是什么？',
              options: ['A. 把所有钱押在最热门资产上', 'B. 通过分散和纪律降低单点押注风险', 'C. 只要买得多就一定安全', 'D. 完全不用考虑自己多久会用钱'],
              answer: 'B',
              explanation: '资产配置的关键是把风险和目标放进同一个系统里，而不是依赖单点押注。',
              targetConceptId: 'concept-allocation',
              cardId: 'fin-card-12',
              concept: '资产配置与风险',
              difficulty: 2,
              dimension: 'application',
            }),
          ],
        },
      },
    ),
  },
];

export function getSystemCourseRecommendations(): SystemCourseRecommendation[] {
  return SYSTEM_COURSE_LIBRARY.map((item) => ({ ...item.recommendation }));
}
