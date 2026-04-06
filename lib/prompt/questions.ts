import type { LearningCard } from '../../types/course';

export interface QuestionsPromptPayload {
  courseName?: string;
  nodeTitle: string;
  teachingGoal: string;
  userInsights?: string;
}

export function buildQuestionsPrompt(
  topic: string,
  cards: LearningCard[],
  payload: QuestionsPromptPayload
): string {
  const { courseName, nodeTitle, teachingGoal, userInsights } = payload;
  const cardsSection = cards.map(c => `【${c.title}】\n${c.content}`).join('\n\n');

  return `你是一名专业的 AI 老师，负责为学生学习的章节知识生成练习题。

## 当前课程&章节信息
课程名称：${courseName || topic}
章节名称：${nodeTitle}
章节目标：${teachingGoal}

## 章节学习内容
${cardsSection}

## 用户情况
- 个人信息：${userInsights || '暂无'}

## 练习题要求
- 根据当前章节学习内容，生成2-5个练习题。题目和学习内容强相关
- 问题清晰准确，不传播错误或未知信息
- 问题类型：single（单选）、multiple（多选）、sorting（排序）
- 出题时，可以使用用户更熟悉的案例

## 出题风格
- 使用自然语言，避免生硬术语，让用户容易理解
- 对重点内容、结论使用加粗或特殊标记强调
- 选项中不要包含"A、B、C"或"1、2、3"的序号

## 输出格式
{
  "questions": [{
    "id": "q-1",
    "type": "single|multiple|sorting",
    "question": "题干",
    "options": ["A", "B", "C", "D"],
    "answer": "答案"
  }]
}

只返回 JSON。`;
}
