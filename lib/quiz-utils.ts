// lib/quiz-utils.ts
// 测验相关工具函数，集中管理答案提取和校验逻辑

import type { Question } from '@/types/course';

/**
 * 从选项文本中提取答案标识符（如 "A. 选项" -> "A"）
 */
export function extractAnswerKey(option: string): string {
  const match = option.match(/^([A-D])[.、：:]\s*/);
  return match ? match[1] : option;
}

/**
 * 检查用户答案是否正确
 */
export function checkIsCorrect(question: Question, selectedAnswer: string[]): boolean {
  const answer = question.answer;

  if (question.type === 'single') {
    const selected = selectedAnswer[0];
    const selectedKey = extractAnswerKey(selected);
    return selectedKey === answer || selected === answer;
  }

  if (question.type === 'multiple' && Array.isArray(answer)) {
    const selectedKeys = selectedAnswer.map(extractAnswerKey);
    const correctKeys = answer;
    return (
      selectedKeys.length === correctKeys.length &&
      selectedKeys.every((k) => correctKeys.includes(k))
    );
  }

  if (question.type === 'sorting' && Array.isArray(answer)) {
    return (
      selectedAnswer.length === answer.length &&
      selectedAnswer.every((item, index) => extractAnswerKey(item) === answer[index])
    );
  }

  return false;
}

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
