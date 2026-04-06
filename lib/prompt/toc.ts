import type { PlanningMemoryPayload } from '../../types/course';

// TOC API 使用的简化 blueprint 类型（不包含 nodes，nodes 由 TOC API 生成）
interface TocCourseBlueprint {
  learningDirection: string;
  learningGoal: string;
  learnerPositioning: {
    estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
    backgroundSummary: string;
    skipBasics: string[];
  };
}

export function buildTocPrompt(blueprint: TocCourseBlueprint, planningPayload?: PlanningMemoryPayload | null): string {
  const skipBasics = blueprint.learnerPositioning.skipBasics?.filter(Boolean).join('、') || '无';

  let memorySection = '';
  if (planningPayload) {
    const { learnerSnapshot, mustCoverConcepts, skippableBasics, riskConcepts, recentRelevantCourses } = planningPayload;

    memorySection = `

## 用户学习记忆

**学习水平**：${learnerSnapshot.estimatedLevel}（置信度 ${Math.round(learnerSnapshot.confidence * 100)}%）

**必须覆盖的概念**：${mustCoverConcepts.length > 0 ? mustCoverConcepts.join('、') : '无特别要求'}

**可以跳过的基础**：${skippableBasics.length > 0 ? skippableBasics.join('、') : '无'}

**需要重点讲解的风险概念**：${riskConcepts.length > 0 ? riskConcepts.join('、') : '无'}

**最近学习的相关课程**：
${recentRelevantCourses.length > 0 ? recentRelevantCourses.map(c => `- ${c.topic}：${c.summary}`).join('\n') : '无相关历史'}

**个性化要求**：
- 根据学习水平调整章节难度和深度
- 优先覆盖必须讲解的概念
- 跳过用户已掌握的基础内容
- 对风险概念增加章节或加强讲解
- 避免与最近课程重复内容`;
  }

  return `你是 AI 导师，请基于课程纲要生成个性化课程目录。

课程纲要：
- 学习方向：${blueprint.learningDirection}
- 学习目标：${blueprint.learningGoal}
- 用户背景：${blueprint.learnerPositioning.backgroundSummary || '未提供'}
- 难度定位：${blueprint.learnerPositioning.estimatedLevel}
- 已跳过基础：${skipBasics}${memorySection}

## 任务
1. 生成课程名称（简洁有吸引力，8-15字，不要包含"课程"二字）
2. 生成课程描述（一句话，15-30字，说明学完能做什么）
3. 设计个性化课程章节结构（5-12个章节，取决于主题复杂度和用户水平）
4. 每个章节要有具体的学习目标和详细描述

## 章节设计原则
- 由浅入深，循序渐进
- 每个章节有明确的学习目标
- 章节之间有清晰的逻辑衔接
- **根据用户学习记忆调整章节顺序和难度**
- **跳过用户已掌握的基础内容**
- **对风险概念增加讲解深度或独立章节**
- **避免与用户最近学习的课程重复**

## 输出格式
{
  "courseName": "课程名称",
  "courseDescription": "课程描述",
  "nodes": [{ "index": 0, "title": "节点标题", "teachingGoal": "节点学习目标", "description": "节点详细描述" }]
}

只返回 JSON。`;
}
