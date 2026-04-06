export interface CardsPromptPayload {
  nodeTitle: string;
  teachingGoal: string;
  courseName?: string;
  courseDescription?: string;
  userInsights?: string;
  estimatedLevel?: string;
  backgroundSummary?: string;
  prevNode?: { title: string; concepts: string };
  nextNode?: { title: string; concepts: string };
}

export function buildCardsPrompt(topic: string, payload: CardsPromptPayload): string {
  const {
    nodeTitle,
    teachingGoal,
    courseName,
    courseDescription,
    userInsights,
    estimatedLevel,
    backgroundSummary,
    prevNode,
    nextNode,
  } = payload;

  const prevSection = prevNode
    ? `### 前一章节（避免重复）\n${prevNode.title}：${prevNode.concepts}\n`
    : '### 前一章节（避免重复）\n无前一章节\n';

  const nextSection = nextNode
    ? `### 后一章节（衔接顺畅，若为空则无后续章节）\n${nextNode.title}：${nextNode.concepts}\n`
    : '';

  return `你是一名专业的 AI 老师。基于当前章节信息，设计该章节个性化教学内容。

## 当前章节信息
章节名称：${nodeTitle}
章节目标：${teachingGoal}

## 课程相关信息
### 课程
课程名称：${courseName || topic}
课程描述：${courseDescription || ''}

${prevSection}${nextSection}
## 用户情况
- 个人信息：${userInsights || '暂无'}
- 课程当前水平：${estimatedLevel || '未知'}
- 课程相关背景：${backgroundSummary || '暂无'}

## 章节内容要求
- 根据当前章节信息，生成5-8个学习页，单页建议 200 字以内，每页可包含md文本和可视化组件
- 教学内容清晰准确，不传播错误或未知信息
- 按照认知规律逐步讲解该章节内容，避免与前后节点重复
- 每页独立完整，按需在内容中使用可视化组件
- 举例时，优先使用用户背景熟悉的例子

## 可视化组件类型
- flowchart: 流程图
- timeline: 时间线
- comparison: 对比表
- keyPoints: 核心要点

## 知识风格
- 采用启发式教学，突出重点
- 语言亲切，激发用户学习动力，避免冗长
- 使用自然语言，避免生硬术语，让用户容易理解
- 使用数字编号或项目分点呈现内容，避免大段文字堆砌
- 对重点内容、结论使用加粗或特殊标记强调

## 输出格式
{
  "cards": [{ "id": "card-1", "title": "标题", "content": "内容", "visualization": {...} }]
}

只返回 JSON。`;
}
