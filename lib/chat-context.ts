// lib/chat-context.ts

import type { ChatMessage } from '@/types/chat';
import type { ChatMemoryPayload, ConversationSummary } from '@/types/course';

interface ContextInfo {
  currentNodeTitle?: string;
  currentNodeGoal?: string;
  questionContext?: {
    type: 'correct' | 'incorrect';
    question: string;
    correctAnswer: string | string[];
    userAnswer?: string;
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
  course: { topic: string; difficultySummary?: string },
  chatHistory: ChatMessage[],
  contextInfo?: ContextInfo,
  conversationSummary?: ConversationSummary,
  chatMemoryPayload?: ChatMemoryPayload,
): string {
  if (chatMemoryPayload) {
    let questionContextSection = '';
    if (contextInfo?.questionContext) {
      const qc = contextInfo.questionContext;
      const correctAnswerText = Array.isArray(qc.correctAnswer) 
        ? qc.correctAnswer.join('、') 
        : qc.correctAnswer;
      
      if (qc.type === 'correct') {
        questionContextSection = `\n## 题目上下文（用户答对）
题目：${qc.question}
正确答案：${correctAnswerText}
选项：
${qc.options?.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`).join('\n') || '无'}

回答原则：讲解知识点、补充进阶内容、引导深层思考`;
      } else {
        questionContextSection = `\n## 题目上下文（用户答错）
题目：${qc.question}
正确答案：${correctAnswerText}
用户答案：${qc.userAnswer}
选项：
${qc.options?.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`).join('\n') || '无'}

回答原则：分析误区、讲解原理、给出记忆技巧`;
      }
    }

    const currentNodeContent = contextInfo?.currentNodeTitle
      ? `\n## 当前学习节点\n节点：${contextInfo.currentNodeTitle}${contextInfo.currentNodeGoal ? `\n目标：${contextInfo.currentNodeGoal}` : ''}`
      : '';

    const activeMessages = chatHistory.filter((m) => !m.isExpired);
    const expiredSummary = conversationSummary?.summary;
    
    let historySection = '';
    if (activeMessages.length > 0) {
      // 只显示最近3轮对话
      const recentMessages = activeMessages.slice(-6);
      historySection = recentMessages
        .map((m) => `${m.role === 'user' ? '用户' : '助理'}：${m.content}`)
        .join('\n');
    }
    
    const summarySection = expiredSummary
      ? `${expiredSummary}\n\n最近对话：\n${historySection || '暂无'}`
      : historySection || '暂无';

    return `你是课程学习助理，基于以下信息帮助用户解答问题。
回答要求：简洁有力（100字以内）、亲切自然、启发式回应。
回答结束：用启发式的延续话语结束（如"你觉得呢？""试试看？"），而不是直接抛出新问题。
优先策略：先处理“用户记忆重点”里的高风险概念和误区；如果历史问题与当前问题相近，沿用原有解释路径，不要从零开始。

## 当前课程信息
主题：${course.topic}
难度：${course.difficultySummary || '未知'}

## 当前学习场景${currentNodeContent}${questionContextSection}

${buildStructuredMemorySection(chatMemoryPayload)}

## 对话历史
${summarySection}

请基于以上信息，简洁回答用户当前问题。`.trim();
  }

  return `你是课程学习助理。请简洁回答用户问题。`;
}
