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

1. **workSummary**（工作背景总结）：
   - 从工作经历中提取具体的产品/项目/职责（如"负责企业级 Agent 工作台的产品设计"）
   - 提炼掌握的领域和技能（如"ToB SaaS 产品全流程""AI 基础设施规划"）
   - 每条 15-30 字，最多 5 条
   - 如果用户无工作经历，根据目标岗位推断可能的相关背景

2. **educationSummary**（教育背景总结）：
   - 从教育经历中提取相关的专业/方向（如"计算机科学，专注分布式系统"）
   - 提炼与目标岗位相关的学术背景
   - 每条 15-30 字，最多 3 条
   - 如果用户无教育经历，留空数组 []

3. **analogyExperiences**（类比经历）：
   - 具体做过的事（如"负责B2B AI基建"、"带领团队打造企业级AI工具"）
   - 可用于类比教学的真实场景
   - 每条 20-40 字，最多 3 条
   - 如果无相关经历，留空数组 []

4. **learningStyle**（学习风格）：
   - 从工作经历和目标岗位判断用户偏好
   - 可选值："理论型" 或 "实践型" 或 ""（无法判断时留空字符串）

5. **technicalLevel**（技术接受度）：
   - 从工作经历和目标岗位判断用户的技术深度
   - 可选值："入门级"（非技术背景或技术新手）、"业务级"（日常使用技术产品，非开发者）、"专家级"（有技术背景或开发经验）或 ""（无法判断时留空字符串）

6. **valuePriorities**（价值关注点）：
   - 从目标岗位和经历中推断用户最看重的方向（如"落地实践"、"团队协作"、"数据驱动"）
   - 每条 2-6 字，最多 3 条
   - 如果无法推断，留空数组 []

7. **summary**（一句话总结）：
   - 核心背景 + 目标方向
   - 30-50 字

**输出JSON**（不要任何其他文字）：
{
  "workSummary": ["工作背景1", "工作背景2"],
  "educationSummary": ["教育背景1"],
  "analogyExperiences": ["类比经历1"],
  "learningStyle": "理论型",
  "technicalLevel": "业务级",
  "valuePriorities": ["价值方向1", "价值方向2"],
  "summary": "一句话总结"
}`;
}
