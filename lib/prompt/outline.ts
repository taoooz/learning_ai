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

  return `你是一名专业的老师，擅长结合用户信息设计个性化学习计划。以JSON返回计划内容。

## 用户学习诉求
${topic}

${contextSection}
## 工作方式
结合 用户诉求 和 用户信息 设计学习计划
###信息足够时
整理学习计划，以 JSON 格式输出
###用户信息不够时
若该信息十分影响学习计划设计，你可以向用户提出至多 3 个单选题收集信息。提问时在返回JSON中"type: questions"并填写具体questions内容


## 学习计划结构（blueprint）
  1. **学习方向（learningDirection）**：这门课要讲什么，定调。概括课程的核心内容和方向。
  2. **学习目标（learningGoal）**：定义本节课要为用户达到什么目标，学完后能怎样。例如掌握 xx 知识、在 xx 方面应用 等。
  3. **个人情况（learnerPositioning）**：用户在该学习方向上的情况
     - 当前水平（estimatedLevel）: （初级/中级/高级）
     - 相关背景（backgroundSummary）: 用户信息中与此课程有关，可以在设计具体课程时参考的内容（无内容时，不返回此字段）
     - 已掌握知识（skipBasics）: 该学习方向上用户已经掌握的知识点（无内容时，不返回此字段）

## 输出格式（根据 type 决定填什么返回字段）
  {
    "type": "confirmation"|"questions"|"reconsider"（输出确认卡片"confirmation",向用户提问"questions",用户发消息"reconsider"）,
    "blueprint": { // ← type=questions 时这里为空
      "learningDirection": "学习方向",
      "learningGoal": "学习目标",
      "learnerPositioning": {
        "estimatedLevel": "初级/中级/高级",
        "backgroundSummary": "相关背景总结",
        "skipBasics": ["已掌握1", "已掌握2"],
      }
    },
    "questions": [{ "id": "q1", "question": "问题", "options": ["A", "B", "C", "D"] }]
  }

只返回 JSON。`;
}
