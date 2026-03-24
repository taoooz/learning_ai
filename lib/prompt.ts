// lib/prompt.ts

import { UserProfile, ClarificationAnswer } from '@/types/course';

export function buildCourseTreePrompt(
  topic: string,
  userProfile?: UserProfile | null,
  clarificationAnswers?: ClarificationAnswer[]
): string {
  let insightSection = '';
  let clarificationSection = '';

  // 用户洞察 section
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

  // 用户澄清回答 section（第二次调用时）
  if (clarificationAnswers && clarificationAnswers.length > 0) {
    clarificationSection = `
## 用户澄清回答

${clarificationAnswers.map(a => `问题：${a.question}\n回答：${a.answer}`).join('\n\n')}

请结合以上回答和原始用户洞察，重新评估：
1. 用户对主题的实际经验水平
2. 课程应有的难度和结构

直接生成课程，不需要再返回问题。
`;
  }

  return `${insightSection}${clarificationSection}你是一位专业的 AI 导师，为用户创建个性化的学习路径。

主题：${topic}

## 课程结构决策指南

**节点数量：**
- 参考范围：5-15 个
- 决策因素：主题本身的复杂度
- 原则：节点之间有清晰的逻辑顺序

**卡片数量：**
- 参考范围：每节点 8-12 张
- 决策因素：内容深度（核心原理需要更多展开）
- 原则：避免单张卡片内容过多

## 质量标准

一个好的学习课程应该：
- **结构清晰**：知识点由浅入深，环环相扣
- **目标明确**：每个节点都有清晰的学习目标
- **可实践**：内容能帮助用户解决真实问题

## 输出格式

如果可以直接生成课程（洞察足够或已有澄清回答），请输出：
{
  "courseId": "唯一ID",
  "topic": "${topic}",
  "difficultySummary": "简要的难度描述（基于用户背景与主题的关联度分析，用中文描述）",
  "totalNodes": 节点数量,
  "nodes": [
    {
      "index": 0,
      "title": "节点标题",
      "cardCount": 数字 (8-12),
      "status": "locked"
    }
  ]
}

如果需要更多信息才能生成课程，请输出：
{
  "questions": [
    {
      "id": "q1",
      "question": "问题文本（必须是与课程设计直接相关的具体问题，最多3个）"
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
1. 场景引入：用具体场景吸引用户
2. 核心概念：简洁准确地定义
3. 避坑提示：指出常见错误
4. 一句话总结

每张卡片包含：
- title：简短的标题
- content：简洁的 Markdown 内容（每张卡片 2-3 段，字数控制在 150-400 字）
- imageUrl：null

## 好 Quiz 质量标准

每道 Quiz 题目必须满足以下标准：
1. 考察维度：覆盖记忆、理解、应用
2. 难度等级：简单、中等、困难比例为 3:5:2
3. 对应卡片：每道题对应特定卡片内容

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
      "content": "简洁的 Markdown 内容，避免使用过多特殊字符",
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
      "explanation": "答错时的解析"
    }
  ]
}

只返回 JSON 对象，不要有其他文本。`;
}

export function buildProfileInsightPrompt(profile: UserProfile): string {
  return `你是一个学习规划专家。请从以下用户信息中提取与学习课程相关的洞察。

要求：
- 只提取事实，不要推测
- 用更清晰的语言总结，不遗漏关键信息
- 不要延伸推理（如"用过 docker"不推导"有容器化基础"，只说"在项目中使用过 Docker"）

目标岗位：${profile.targetJob || '未填写'}

工作经历：
${profile.workExperience && profile.workExperience.length > 0
  ? profile.workExperience.map(w => `- ${w.company}，${w.position}${w.description ? '，工作内容：' + w.description : ''}`).join('\n')
  : '暂无'}

教育背景：
${profile.education && profile.education.length > 0
  ? profile.education.map(e => `- ${e.school}，${e.major}`).join('\n')
  : '暂无'}

请总结以下信息（用中文回答）：

1. knowledgeBackground：基于工作经历和教育背景总结的关键事实
   - 每份工作的实质内容（做什么产品、有什么技能、什么领域）
   - 教育背景中的专业方向
   - 关键信息不遗漏、不延伸
   - 保持事实性，不推理"是否有用"

2. analogyExperiences：用户的真实经历，可作为课程案例素材
   - 描述用户实际做过的具体事情
   - 不加引申

3. summary：一句话总结用户背景特点

输出 JSON 格式：
{
  "knowledgeBackground": ["总结1", "总结2"],
  "analogyExperiences": ["经历1", "经历2"],
  "summary": "一句话总结"
}`;
}