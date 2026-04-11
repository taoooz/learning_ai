// 直接调用 Python Agent API 生成课程内容，用 MiniMax 生成题目
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_AGENT_URL = "http://localhost:8000";
const OUTPUT_DIR = join(__dirname, "..", "data", "system-courses", "generated");

async function callWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`重试中... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

async function callMiniMax(prompt, maxTokens = 2000) {
  const response = await fetch("https://api.minimaxi.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.MINIMAX_API_KEY}`
    },
    body: JSON.stringify({
      model: "MiniMax-M2.7",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens
    })
  });
  if (!response.ok) {
    throw new Error(`MiniMax API error: ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callCardsApi(topic, payload) {
  return callWithRetry(async () => {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/cards/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, payload }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cards API error: ${response.status}: ${text}`);
    }
    return response.json();
  });
}

function buildQuestionsPrompt(nodeTitle, cards) {
  const cardsText = cards.map(c => `【${c.title}】\n${c.content}`).join("\n\n");
  return `你是AI导师，请根据以下学习内容生成练习题。

节点：${nodeTitle}

学习内容：
${cardsText}

要求：
- 生成 3-5 道练习题
- 问题必须基于上面学习内容
- 题型：single（单选）、multiple（多选）
- 题干和选项不要有英文双引号
- 每道题必须有 answer 和 explanation

输出 JSON：
{
  "questions": [{
    "id": "q-1",
    "type": "single|multiple",
    "question": "题干",
    "options": ["选项1", "选项2", "选项3", "选项4"],
    "answer": "答案",
    "explanation": "解析"
  }]
}

只返回 JSON，不要解释。`;
}

async function generateQuestionsWithMiniMax(nodeTitle, cards) {
  console.log(`  [生成题目] ${nodeTitle}...`);
  const prompt = buildQuestionsPrompt(nodeTitle, cards);
  const response = await callMiniMax(prompt, 2000);

  // 提取 JSON
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("无法从响应中提取 JSON");
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    // 尝试修复 JSON
    const fixed = response.replace(/'/g, '"').replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    const fixedMatch = fixed.match(/\{[\s\S]*\}/);
    if (fixedMatch) {
      return JSON.parse(fixedMatch[0]);
    }
    throw new Error("无法解析 JSON");
  }
}

function createBasePayload(courseName, nodeTitle, teachingGoal, estimatedLevel, backgroundSummary) {
  return {
    nodeTitle,
    teachingGoal,
    courseName,
    courseDescription: "",
    userInsights: "暂无",
    estimatedLevel,
    backgroundSummary,
    frame: "total_split_total",
    teachingMemory: {},
    learningStyle: "",
    technicalLevel: "",
    valuePriorities: [],
  };
}

async function generateNodeLesson(courseName, nodeTitle, teachingGoal, nodeIndex, estimatedLevel, backgroundSummary) {
  console.log(`[生成卡片] ${nodeTitle}...`);

  // 生成卡片
  const cardsPayload = createBasePayload(courseName, nodeTitle, teachingGoal, estimatedLevel, backgroundSummary);
  const cardsResult = await callCardsApi(courseName, cardsPayload);

  // 用 MiniMax 生成题目
  const questionsResult = await generateQuestionsWithMiniMax(nodeTitle, cardsResult.cards);

  return {
    courseId: courseName.toLowerCase().replace(/\s+/g, "-"),
    nodeIndex,
    title: nodeTitle,
    teachingGoal,
    teachConceptIds: [],
    assessmentTargetIds: [],
    cards: cardsResult.cards.map((card, idx) => ({
      id: card.id || `card-${idx + 1}`,
      title: card.title,
      content: card.content,
      imageUrl: null,
      visualization: card.visualization || null,
      coveredConceptIds: [],
    })),
    questions: (questionsResult.questions || []).map((q, idx) => ({
      id: q.id || `q-${idx + 1}`,
      type: q.type || "single",
      question: q.question,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation || "正确答案来自本节知识点。",
      concept: null,
      difficulty: q.type === "sorting" ? 2 : 1,
      dimension: q.type === "sorting" ? "application" : "understanding",
      cardId: null,
      targetConceptId: null,
    })),
    validatorSummary: null,
  };
}

async function generateCourse(courseId, title, nodes, backgroundSummary) {
  console.log(`\n=== 开始生成课程: ${title} ===\n`);

  const lessons = {};
  for (const node of nodes) {
    const lesson = await generateNodeLesson(
      title,
      node.title,
      node.teachingGoal,
      node.index,
      "intermediate",
      backgroundSummary
    );
    lessons[node.index] = lesson;
    // 稍微延迟避免请求过快
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return {
    courseId,
    title,
    lessons,
  };
}

// AI 课程节点
const aiCourseNodes = [
  { index: 0, title: "Transformer架构与注意力机制", teachingGoal: "深入理解Transformer架构和注意力机制的工作原理" },
  { index: 1, title: "提示词工程进阶", teachingGoal: "掌握结构化提示词、角色扮演、Chain of Thought等高级技巧" },
  { index: 2, title: "Agent与工具调用", teachingGoal: "理解Agent架构，掌握工具调用和工作流设计方法" },
  { index: 3, title: "RAG与知识库实战", teachingGoal: "掌握RAG架构、向量检索和知识库构建的核心技术" },
];

// 理财课程节点
const financeCourseNodes = [
  { index: 0, title: "资产配置与再平衡", teachingGoal: "理解核心资产类别，掌握资产配置原则和定期再平衡策略" },
  { index: 1, title: "基金投资策略", teachingGoal: "掌握指数基金、主动管理基金的选择逻辑和定投策略" },
  { index: 2, title: "股票估值方法", teachingGoal: "学会PE、PB、DCF等估值方法，能独立判断个股吸引力" },
  { index: 3, title: "风险管理与止损", teachingGoal: "建立止损思维，理解仓位管理和风险控制原则" },
];

async function main() {
  if (!process.env.MINIMAX_API_KEY) {
    console.error("MINIMAX_API_KEY 环境变量未设置");
    process.exit(1);
  }

  try {
    // 生成 AI 课程
    const aiCourse = await generateCourse(
      "system-ai-for-everyone",
      "AI实战进阶课",
      aiCourseNodes,
      "面向已有AI使用经验的用户，不讲基础概念，直接深入模型原理与实战应用。"
    );

    // 保存 AI 课程
    const aiOutputPath = join(OUTPUT_DIR, "system-ai-for-everyone.json");
    writeFileSync(aiOutputPath, JSON.stringify(aiCourse, null, 2), "utf8");
    console.log(`\n=== AI 课程已保存: ${aiOutputPath} ===`);

    // 生成理财课程
    const financeCourse = await generateCourse(
      "system-personal-finance",
      "实战投资进阶课",
      financeCourseNodes,
      "面向有基础理财认知的用户，不讲基础概念，直接深入投资策略与实战技巧。"
    );

    // 保存理财课程
    const financeOutputPath = join(OUTPUT_DIR, "system-personal-finance.json");
    writeFileSync(financeOutputPath, JSON.stringify(financeCourse, null, 2), "utf8");
    console.log(`\n=== 理财课程已保存: ${financeOutputPath} ===`);

    console.log("\n=== 全部完成 ===");

  } catch (error) {
    console.error("生成失败:", error);
    process.exit(1);
  }
}

main();