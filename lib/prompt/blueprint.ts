import type { CourseBlueprintPromptPayload } from '../../types/course';

export function buildCompactCourseBlueprintPrompt(topic: string, payload: CourseBlueprintPromptPayload): string {
  return `你需要生成一份课程目录大纲，只返回 JSON。

主题：${topic}
用户水平：${payload.learnerSnapshot.estimatedLevel}
用户目标：${payload.learnerSnapshot.targetGoal || '未提供'}

个性化要求：
- 必须覆盖：${payload.mustCoverConceptNames.join('、') || '无'}
- 高风险概念（需特别注意）：${payload.riskConceptNames.join('、') || '无'}
- 可快速跳过：${payload.skippableConceptIds.join(', ') || '无'}
- 用户背景类比：${payload.analogyFacts.map((item) => item.text).join('；') || '无'}
- 相关历史课程：${payload.recentEpisodes.map((item) => item.summary).join('；') || '无'}

生成建议：
- 根据主题复杂度生成 5~15 个节点
- 输出内容使用中文
- 课程名称建议在10字以内
- 每个节点标题建议在20字以内
- 简要整理 courseGoal 内容
- 每个 teachingGoal 简要整理

输出格式：
{
  "courseName": "课程名称",
  "courseGoal": "一句话描述",
  "nodes": [{
    "title": "具体标题",
    "teachingGoal": "一句话目标"
  }]
}

只返回 JSON。`;
}
