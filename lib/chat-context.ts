// lib/chat-context.ts

import { CourseTree, UserMemory, ConversationSummary } from '@/types/course';
import { ChatMessage } from '@/types/chat';

interface ContextInfo {
  currentNodeTitle?: string;
  currentNodeCards?: string[];
  currentQuestion?: string;
}

export function buildChatContext(
  course: CourseTree,
  userMemory: UserMemory,
  chatHistory: ChatMessage[],
  contextInfo?: ContextInfo,
  conversationSummary?: ConversationSummary
): string {
  // 1. 提取当前课程相关的兴趣和薄弱点
  const relevantGaps = userMemory.extractedInsights.knowledgeGaps
    .filter(g => g.topic === course.topic || g.severity === 'high')
    .slice(0, 3);

  const relevantInterests = userMemory.extractedInsights.interests
    .filter(i => i.topic === course.topic)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  // 2. 构建高权重问题模式
  const topQuestions = userMemory.extractedInsights.questionPatterns
    .sort((a, b) => b.timestamp - a.timestamp)
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

## 当前课程信息
主题：${course.topic}
课程结构：
${courseStructure || '暂无'}
难度：${course.difficultySummary || '未知'}

## 当前学习场景${currentNodeContent}

## 用户历史记录
兴趣：${relevantInterests.map(i => i.topic).join('、') || '暂无记录'}
薄弱点：${relevantGaps.map(g => g.concept).join('、') || '暂无记录'}

## 对话历史
${summarySection}

请基于以上信息，简洁回答用户当前问题。
回答完毕后，用一句简短的引导性问题结束，启发用户继续探索。`.trim();
}