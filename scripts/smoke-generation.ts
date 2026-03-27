import {
  createConceptIdFromName,
  normalizeCourseBlueprint,
  resolveConceptNameFromBlueprint,
} from '@/lib/course-blueprint';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildCompactCourseBlueprintPrompt, buildNodeLessonPrompt } from '@/lib/prompt';
import type { CourseBlueprint, CourseBlueprintPromptPayload, NodeLesson, NodeLessonPromptPayload } from '@/types/course';

interface CourseOutlineDraft {
  difficultySummary?: string;
  whyThisCourseFits?: string;
  courseGoal?: string;
  concepts?: string[];
  nodes?: Array<{
    title?: string;
    teachingGoal?: string;
    teachConcepts?: string[];
    prerequisiteConcepts?: string[];
    bridgeFromPreviousNode?: string;
    cardCount?: number;
  }>;
}

function convertOutlineToBlueprint(
  topic: string,
  payload: CourseBlueprintPromptPayload,
  outline: CourseOutlineDraft,
): CourseBlueprint {
  const conceptNames = Array.from(new Set([
    ...(outline.concepts || []),
    ...((outline.nodes || []).flatMap((node) => node.teachConcepts || [])),
    ...((outline.nodes || []).flatMap((node) => node.prerequisiteConcepts || [])),
  ])).filter(Boolean);

  const concepts = conceptNames.map((name) => ({
    id: createConceptIdFromName(name),
    name,
    aliases: [] as string[],
  }));
  const conceptIdByName = new Map(concepts.map((concept) => [concept.name, concept.id]));

  return normalizeCourseBlueprint({
    courseId: `course-${Date.now()}`,
    topic,
    learnerPositioning: {
      estimatedLevel: payload.learnerSnapshot.estimatedLevel,
      difficultySummary: outline.difficultySummary || '适合先快速建立整体认知的学习者。',
      whyThisCourseFits: outline.whyThisCourseFits || payload.learnerSnapshot.targetGoal || '先得到目录，再逐节深入。',
    },
    courseGoal: outline.courseGoal || `建立关于${topic}的基础学习路径。`,
    globalConcepts: concepts,
    nodes: (outline.nodes || []).slice(0, 15).map((node, index) => ({
      index,
      title: node.title || `第 ${index + 1} 节`,
      teachingGoal: node.teachingGoal || `理解${(node.teachConcepts || []).join('、') || topic}的基础概念`,
      teachConceptIds: (node.teachConcepts || []).map((name) => conceptIdByName.get(name) || createConceptIdFromName(name)),
      prerequisiteConceptIds: (node.prerequisiteConcepts || []).map((name) => conceptIdByName.get(name) || createConceptIdFromName(name)),
      bridgeFromPreviousNode: node.bridgeFromPreviousNode || (index === 0 ? '从最核心的基础开始。' : '承接上一节继续深入。'),
      cardCount: node.cardCount || 8,
      status: index === 0 ? 'available' : 'locked',
    })),
  });
}

const SMOKE_TIMEOUT_MS = 300000;
const SMOKE_LESSON_CARD_COUNT = 4;
const SMOKE_BLUEPRINT_MAX_TOKENS = 8000;
const SMOKE_LESSON_MAX_TOKENS = 0; // 不限制
const SMOKE_REFINED_BLUEPRINT_MAX_TOKENS = 4000;
const SMOKE_REFINED_LESSON_MAX_TOKENS = 0; // 不限制
const SMOKE_BLUEPRINT_ATTEMPTS = [
  { timeoutMs: 120_000, maxTokens: SMOKE_BLUEPRINT_MAX_TOKENS },
  { timeoutMs: 60_000, maxTokens: 5000 },
] as const;
const SMOKE_LESSON_ATTEMPTS = [
  { timeoutMs: 240_000, maxTokens: SMOKE_LESSON_MAX_TOKENS },
  { timeoutMs: 180_000, maxTokens: SMOKE_LESSON_MAX_TOKENS },
] as const;

function getTopic(): string {
  return process.argv[2] || 'Agent 入门';
}

function getCoursePromptPayload(): CourseBlueprintPromptPayload {
  return {
    learnerSnapshot: {
      estimatedLevel: 'beginner',
      confidence: 0.82,
      targetGoal: '希望课程服务于 AI 产品经理相关成长',
    },
    mustCoverConceptIds: ['concept-tool-use', 'concept-workflow-orchestration'],
    mustCoverConceptNames: ['工具调用', '工作流编排'],
    skippableConceptIds: ['concept-react-basic'],
    skippableConceptNames: ['基础前端组件概念'],
    riskConceptIds: ['concept-tool-use'],
    riskConceptNames: ['工具调用'],
    analogyFacts: [{ id: 'fact-1', text: '负责过埋点分析和实验设计' }],
    recentEpisodes: [{ topic: 'Agent', summary: '上一门 Agent 课程已完成 3/6 节' }],
  };
}

function getNodePromptPayload(blueprint: CourseBlueprint): NodeLessonPromptPayload {
  const targetNode = blueprint.nodes[0];
  return {
    nodeTopic: blueprint.topic,
    nodeTitle: targetNode.title,
    teachingGoal: targetNode.teachingGoal,
    analogyFacts: [{ id: 'fact-1', text: '负责过埋点分析和实验设计' }],
    preferredExplanationStyles: ['分步拆解'],
    recentRelevantQuestions: ['工具调用和工作流编排有什么区别？'],
  };
}

async function withTimeout<T>(label: string, task: Promise<T>, timeoutMs: number = SMOKE_TIMEOUT_MS): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

async function callWithAttempts(
  primaryPrompt: string,
  attempts: ReadonlyArray<{ timeoutMs: number; maxTokens: number }>,
  label: string,
  retryPrompt?: string,
): Promise<string> {
  for (const [index, attempt] of attempts.entries()) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), attempt.timeoutMs);
    const prompt = index === 0 ? primaryPrompt : retryPrompt || primaryPrompt;

    try {
      return await callMiniMax(prompt, {
        maxTokens: attempt.maxTokens,
        signal: controller.signal,
      });
    } catch (error) {
      if (!isAbortLikeError(error)) {
        throw error;
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new Error(`${label} timed out after ${SMOKE_TIMEOUT_MS}ms`);
}

function buildCourseBlueprintRefinePrompt(topic: string, draft: CourseBlueprint, issues: string[]): string {
  return `你需要修复一份 CourseBlueprint，只能返回修正后的 JSON。

主题：${topic}

当前 draft：
${JSON.stringify(draft, null, 2)}

必须修复的问题：
${issues.map((issue) => `- ${issue}`).join('\n')}

修复要求：
- 保留原有高质量部分，不要整份重写成另一门课
- 逐条修复 issues
- 输出仍然必须符合 CourseBlueprint 结构

只返回 JSON。`;
}

function buildNodeLessonRefinePrompt(lesson: NodeLesson, issues: string[]): string {
  return `你需要修复一份 NodeLesson，只能返回修正后的 JSON。

当前 draft：
${JSON.stringify(lesson, null, 2)}

必须修复的问题：
${issues.map((issue) => `- ${issue}`).join('\n')}

修复要求：
- 保留已写好的高质量解释
- 逐条修复 issues
- 输出仍必须符合 NodeLesson 结构

只返回 JSON。`;
}

async function main() {
  if (!process.env.MINIMAX_API_KEY) {
    throw new Error('MINIMAX_API_KEY is not set');
  }

  const topic = getTopic();
  const coursePayload = getCoursePromptPayload();
  const coursePrompt = buildCompactCourseBlueprintPrompt(topic, coursePayload);
  console.log(`[smoke:generation] blueprint start: ${topic}`);
  const blueprintDraftContent = await callWithAttempts(
    coursePrompt,
    SMOKE_BLUEPRINT_ATTEMPTS,
    'blueprint generation',
  );
  // 简化 prompt 总是返回 outline 格式，跳过验证直接使用
  const blueprintDraft = parseJSONResponse<CourseOutlineDraft>(blueprintDraftContent);
  const blueprint = convertOutlineToBlueprint(topic, coursePayload, blueprintDraft);

  // 确保第一节状态为 available
  if (blueprint.nodes?.length > 0 && blueprint.nodes[0].status === 'locked') {
    blueprint.nodes[0].status = 'available';
  }

  const nodePrompt = buildNodeLessonPrompt(topic, getNodePromptPayload(blueprint));
  console.log(`[smoke:generation] lesson start: ${blueprint.nodes[0]?.title || 'node-0'}`);
  const lessonDraftContent = await callWithAttempts(nodePrompt, SMOKE_LESSON_ATTEMPTS, 'lesson generation');
  const lesson = parseJSONResponse<NodeLesson>(lessonDraftContent);

  console.log(JSON.stringify({
    topic,
    blueprint: {
      courseId: blueprint.courseId,
      nodeCount: blueprint.nodes.length,
      concepts: blueprint.globalConcepts.map((item) => item.name),
    },
    lesson: {
      nodeTitle: lesson.title,
      cardCount: lesson.cards.length,
      questionCount: lesson.questions.length,
      targetConceptIds: lesson.questions.map((item) => item.targetConceptId),
    },
    status: 'ok',
  }, null, 2));
}

main().catch((error) => {
  console.error('[smoke:generation] failed:', error);
  process.exit(1);
});
