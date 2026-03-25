// lib/chat-context.ts

import { CourseNode, UserMemory } from '@/types/course';
import { ChatMessage } from '@/types/chat';

export function buildChatContext(
  course: CourseNode,
  userMemory: UserMemory,
  chatHistory: ChatMessage[]
): string {
  // 1. 提取当前课程相关的兴趣和薄弱点
  const relevantGaps = userMemory.extractedInsights.knowledgeGaps
    .filter(g => g.topic === course.title || g.severity === 'high')
    .slice(0, 3);

  const relevantInterests = userMemory.extractedInsights.interests
    .filter(i => i.topic === course.title)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  // 2. 构建高权重问题模式
  const topQuestions = userMemory.extractedInsights.questionPatterns
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5);

  return `
## 当前课程
主题：${course.title}
内容：${course.cards?.map(c => `${c.title}: ${c.content}`).join('\n')}

## 用户兴趣（相关）
${relevantInterests.map(i => `- ${i.topic} (权重: ${i.weight})`).join('\n') || '暂无'}

## 知识薄弱点
${relevantGaps.map(g => `- ${g.concept}: ${g.evidence.join(', ')}`).join('\n') || '暂无'}

## 近期问题模式
${topQuestions.map(q => `- [${q.topic}] ${q.question}`).join('\n') || '暂无'}

## 对话历史
${chatHistory.map(m => `${m.role}: ${m.content}`).join('\n')}
`.trim();
}