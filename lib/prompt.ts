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

  return `${insightSection}你是一位专业的 AI 导师，为用户创建个性化的学习路径。

主题：${topic}

## 课程结构要求

- 课程包含 4-8 个节点（根据主题复杂度决定）
- 每个节点代表主题中的一个学习概念
- 节点按从基础到进阶的顺序排列
- 每个节点包含：标题、一句话描述、卡片数量（1-5，根据复杂度决定）

## 质量标准

一个好的学习课程应该：
- **结构清晰**：知识点由浅入深，环环相扣
- **目标明确**：每个节点都有清晰的学习目标
- **可实践**：内容能帮助用户解决真实问题
- **有关联**：与用户已有知识建立联系，便于迁移学习

## 输出格式

输出 JSON 对象，结构如下：
{
  "courseId": "唯一ID",
  "topic": "${topic}",
  "totalNodes": 节点数量,
  "nodes": [
    {
      "index": 0,
      "title": "节点标题",
      "description": "一句话描述",
      "cardCount": 数字 (1-5),
      "status": "locked"
    }
  ]
}

只返回 JSON 对象，不要有其他文本。`;
}

export function buildNodeContentPrompt(
  topic: string,
  nodeTitle: string,
  cardCount: number,
  insights?: { knowledgeBackground?: string[]; analogyExperiences?: string[] } | null
): string {
  let insightSection = '';

  if (insights) {
    insightSection = `
## 用户洞察

知识背景：
${insights.knowledgeBackground && insights.knowledgeBackground.length > 0
  ? insights.knowledgeBackground.map(k => `- ${k}`).join('\n')
  : '暂无相关背景'}

类比经历：
${insights.analogyExperiences && insights.analogyExperiences.length > 0
  ? insights.analogyExperiences.map(a => `- ${a}`).join('\n')
  : '暂无相关经历'}
`;
  }

  return `${insightSection}你是一位专业的 AI 导师，为用户创建学习内容。

主题：${topic}
当前学习节点：${nodeTitle}

请为这个节点生成 ${cardCount} 张学习卡片和配套的 Quiz 题目。

## 好卡片质量标准

每张卡片必须满足以下标准：

1. **场景引入**：开头用具体场景或问题吸引用户注意力，建立学习动机
2. **清晰定义**：用简洁准确的语言定义核心概念，避免模糊表述
3. **避坑提示**：指出学习者常犯的错误或容易混淆的概念
4. **一句话总结**：结尾用一句话精炼概括本卡片的要点

每张卡片包含：
- title：简短的标题
- content：Markdown 格式的详细解释（2-3段，按照以上标准）
- imageUrl：（可选）留空为 null

## 好 Quiz 质量标准

每道 Quiz 题目必须满足以下标准：

1. **考察维度**：题目需覆盖不同认知层次（记忆、理解、应用、分析）
2. **难度等级**：合理分布简单、中等、困难题目，比例为 3:5:2
3. **对应卡片**：每道题目需明确对应某张卡片的内容，确保考点覆盖完整

Quiz 题目包含：
- 单选题（1-2道）
- 多选题（1-2道）
- 填空题（1-2道）

## 输出格式

输出 JSON 对象，结构如下：
{
  "cards": [
    {
      "id": "card-1",
      "title": "卡片标题",
      "content": "Markdown 格式内容",
      "imageUrl": null
    }
  ],
  "questions": [
    {
      "id": "q-1",
      "type": "single",
      "question": "题目文本",
      "options": ["A", "B", "C", "D"],
      "answer": "正确答案",
      "explanation": "答错时的解析",
      "dimension": "memory | understanding | application | analysis",
      "difficulty": 1 | 2 | 3,
      "cardId": "对应的卡片ID"
    }
  ]
}

只返回 JSON 对象，不要有其他文本。`;
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