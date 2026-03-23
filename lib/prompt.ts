// lib/prompt.ts

import { UserProfile } from '@/types/course';

export function buildCourseTreePrompt(topic: string, userProfile?: UserProfile | null): string {
  let insightSection = '';

  if (userProfile?.insights) {
    const { knowledgeBackground, analogyExperiences } = userProfile.insights;
    insightSection = `
## 用户洞察

知识背景：
${knowledgeBackground && knowledgeBackground.length > 0
  ? knowledgeBackground.map(k => `- ${k}`).join('\n')
  : '暂无相关背景'}

类比经历：
${analogyExperiences && analogyExperiences.length > 0
  ? analogyExperiences.map(a => `- ${a}`).join('\n')
  : '暂无相关经历'}
`;
  }

  return `${insightSection}You are an AI tutor creating a personalized learning path for the topic: "${topic}"

Create a learning course tree with the following structure:
- Minimum 4 nodes, Maximum 8 nodes (decide based on topic complexity)
- Each node represents a learning concept in the topic
- Nodes should be ordered from basic to advanced
- Each node has: title, one-sentence description, cardCount (1-5 based on complexity)

Output a JSON object with this exact structure:
{
  "courseId": "a unique ID",
  "topic": "${topic}",
  "totalNodes": number,
  "nodes": [
    {
      "index": 0,
      "title": "node title",
      "description": "one sentence description",
      "cardCount": number (1-5),
      "status": "locked"
    }
  ]
}

## 质量标准

一个好的学习课程应该：
- **结构清晰**：知识点由浅入深，环环相扣
- **目标明确**：每个节点都有清晰的学习目标
- **可实践**：内容能帮助用户解决真实问题
- **有关联**：与用户已有知识建立联系，便于迁移学习

Return ONLY the JSON object, no additional text.`;
}

export function buildNodeContentPrompt(topic: string, nodeTitle: string, cardCount: number): string {
  return `You are an AI tutor creating learning content for the topic: "${topic}"
The current learning node is: "${nodeTitle}"

Generate exactly ${cardCount} learning cards and quiz questions for this node.

Each card should have:
- title: short title for the card
- content: Markdown formatted explanation (2-3 paragraphs)
- imageUrl: (optional) leave as null

Quiz questions should include:
- Single choice questions (1-2)
- Multiple choice questions (1-2)
- Fill in the blank questions (1-2)

Each question has:
- type: "single" | "multiple" | "fill"
- question: the question text
- options: array of 4 choices (for single/multiple)
- answer: correct answer(s)
- explanation: explanation shown when wrong

Output a JSON object with this exact structure:
{
  "cards": [
    {
      "id": "card-1",
      "title": "card title",
      "content": "markdown content",
      "imageUrl": null
    }
  ],
  "questions": [
    {
      "id": "q-1",
      "type": "single",
      "question": "question text",
      "options": ["A", "B", "C", "D"],
      "answer": "A",
      "explanation": "explanation when wrong"
    }
  ]
}

Return ONLY the JSON object, no additional text.`;
}

export function buildProfileInsightPrompt(profile: UserProfile): string {
  return `你是一个学习规划专家。请从以下用户信息中提取与学习课程相关的洞察。

要求：只提取事实，不要推测。关注与"学习"最相关的信息。

目标岗位：${profile.targetJob || '未填写'}

工作经历：
${profile.workExperience && profile.workExperience.length > 0
  ? profile.workExperience.map(w => `- ${w.company}，${w.position}${w.description ? '，工作内容：' + w.description : ''}`).join('\n')
  : '暂无'}

教育背景：
${profile.education && profile.education.length > 0
  ? profile.education.map(e => `- ${e.school}，${e.major}`).join('\n')
  : '暂无'}

请提取以下信息用于帮助生成个性化课程（用中文回答）：

1. knowledgeBackground：用户已具备的相关知识背景（从工作经历和教育背景中提取的事实）
2. analogyExperiences：用户经历中可用于类比的场景（用熟悉的场景解释陌生概念）
3. summary：一句话总结用户背景特点

输出 JSON 格式：
{
  "knowledgeBackground": ["背景1", "背景2"],
  "analogyExperiences": ["经历场景1", "经历场景2"],
  "summary": "一句话总结"
}`;
}