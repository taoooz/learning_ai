import type { UserProfile } from '../../types/course';

export function buildProfileInsightPrompt(profile: UserProfile): string {
  return `你是学习规划专家，从用户信息中提取与课程相关的洞察。

**严格要求**：
1. 只提取事实，不推测、不延伸
2. 每条总结必须具体、可操作
3. 过滤空泛描述（如"有丰富经验"）
4. 不重复相似内容

目标岗位：${profile.targetJob || '未填写'}

工作经历：
${profile.workExperience?.length ? profile.workExperience.map(w => `- ${w.company}，${w.position}${w.description ? '，' + w.description : ''}`).join('\n') : '暂无'}

教育背景：
${profile.education?.length ? profile.education.map(e => `- ${e.school}，${e.major}`).join('\n') : '暂无'}

提取以下内容（中文）：

1. **knowledgeBackground**（知识背景）：
   - 具体做过什么产品/系统（如"HR SaaS"、"Agent工作台"）
   - 掌握什么技术/领域（如"ToB产品设计"、"AI基础设施"）
   - 每条 15-30 字，最多 5 条

2. **analogyExperiences**（类比经历）：
   - 具体做过的事（如"负责B2B AI基建"、"带领团队打造企业级AI工具"）
   - 可用于类比教学的真实场景
   - 每条 20-40 字，最多 3 条

3. **summary**（一句话总结）：
   - 核心背景 + 目标方向
   - 30-50 字

**输出JSON**（不要任何其他文字）：
{
  "knowledgeBackground": ["具体知识1", "具体知识2"],
  "analogyExperiences": ["具体经历1", "具体经历2"],
  "summary": "一句话总结"
}`;
}
