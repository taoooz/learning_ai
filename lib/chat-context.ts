// lib/chat-context.ts

import type { ChatMessage } from '@/types/chat';
import type { ChatMemoryPayload, ConversationSummary, CourseTree, MemoryStoreV2, MemoryStoreV3, UserMemory } from '@/types/course';

interface ContextInfo {
  currentNodeTitle?: string;
  currentNodeGoal?: string;
  questionContext?: {
    type: 'correct' | 'incorrect';
    question: string;
    correctAnswer?: string;
    userAnswer?: string;
    answer?: string;
    options?: string[];
  };
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
  chatHistory: ChatMessage[],
  contextInfo?: ContextInfo,
  conversationSummary?: ConversationSummary,
  chatMemoryPayload?: ChatMemoryPayload,
): string {
  if (chatMemoryPayload) {
    let questionContextSection = '';
    if (contextInfo?.questionContext) {
      const qc = contextInfo.questionContext;
      if (qc.type === 'correct') {
        questionContextSection = `\n## 题目上下文（用户答对）
题目：${qc.question}
正确答案：${qc.answer || qc.correctAnswer}
选项：${qc.options?.join(', ') || '无'}

**回答策略**：用户答对了，说明基础理解没问题。请：
1. 整体讲解这道题考察的知识点和应用场景
2. 补充相关的进阶知识或常见误区
3. 引导用户思考更深层次的问题`;
      } else {
        questionContextSection = `\n## 题目上下文（用户答错）
题目：${qc.question}
正确答案：${qc.correctAnswer}
用户答案：${qc.userAnswer}
选项：${qc.options?.join(', ') || '无'}

**回答策略**：用户答错了，需要针对性讲解。请：
1. 分析用户为什么会选择「${qc.userAnswer}」（常见误区）
2. 讲解正确答案「${qc.correctAnswer}」的原理
3. 用简单类比帮助用户理解
4. 给出记忆技巧或判断方法`;
      }
    }

    const currentNodeContent = contextInfo?.currentNodeTitle
      ? `\n## 当前学习节点\n节点：${contextInfo.currentNodeTitle}${contextInfo.currentNodeGoal ? `\n目标：${contextInfo.currentNodeGoal}` : ''}`
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
回答要求：简洁有力（100字以内）、亲切自然、启发式回应。
回答结束：用启发式的延续话语结束（如"你觉得呢？""试试看？"），而不是直接抛出新问题。
优先策略：先处理“用户记忆重点”里的高风险概念和误区；如果历史问题与当前问题相近，沿用原有解释路径，不要从零开始。

## 当前课程信息
难度：${course.difficultySummary || '未知'}

## 当前学习场景${currentNodeContent}${questionContextSection}

${buildStructuredMemorySection(chatMemoryPayload)}

## 对话历史
${summarySection}

请基于以上信息，简洁回答用户当前问题。`.trim();
  }

  return `你是课程学习助理。请简洁回答用户问题。`;
}
