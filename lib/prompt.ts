// lib/prompt.ts

import type { UserProfile } from '../types/course';

export function buildProfileInsightPrompt(profile: UserProfile): string {
  return `你是学习规划专家，从用户信息中提取与课程相关的洞察。

要求：只提取事实不推测，清晰总结不遗漏关键信息，不延伸推理。

目标岗位：${profile.targetJob || '未填写'}

工作经历：
${profile.workExperience?.length ? profile.workExperience.map(w => `- ${w.company}，${w.position}${w.description ? '，内容：' + w.description : ''}`).join('\n') : '暂无'}

教育背景：
${profile.education?.length ? profile.education.map(e => `- ${e.school}，${e.major}`).join('\n') : '暂无'}

用中文总结：

1. knowledgeBackground：基于工作和教育背景的关键事实（做什么产品、有什么技能、什么领域），保持事实性不推理"是否有用"

2. analogyExperiences：用户真实经历（具体做过的事），不加引申

3. summary：一句话总结用户背景

输出JSON：
{
  "knowledgeBackground": ["总结1", "总结2"],
  "analogyExperiences": ["经历1", "经历2"],
  "summary": "一句话总结"
}`;
}
