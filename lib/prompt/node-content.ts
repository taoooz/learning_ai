import type {
  TeachingMemoryPayload,
  UserMemory,
} from '../../types/course';
import {
  buildMemorySection,
  buildPageFetchSection,
  buildSearchJudgmentSection,
  buildSearchResultsSection,
  buildTeachingMemorySection,
  NodeGenerationContext,
} from './shared';

/** @deprecated 使用 cards + questions 流程替代 */
export function buildNodeContentPrompt(
  topic: string,
  nodeTitle: string,
  cardCount: number,
  insights?: { knowledgeBackground?: string[]; analogyExperiences?: string[] } | null,
  userMemory?: UserMemory | null,
  generationContext?: NodeGenerationContext,
  searchResults?: string,
  pageContents?: string,
  teachingPayload?: TeachingMemoryPayload | null,
): string {
  let insightSection = '';
  const memorySection = teachingPayload
    ? buildTeachingMemorySection(teachingPayload)
    : buildMemorySection(topic, userMemory);

  if (insights) {
    insightSection = `
## 用户洞察

知识背景：
${insights.knowledgeBackground?.length ? insights.knowledgeBackground.map(k => `- ${k}`).join('\n') : '暂无相关背景'}

类比经历：
${insights.analogyExperiences?.length ? insights.analogyExperiences.map(a => `- ${a}`).join('\n') : '暂无相关经历'}
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

  const contextSection = generationContext ? `
## 课程上下文

课程难度：${generationContext.difficultySummary || '未提供'}
整门课程结构：${generationContext.courseOutline?.length ? generationContext.courseOutline.join(' -> ') : '未提供'}
上一节：${generationContext.previousNodeTitle || '无'}
当前节点前置依赖：${generationContext.prerequisiteTitles?.length ? generationContext.prerequisiteTitles.join('、') : '无'}
当前目标：${generationContext.currentNodeGoal || `帮助用户掌握${nodeTitle}`}
下一节：${generationContext.nextNodeTitle || '无'}
` : '';

  return `${insightSection}${memorySection}${contextSection}你是AI导师，创建学习内容。

主题：${topic}
当前节点：${nodeTitle}

请生成${cardCount}张学习卡片和配套Quiz题目。

## 卡片质量标准
1. 场景引入：用具体场景吸引用户
2. 核心概念：简洁准确地定义
3. 避坑提示：指出常见错误
4. 一句话总结
5. 先消化"节点教学输入"，再决定解释顺序
6. 如果用户已掌握某概念，用 1 张卡片内快速唤醒；如果是薄弱点，要增加误区辨析和反例
7. 避免重复讲解上一节已经覆盖的定义和例子，本节应重点推进到新的理解层次
8. 若用户历史背景与本节仅弱相关，只能作为类比素材，不要让内容偏离当前节点主题

卡片格式：title、content（Markdown，150-400字）、imageUrl: null

## 题目设计原则
- 基于本节内容，考查核心概念的理解和应用
- 关注实际应用价值，避免考查人名、时间等琐碎信息
- 考察理解**和应用**，记忆其次
- 能筛选出真正掌握要点的学生
- 每道题必须标注 concept、dimension、difficulty，方便后续更新用户 mastery
- 如果存在用户薄弱点，至少 1 道题直接考查该薄弱点
- 优先把题目绑定到对应卡片，用 cardId 指向相关卡片
- 如果有前置依赖，本节开头先用 1 张卡片衔接，不要默认用户还记得上一节全部细节
- 如果某个 memory 只是弱相关背景，不要据此把题目改造成其他主题

题目类型：single（单选）、multiple（多选）、sorting（排序）
数量：3-5道，覆盖核心知识点

## 输出格式
{
  "cards": [{"id": "card-1", "title": "标题", "content": "Markdown内容", "imageUrl": null}],
  "questions": [{"id": "q-1", "type": "single|multiple|sorting", "question": "题目", "options": ["A", "B", "C", "D"], "answer": "答案(single:字符串, multiple:字符串数组, sorting:排列后的数组)", "explanation": "解析", "concept": "本题考查的核心概念", "dimension": "memory|understanding|application|analysis", "difficulty": 1, "cardId": "card-1"}]
}

## 可视化决策指南

内容适合可视化时选择：
- 流程/步骤 → \`flowchart\`，时间/顺序 → \`sequence\`/\`timeline\`
- 两种方案对比 → \`comparison\`，概念关系 → \`mindmap\`/\`class\`
- 状态变化 → \`state\`，实体关系 → \`er\`，项目规划 → \`gantt\`
- 参数/特性 → \`table\`，核心要点 → \`keyPoints\`，符号说明 → \`legend\`

示例：
| 场景 | 类型 |
|------|------|
| HTTP请求流程 | \`flowchart\` |
| React vs Vue对比 | \`comparison\` |
| HTTP状态码分类 | \`table\` |
| 闭包核心用途 | \`keyPoints\` |

避免过度可视化：少于3个节点、内容已很简单直观时不要用。

可视化格式（可选）：
{
  "cards": [...],
  "visualization": {"type": "类型", "title": "标题", "mermaidCode": "代码", "complex": true/false, "items": [], "rows": [], "columns": [], "events": []}
}

只返回JSON。
${searchSection}`;
}
