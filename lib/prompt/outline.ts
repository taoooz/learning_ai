import type {
  ClarificationAnswer,
  PlanningMemoryPayload,
  UserProfile,
} from '../../types/course';
import { buildPlanningMemorySection, buildProfileSection } from './shared';

export function buildOutlinePrompt(
  topic: string,
  userProfile: UserProfile | null,
  planningPayload: PlanningMemoryPayload,
  options?: { clarificationAnswers?: ClarificationAnswer[]; userMessage?: string }
): string {
  const sections: string[] = [];

  const profileSection = buildProfileSection(userProfile);
  if (profileSection.trim()) sections.push(profileSection);

  const memorySection = buildPlanningMemorySection(planningPayload);
  if (memorySection.trim()) sections.push(memorySection);

  if (options?.clarificationAnswers?.length) {
    sections.push(`## 用户回答\n${options.clarificationAnswers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n')}`);
  }

  if (options?.userMessage) {
    sections.push(`## 用户补充信息\n${options.userMessage}`);
  }

  const contextSection = sections.length ? `\n${sections.join('\n\n')}\n` : '';

  return `你是 AI 导师，请基于用户背景生成课程纲要。
${contextSection}
主题：${topic}

## 课程纲要结构（只需要这三项，不需要章节结构）

1. **学习方向（learningDirection）**：这门课要讲什么，定调。用一句话概括课程的核心内容和方向。
2. **学习目标（learningGoal）**：服务用户的什么目标，为什么用户需要学这个，学完能做什么。
3. **个人基础（learnerPositioning）**：根据用户背景判断
   - estimatedLevel: 用户当前水平（novice/beginner/intermediate/advanced）
   - difficultySummary: 一句话描述难度和适合的用户群体
   - backgroundSummary: 用户的背景知识、学习偏好
   - skipBasics: 已掌握的、可跳过的基础内容
   - whyThisCourseFits: 为什么这门课适合这个用户

## 决策规则
- 信息足够 → 输出确认卡片 type: "confirmation"
- 有不确定且影响课程质量的信息 → 输出选择题 type: "questions"（最多3道，必须是选择题）
- 用户发消息 → type: "reconsider"

## 输出格式（confirmation 时没有 nodes）
{
  "type": "confirmation"|"questions"|"reconsider",
  "blueprint": {
    "learningDirection": "学习方向描述",
    "learningGoal": "学习目标描述",
    "learnerPositioning": {
      "estimatedLevel": "novice|beginner|intermediate|advanced",
      "difficultySummary": "难度描述",
      "backgroundSummary": "个人基础总结",
      "skipBasics": ["已跳过1", "已跳过2"],
      "whyThisCourseFits": "为什么适合"
    }
  },
  "questions": [{ "id": "q1", "question": "问题", "options": ["A", "B", "C", "D"] }]
}

只返回 JSON。`;
}
