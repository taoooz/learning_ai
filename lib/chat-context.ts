// lib/chat-context.ts

import { CourseTree, UserMemory } from '@/types/course';
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
  contextInfo?: ContextInfo
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

  return `你是课程学习助理，用简洁友好的语言帮助用户学习。回答应该：
- 简洁有力，直击要点（回复控制在50字以内）
- 亲切自然，像朋友讲解
- 如果需要举例，确保举例贴切

## 课程信息
主题：${course.topic}
课程结构：
${courseStructure || '暂无'}
难度：${course.difficultySummary || '未知'}

## 当前场景${currentNodeContent}

## 用户兴趣（相关）
${relevantInterests.map(i => `- ${i.topic} (权重: ${i.weight})`).join('\n') || '暂无'}

## 知识薄弱点
${relevantGaps.map(g => `- ${g.concept}: ${g.evidence.join(', ')}`).join('\n') || '暂无'}

## 对话历史
${chatHistory.map(m => `${m.role === 'user' ? '用户' : '助理'}: ${m.content}`).join('\n')}

请基于以上信息，用简洁的语言回答用户的问题。`.trim();
}