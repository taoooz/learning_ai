import type {
  ClarificationAnswer,
  PlanningMemoryPayload,
  UserMemory,
  UserProfile,
} from '../../types/course';
import {
  buildMemorySection,
  buildPageFetchSection,
  buildPlanningMemorySection,
  buildSearchJudgmentSection,
  buildSearchResultsSection,
} from './shared';

/** @deprecated 使用 outline + toc 流程替代 */
export function buildCourseTreePrompt(
  topic: string,
  userProfile?: UserProfile | null,
  clarificationAnswers?: ClarificationAnswer[],
  userMemory?: UserMemory | null,
  searchResults?: string,
  pageContents?: string,
  planningPayload?: PlanningMemoryPayload | null,
): string {
  let insightSection = '';
  let clarificationSection = '';
  const memorySection = planningPayload
    ? buildPlanningMemorySection(planningPayload)
    : buildMemorySection(topic, userMemory);

  if (userProfile?.insights) {
    const { knowledgeBackground, analogyExperiences } = userProfile.insights;
    insightSection = `
## 用户洞察

知识背景：
${knowledgeBackground?.length ? knowledgeBackground.map(k => `- ${k}`).join('\n') : '暂无相关背景'}

类比经历：
${analogyExperiences?.length ? analogyExperiences.map(a => `- ${a}`).join('\n') : '暂无相关经历'}
`;
  }

  if (clarificationAnswers?.length) {
    clarificationSection = `
## 用户澄清回答

${clarificationAnswers.map(a => `问题：${a.question}\n回答：${a.answer}`).join('\n\n')}

请结合以上信息重新评估用户经验水平，直接生成课程。
`;
  }

  let searchSection = '';
  if (pageContents) {
    searchSection = buildPageFetchSection(pageContents);
  } else if (searchResults) {
    searchSection = buildSearchResultsSection(searchResults);
  } else {
    searchSection = buildSearchJudgmentSection();
  }

  return `${insightSection}${memorySection}${clarificationSection}你是AI导师，创建个性化学习路径。

主题：${topic}

## 结构决策
- 节点数：5-15（取决于主题复杂度）
- 每节点卡片：8-12张
- 节点间有清晰逻辑顺序

## 质量标准
- 结构清晰：由浅入深，环环相扣
- 目标明确：每节点有清晰学习目标
- 可实践：能解决真实问题

## 个性化课程设计要求
- 先判断用户当前起点，再决定从哪里开始讲
- 先消化"课程规划输入"，再决定课程结构
- 避免完整重讲用户已经掌握的内容，可压缩为快速回顾
- 若存在薄弱点，必须显式安排补基础或纠正常见误解的节点
- 优先使用用户真实经历做类比，帮助抽象概念落地
- 若主题与用户目标岗位相关，节点命名和案例优先贴近该岗位真实任务
- difficultySummary 必须体现"为什么这门课是这个难度"和"课程针对哪类起点用户"
- 每个节点标题要体现阶段目标，避免空泛标题如"进阶篇""补充内容"
- 先在内部判断：哪些内容可以跳过、哪些必须补上、哪些地方必须换成用户熟悉的类比
- 为每个节点确定：目标、前置依赖、与用户背景的连接点；再输出最终课程
- 至少 2 个节点明确写出将使用的用户经历类比，但不要把类比写进 JSON 字段，只体现在节点设计里
- 当前用户想学的主题始终是主轴，不要把课程改写成其他历史主题
- 与当前主题弱相关的 memory 只能用于类比或解释风格，不能据此新增不相关节点
- 与当前主题无关的 memory 直接忽略，不要强行建立牵强联系

## 输出格式

可直接生成时输出：
{
  "courseId": "唯一ID",
  "topic": "${topic}",
  "difficultySummary": "难度描述（中文）",
  "totalNodes": 数字,
  "nodes": [{"index": 0, "title": "标题", "cardCount": 8-12, "status": "locked"}]
}

需要更多信息时输出：
{
  "questions": [{"id": "q1", "question": "问题（最多3个）", "type": "single|multiple", "options": ["A", "B", "C", "D"]}]
}

**澄清问题优先使用选择题，只在无法设计选项时用填空题。**

只返回JSON。
${searchSection}`;
}
