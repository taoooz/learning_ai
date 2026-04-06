export function buildCardsPrompt(
  topic: string,
  nodeInfo: {
    teachingGoal: string;
    teachConceptIds: string[];
    prerequisiteConceptIds: string[];
  },
  learnerBackground: {
    backgroundSummary: string;
    skipBasics: string[];
  },
  prevNodeSummary?: { title: string; concepts: string[] },
  nextNodeSummary?: { title: string; concepts: string[] },
): string {
  let prevSection = '';
  if (prevNodeSummary) {
    prevSection = `## 前一节点（避免重复）\n${prevNodeSummary.title}：${prevNodeSummary.concepts.join('、')}\n`;
  }

  let nextSection = '';
  if (nextNodeSummary) {
    nextSection = `## 后一节点（衔接顺畅）\n${nextNodeSummary.title}：${nextNodeSummary.concepts.join('、')}\n`;
  }

  return `你是 AI 导师，请生成学习内容。

主题：${topic}
节点目标：${nodeInfo.teachingGoal}
前置概念：${nodeInfo.prerequisiteConceptIds.join('、') || '无'}

## 个人基础（用熟悉的术语和例子）
${learnerBackground.backgroundSummary}
跳过的内容：${learnerBackground.skipBasics.join('、') || '无'}
${prevSection}${nextSection}
## 内容要求
- 生成 5-8 张学习卡片
- 每张卡片包含 title、content（Markdown，150-400字）
- 可添加 visualization 字段辅助理解
- 内容循序渐进，避免与前后节点重复
- 使用用户熟悉的术语和例子

## 可视化类型
- flowchart: 流程图
- timeline: 时间线
- comparison: 对比表
- keyPoints: 核心要点

## 输出格式
{
  "cards": [{ "id": "card-1", "title": "标题", "content": "内容", "visualization": {...} }]
}

只返回 JSON。`;
}
