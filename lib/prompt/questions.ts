import type { LearningCard } from '../../types/course';

export function buildQuestionsPrompt(
  topic: string,
  nodeInfo: {
    teachingGoal: string;
    teachConceptIds: string[];
    prerequisiteConceptIds: string[];
  },
  cards: LearningCard[]
): string {
  const cardsSection = `## 学习内容\n${cards.map(c => `【${c.title}】\n${c.content}`).join('\n\n')}`;

  return `你是 AI 导师，请基于学习内容生成问题。

主题：${topic}
节点目标：${nodeInfo.teachingGoal}
${cardsSection}

## 问题要求
- 基于上述学习内容出题
- 问题必须与知识强相关
- 3-5 道题，覆盖核心知识点
- 问题类型：single（单选）、multiple（多选）、sorting（排序）
- **不需要生成 explanation**（答错后会引导用户使用 AI 助理）

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
