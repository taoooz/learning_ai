// lib/chat-context.ts

import type { ChatMessage } from '@/types/chat';
import type { ChatMemoryPayload, ConversationSummary, CourseTree, MemoryStoreV2, MemoryStoreV3, UserMemory } from '@/types/course';

interface ContextInfo {
  currentNodeTitle?: string;
  currentNodeCards?: string[];
  currentQuestion?: string;
}

function buildStructuredMemorySection(payload?: ChatMemoryPayload): string {
  if (!payload) return '';

  return `## 用户记忆重点
主题摘要：${payload.topicSummary || '暂无'}
当前最该关注的概念：
${payload.focusConceptStates.length
    ? payload.focusConceptStates.map((item) => `- ${item.concept}: ${item.status} (${item.masteryScore})${item.misconceptionHints.length ? `；误区：${item.misconceptionHints.join(' / ')}` : ''}`).join('\n')
    : '暂无'}
高风险概念：${payload.riskConcepts.join('、') || '暂无'}
最近相关提问：${payload.recentQuestionSummaries.join('；') || '暂无'}
可用类比：${payload.analogyHints.join('；') || '暂无'}
偏好解释方式：${payload.preferredExplanationStyles.join('、') || '暂无'}
`;
}

export function buildChatContext(
  course: CourseTree,
  userMemory: UserMemory | MemoryStoreV2 | MemoryStoreV3,
  chatHistory: ChatMessage[],
  contextInfo?: ContextInfo,
  conversationSummary?: ConversationSummary,
  chatMemoryPayload?: ChatMemoryPayload,
): string {
  if (chatMemoryPayload) {
    const courseStructure = course.nodes?.map((n) =>
      `${n.index + 1}. ${n.title} [${n.status === 'completed' ? '已完成' : n.status === 'available' ? '进行中' : '未解锁'}]`,
    ).join('\n') || '';

    const currentNodeContent = contextInfo?.currentNodeTitle
      ? `\n## 当前学习节点\n主题：${contextInfo.currentNodeTitle}${contextInfo.currentNodeCards?.length ? `\n学习内容：\n${contextInfo.currentNodeCards.join('\n')}` : ''}${contextInfo.currentQuestion ? `\n当前问题：${contextInfo.currentQuestion}` : ''}`
      : '';

    const activeMessages = chatHistory.filter((m) => !m.isExpired);
    const expiredSummary = conversationSummary?.summary;
    const historySection = activeMessages.length > 0
      ? activeMessages.map((m) => `${m.role === 'user' ? '用户' : '助理'}：${m.content}`).join('\n')
      : '暂无';
    const summarySection = expiredSummary
      ? `【之前对话摘要】${expiredSummary}\n\n${historySection}`
      : historySection;

    return `你是课程学习助理，基于以下信息帮助用户解答问题。
回答要求：简洁有力（50字以内）、亲切自然。
优先策略：先处理“用户记忆重点”里的高风险概念和误区；如果历史问题与当前问题相近，沿用原有解释路径，不要从零开始。

## 当前课程信息
主题：${course.topic}
课程结构：
${courseStructure || '暂无'}
难度：${course.difficultySummary || '未知'}

## 当前学习场景${currentNodeContent}

${buildStructuredMemorySection(chatMemoryPayload)}

## 对话历史
${summarySection}

请基于以上信息，简洁回答用户当前问题。
回答完毕后，用一句简短的引导性问题结束，启发用户继续探索。`.trim();
  }

  // 1. 提取当前课程相关的兴趣和薄弱点
  const legacyMemory = userMemory as UserMemory;
  const relevantGaps = legacyMemory.extractedInsights.knowledgeGaps
    .filter(g => g.topic === course.topic || g.severity === 'high')
    .slice(0, 3);

  const relevantInterests = legacyMemory.extractedInsights.interests
    .filter(i => i.topic === course.topic)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  // 2. 构建高频问题与 mastery
  const topQuestions = legacyMemory.extractedInsights.questionPatterns
    .filter(q => q.topic === course.topic)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5);

  const masterySignals = legacyMemory.extractedInsights.conceptMastery
    .filter(item => item.topic === course.topic)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);

  // 3. 构建课程结构概览
  const courseStructure = course.nodes?.map(n =>
    `${n.index + 1}. ${n.title} [${n.status === 'completed' ? '已完成' : n.status === 'available' ? '进行中' : '未解锁'}]`
  ).join('\n') || '';

  // 4. 当前节点内容（如果有）
  const currentNodeContent = contextInfo?.currentNodeTitle
    ? `\n## 当前学习节点\n主题：${contextInfo.currentNodeTitle}${contextInfo.currentNodeCards?.length ? `\n学习内容：\n${contextInfo.currentNodeCards.join('\n')}` : ''}${contextInfo.currentQuestion ? `\n当前问题：${contextInfo.currentQuestion}` : ''}`
    : '';

  // 5. 过滤未过期的消息
  const activeMessages = chatHistory.filter(m => !m.isExpired);
  const expiredSummary = conversationSummary?.summary;

  // 6. 构建对话历史
  const historySection = activeMessages.length > 0
    ? activeMessages.map(m => `${m.role === 'user' ? '用户' : '助理'}：${m.content}`).join('\n')
    : '暂无';

  // 如果有过期摘要，添加到历史中
  const summarySection = expiredSummary
    ? `【之前对话摘要】${expiredSummary}\n\n${historySection}`
    : historySection;

  return `你是课程学习助理，基于以下信息帮助用户解答问题。
回答要求：简洁有力（50字以内）、亲切自然。
优先策略：如果用户当前问题和“最近常问”或“待强化概念”有关，优先顺着这些历史难点解释；如果之前已有对话摘要，先延续原有解释脉络，不要重复从零开始。

## 当前课程信息
主题：${course.topic}
课程结构：
${courseStructure || '暂无'}
难度：${course.difficultySummary || '未知'}

## 当前学习场景${currentNodeContent}

## 用户历史记录
兴趣：${relevantInterests.map(i => i.topic).join('、') || '暂无记录'}
薄弱点：${relevantGaps.map(g => g.concept).join('、') || '暂无记录'}
最近常问：${topQuestions.map(q => q.question).join('；') || '暂无记录'}
待强化概念：${masterySignals.filter(item => item.needsReview).map(item => item.concept).join('、') || '暂无记录'}

## 对话历史
${summarySection}

请基于以上信息，简洁回答用户当前问题。
回答完毕后，用一句简短的引导性问题结束，启发用户继续探索。`.trim();
}
