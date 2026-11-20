// lib/learning-v2/confusion-signal.ts
// 切片 4：困惑信号检测（响应式重讲触发器）
// 纯函数：从学习流中统计当前任务的连续困惑提问数。
// 连续 ≥2 次困惑 → 前端在 Tutor 请求中携带 reExplain=true，
// 后端 prompt 强制 switch_explanation + 换类比/换表征重讲。

import type { NodeLesson } from '@/types/learning-v2';

/** 困惑关键词：匹配则视为一次困惑信号 */
const CONFUSION_PATTERNS = [
  '没理解',
  '不理解',
  '没听懂',
  '听不懂',
  '看不懂',
  '不明白',
  '不清楚',
  '还是不懂',
  '还是不明白',
  '还是没懂',
  '看不明白',
  '想不明白',
  '什么意思',
  '太难了',
] as const;

/** 判断提问文本是否为困惑信号（纯关键词匹配，不走 LLM） */
export function isConfusionSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return CONFUSION_PATTERNS.some((pattern) => trimmed.includes(pattern));
}

/**
 * 统计当前任务末尾连续困惑提问数。
 * 从最新问题向前扫描：遇到困惑信号 +1，遇到非困惑信号归零，遇到无回答的 pending 问题跳过。
 */
export function countConsecutiveConfusions(lesson: NodeLesson, taskId: string): number {
  const questions = lesson.streamItems
    .filter(
      (item): item is Extract<typeof item, { type: 'user_question' }> =>
        item.type === 'user_question' && item.taskId === taskId,
    )
    .sort((a, b) => b.sequence - a.sequence); // 最新在前

  let count = 0;
  for (const q of questions) {
    if (isConfusionSignal(q.text)) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

/** 重讲触发阈值：连续困惑次数 ≥ 此值时在 Tutor 请求中携带 reExplain */
export const REEXPLAIN_THRESHOLD = 2;
