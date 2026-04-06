import type { NodeLessonPromptPayload } from '../../types/course';

export function buildNodeLessonPrompt(topic: string, payload: NodeLessonPromptPayload): string {
  const sections: string[] = [];

  if (payload.analogyFacts.length) {
    sections.push(`## 可用类比\n${payload.analogyFacts.map((item) => `- ${item.text}`).join('\n')}`);
  }

  if (payload.preferredExplanationStyles.length) {
    sections.push(`## 偏好解释方式\n${payload.preferredExplanationStyles.map((item) => `- ${item}`).join('\n')}`);
  }

  if (payload.recentRelevantQuestions.length) {
    sections.push(`## 最近相关提问\n${payload.recentRelevantQuestions.map((item) => `- ${item}`).join('\n')}`);
  }

  const contextSection = sections.length ? `\n${sections.join('\n\n')}\n` : '';

  return `你是 AI 导师，请生成一节 NodeLesson。

主题：${topic}
当前节点：${payload.nodeTitle}
节点目标：${payload.teachingGoal}
${contextSection}
## 内容要求
- 根据提供的课程、用户信息生成该节点课程内容
- 优先判断该节课需要的知识及问题卡片数量。知识建议在 5~8 条，问题 2~5 个。
- 知识卡片内容应循序渐进，尽量避免重复内容
- 每张知识卡片包含 title、content（Markdown，建议 150-400字）
- 知识卡片可根据需要添加 visualization 字段来辅助理解
- 问题必须基于前面知识卡片中的内容来出，确保与知识强相关
- 问题卡片间尽量避免重复内容
- 问题类型：single（单选）、multiple（多选）、sorting（排序）

## 可视化类型说明
- flowchart: 流程图，使用 Mermaid 语法，如 "graph TD; A-->B"
- timeline: 时间线，包含 events 数组，每项有 time/title/description
- comparison: 对比表，包含 columns（列标题）和 rows（行数据）

## 输出 JSON
{
  "courseId": "课程 ID",
  "nodeIndex": 0,
  "title": "${payload.nodeTitle}",
  "teachingGoal": "${payload.teachingGoal}",
  "cards": [{
    "id": "card-1",
    "title": "标题",
    "content": "Markdown 内容",
    "visualization": {
      "type": "flowchart|timeline|comparison",
      "title": "可选标题",
      "mermaidCode": "Mermaid 语法（flowchart 类型时）",
      "events": [{"time": "时间", "title": "事件", "description": "描述"}],
      "columns": ["列1", "列2"],
      "rows": [["行1列1", "行1列2"], ["行2列1", "行2列2"]]
    }
  }],
  "questions": [{
    "id": "q-1",
    "type": "single|multiple|sorting",
    "question": "题干",
    "options": ["A", "B"],
    "answer": "答案",
    "explanation": "解析"
  }]
}

只返回 JSON。`;
}
