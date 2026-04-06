import type { PlanningMemoryPayload } from '../../types/course';

// TOC API 使用的简化 blueprint 类型（不包含 nodes，nodes 由 TOC API 生成）
interface TocCourseBlueprint {
  learningDirection: string;
  learningGoal: string;
  learnerPositioning: {
    estimatedLevel: 'novice' | 'beginner' | 'intermediate' | 'advanced';
    backgroundSummary?: string;
    skipBasics?: string[];
  };
}

export function buildTocPrompt(blueprint: TocCourseBlueprint, planningPayload?: PlanningMemoryPayload | null): string {
  const skipBasics = blueprint.learnerPositioning.skipBasics?.filter(Boolean).join('、') || '无';
  const backgroundSummary = blueprint.learnerPositioning.backgroundSummary || '未提供';

  let memorySection = '';
  if (planningPayload) {
    const { learnerSnapshot, mustCoverConcepts, skippableBasics, riskConcepts, recentRelevantCourses } = planningPayload;

    memorySection = `

## 用户学习记忆

**建议覆盖的概念**：${mustCoverConcepts.length > 0 ? mustCoverConcepts.join('、') : '无特别要求'}

**可以跳过的基础**：${skippableBasics.length > 0 ? skippableBasics.join('、') : '无'}

**建议重点讲解的概念**：${riskConcepts.length > 0 ? riskConcepts.join('、') : '无'}

**最近学习的相关课程**：
${recentRelevantCourses.length > 0 ? recentRelevantCourses.map(c => `- ${c.topic}：${c.summary}`).join('\n') : '无相关历史'}`;
  }

  return `你是一名专业的 AI 老师，擅长根据 学习计划 与 用户学习记忆 生成个性化课程章节结构。用于指导后续章节内容创作。

## 学习计划
1. 课程名称：${blueprint.learningDirection}
2. 学习方向：${blueprint.learningDirection}
3. 学习目标：${blueprint.learningGoal}
4. 个人情况：用户在该学习方向上的情况
   - 当前水平: ${blueprint.learnerPositioning.estimatedLevel}
   - 相关背景: ${backgroundSummary}
   - 已掌握知识: ${skipBasics}${memorySection}

## 任务
1. 根据学习计划，进行课程目录设计
2. 生成课程描述（建议30字内，概述该课程）
3. 设计个性化课程章节结构（5-12个章节，取决于主题复杂度和用户水平）

## 课程设计原则
- 章节间循序渐进，有清晰的逻辑衔接
- 每个章节自己有明确的定位
- 尽量避免与用户最近学习的课程重复

## 节点内容设计原则
- 节点标题：避免过度概括，建议25字内
- 节点描述：讲述该章节的学习内容与目标。内容清晰、干练，可用于指导后续具体内容生成

## 输出格式
{
  "courseName": "课程名称",
  "courseDescription": "课程描述",
  "nodes": [{ "index": 1, "title": "节点标题", "description": "节点描述" }]
}

只返回 JSON。`;
}
