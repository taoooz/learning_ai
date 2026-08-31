import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYSTEM_COURSE_CATALOG } from '@/data/system-courses/catalog';
import {
  createConceptIdFromName,
  createStoredCourseBundleFromBlueprint,
  getNodeAssessmentTargetIds,
  getNodePersonalizationHooks,
  resolveConceptIdFromBlueprint,
  resolveConceptNameFromBlueprint,
} from '@/lib/course-blueprint';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { validateCourseBlueprint } from '@/lib/validation/course-validator';
import { validateNodeLesson } from '@/lib/validation/node-validator';
import type { CourseBlueprint, CourseBlueprintPromptPayload, NodeLesson, StoredCourseBundle } from '@/types/course';

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'system-courses', 'generated');
const BLUEPRINT_ATTEMPTS = [
  { timeoutMs: 45_000, maxTokens: 1400 },
  { timeoutMs: 30_000, maxTokens: 1200 },
  { timeoutMs: 20_000, maxTokens: 1000 },
] as const;
const LESSON_ATTEMPTS = [
  { timeoutMs: 40_000, maxTokens: 2000 },
  { timeoutMs: 24_000, maxTokens: 1600 },
  { timeoutMs: 18_000, maxTokens: 1400 },
] as const;
const BLUEPRINT_REFINE_MAX_TOKENS = 2200;
const LESSON_REFINE_MAX_TOKENS = 2600;
const JSON_REPAIR_MAX_TOKENS = 2400;

interface SystemCourseOutline {
  courseGoal: string;
  concepts: string[];
  nodes: Array<{
    title: string;
    teachingGoal: string;
    teachConcepts: string[];
    prerequisiteConcepts: string[];
    assessmentTargets: string[];
    bridgeFromPreviousNode: string;
    mustRemediateConcepts?: string[];
  }>;
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
      const content = await callMiniMax(prompt, {
        maxTokens: attempt.maxTokens,
        signal: controller.signal,
      });
      if (content.trim()) {
        return content;
      }
    } catch (error) {
      if (!isAbortLikeError(error)) {
        throw error;
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new Error(`${label} timed out after retries`);
}

function buildSystemCourseOutlinePrompt(entry: (typeof SYSTEM_COURSE_CATALOG)[number]): string {
  return `你在为学习产品生成一门系统推荐课的大纲。只返回 JSON，不要解释。

主题：${entry.title}
目标用户：${entry.generation.learnerDescription}
课程目标：${entry.generation.learnerGoal}
必须覆盖概念：${entry.generation.mustCoverConceptNames.join('、')}
高风险概念：${entry.generation.riskConceptNames.join('、') || '无'}

输出结构：
{
  "courseGoal": "一句中文",
  "concepts": ["概念名"],
  "nodes": [
    {
      "title": "具体标题",
      "teachingGoal": "一句中文",
      "teachConcepts": ["概念名"],
      "prerequisiteConcepts": ["概念名"],
      "assessmentTargets": ["概念名"],
      "bridgeFromPreviousNode": "一句中文",
      "mustRemediateConcepts": ["概念名"]
    }
  ]
}

要求：
- 只生成 4 个节点
- 节点标题要具体，不能用“入门篇”“进阶篇”
- prerequisiteConcepts 只能引用前面已经出现过的概念
- 至少一个节点明确 remediation 高风险概念
- concepts 应覆盖整门课真正核心的 3 到 5 个概念`;
}

function buildMinimalSystemCourseOutlinePrompt(entry: (typeof SYSTEM_COURSE_CATALOG)[number]): string {
  return `只返回 JSON，不要解释。

主题：${entry.title}
目标用户：${entry.generation.learnerDescription}
课程目标：${entry.generation.learnerGoal}
必须覆盖概念：${entry.generation.mustCoverConceptNames.join('、')}
高风险概念：${entry.generation.riskConceptNames.join('、') || '无'}

输出：
{
  "courseGoal": "一句中文",
  "concepts": ["概念名"],
  "nodes": [
    {
      "title": "具体标题",
      "teachConcepts": ["概念名"],
      "prerequisiteConcepts": ["概念名"],
      "assessmentTargets": ["概念名"],
      "mustRemediateConcepts": ["概念名"]
    }
  ]
}

要求：
- 一共 4 个节点
- 标题具体
- teachConcepts 与必须覆盖概念高度对齐`;
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

function convertOutlineToBlueprint(entry: (typeof SYSTEM_COURSE_CATALOG)[number], outline: SystemCourseOutline): CourseBlueprint {
  const conceptNames = new Set<string>();
  for (const concept of outline.concepts || []) {
    if (concept?.trim()) conceptNames.add(concept.trim());
  }
  for (const node of outline.nodes || []) {
    for (const concept of node.teachConcepts || []) {
      if (concept?.trim()) conceptNames.add(concept.trim());
    }
    for (const concept of node.prerequisiteConcepts || []) {
      if (concept?.trim()) conceptNames.add(concept.trim());
    }
    for (const concept of node.assessmentTargets || []) {
      if (concept?.trim()) conceptNames.add(concept.trim());
    }
    for (const concept of node.mustRemediateConcepts || []) {
      if (concept?.trim()) conceptNames.add(concept.trim());
    }
  }

  const conceptList = Array.from(conceptNames);
  const nameToId = new Map(conceptList.map((name) => [name, createConceptIdFromName(name)]));
  const introducedConceptIds = new Set<string>();
  const assessedConceptIds = new Set<string>();
  const remediatedConceptIds = new Set<string>();

  const nodes = (outline.nodes || []).map((node, index) => {
    const teachConceptIds = (node.teachConcepts || []).map((name) => nameToId.get(name) || createConceptIdFromName(name));
    const prerequisiteConceptIds = (node.prerequisiteConcepts || []).map((name) => nameToId.get(name) || createConceptIdFromName(name));
    const assessmentTargetIds = (node.assessmentTargets || []).map((name) => nameToId.get(name) || createConceptIdFromName(name));
    const mustRemediateConceptIds = (node.mustRemediateConcepts || []).map((name) => nameToId.get(name) || createConceptIdFromName(name));

    for (const conceptId of teachConceptIds) introducedConceptIds.add(conceptId);
    for (const conceptId of assessmentTargetIds) assessedConceptIds.add(conceptId);
    for (const conceptId of mustRemediateConceptIds) remediatedConceptIds.add(conceptId);

    return {
      index,
      title: node.title,
      teachingGoal: node.teachingGoal,
      teachConceptIds,
      prerequisiteConceptIds,
      assessmentTargetIds,
      bridgeFromPreviousNode: node.bridgeFromPreviousNode,
      personalizationHooks: {
        mustRemediateConceptIds,
        canCompressKnownConceptIds: [],
        analogyFactIds: [],
      },
      cardCount: 6,
      status: index === 0 ? 'available' as const : 'locked' as const,
    };
  });

  return {
    courseId: entry.courseId,
    topic: entry.title,
    learnerPositioning: {
      estimatedLevel: 'beginner',
    },
    courseGoal: outline.courseGoal,
    globalConcepts: conceptList.map((name) => ({
      id: nameToId.get(name) || createConceptIdFromName(name),
      name,
      aliases: [],
    })),
    nodes,
    coverage: {
      introducedConceptIds: Array.from(introducedConceptIds),
      assessedConceptIds: Array.from(assessedConceptIds),
      remediatedConceptIds: Array.from(remediatedConceptIds),
    },
    generationNotes: {
      compressedKnownConceptIds: [],
      emphasizedRiskConceptIds: entry.generation.riskConceptNames.map((name) => nameToId.get(name) || createConceptIdFromName(name)),
      selectedAnalogyFactIds: [],
    },
  };
}

function buildJsonRepairPrompt(kind: 'CourseBlueprint' | 'NodeLesson', raw: string): string {
  return `你会收到一段本来应该输出 ${kind} JSON 的原始文本，但它格式不合法。请在不额外发散内容的前提下，把它整理成一个合法 JSON。

要求：
- 只返回 JSON
- 不要解释
- 不要输出 Markdown 代码块
- 如果原文里有多余说明文字，去掉它，只保留能组成 ${kind} 的结构化结果

原始输出：
${raw}`;
}

async function parseOrRepairJson<T>(content: string, kind: 'CourseBlueprint' | 'NodeLesson'): Promise<T> {
  try {
    return parseJSONResponse<T>(content);
  } catch (error) {
    const repairedContent = await callMiniMax(buildJsonRepairPrompt(kind, content), {
      maxTokens: JSON_REPAIR_MAX_TOKENS,
    });
    try {
      return parseJSONResponse<T>(repairedContent);
    } catch {
      console.error(`[generate:system-courses] ${kind} parse failed`, {
        rawPreview: content.slice(0, 500),
        repairedPreview: repairedContent.slice(0, 500),
      });
      throw error;
    }
  }
}

function normalizeBlueprintDraft(raw: Partial<CourseBlueprint>, entry: (typeof SYSTEM_COURSE_CATALOG)[number]): CourseBlueprint {
  return {
    courseId: raw.courseId || entry.courseId,
    topic: raw.topic || entry.title,
    learnerPositioning: {
      estimatedLevel: raw.learnerPositioning?.estimatedLevel || 'beginner',
    },
    courseGoal: raw.courseGoal || entry.generation.learnerGoal,
    globalConcepts: Array.isArray(raw.globalConcepts) ? raw.globalConcepts : [],
    nodes: Array.isArray(raw.nodes)
      ? raw.nodes.map((node, index) => ({
        index,
        title: node.title || `第 ${index + 1} 节`,
        teachingGoal: node.teachingGoal || entry.generation.learnerGoal,
        teachConceptIds: Array.isArray(node.teachConceptIds) ? node.teachConceptIds : [],
        prerequisiteConceptIds: Array.isArray(node.prerequisiteConceptIds) ? node.prerequisiteConceptIds : [],
        assessmentTargetIds: Array.isArray(node.assessmentTargetIds) ? node.assessmentTargetIds : [],
        bridgeFromPreviousNode: node.bridgeFromPreviousNode || (index === 0 ? '从最重要的基础开始。' : '承接上一节继续深入。'),
        personalizationHooks: {
          mustRemediateConceptIds: Array.isArray(node.personalizationHooks?.mustRemediateConceptIds) ? node.personalizationHooks.mustRemediateConceptIds : [],
          canCompressKnownConceptIds: Array.isArray(node.personalizationHooks?.canCompressKnownConceptIds) ? node.personalizationHooks.canCompressKnownConceptIds : [],
          analogyFactIds: Array.isArray(node.personalizationHooks?.analogyFactIds) ? node.personalizationHooks.analogyFactIds : [],
        },
        status: index === 0 ? 'available' : 'locked',
      }))
      : [],
    coverage: {
      introducedConceptIds: Array.isArray(raw.coverage?.introducedConceptIds) ? raw.coverage.introducedConceptIds : [],
      assessedConceptIds: Array.isArray(raw.coverage?.assessedConceptIds) ? raw.coverage.assessedConceptIds : [],
      remediatedConceptIds: Array.isArray(raw.coverage?.remediatedConceptIds) ? raw.coverage.remediatedConceptIds : [],
    },
    generationNotes: {
      compressedKnownConceptIds: Array.isArray(raw.generationNotes?.compressedKnownConceptIds) ? raw.generationNotes.compressedKnownConceptIds : [],
      emphasizedRiskConceptIds: Array.isArray(raw.generationNotes?.emphasizedRiskConceptIds) ? raw.generationNotes.emphasizedRiskConceptIds : [],
      selectedAnalogyFactIds: Array.isArray(raw.generationNotes?.selectedAnalogyFactIds) ? raw.generationNotes.selectedAnalogyFactIds : [],
    },
  };
}

function normalizeLessonDraft(raw: Partial<NodeLesson>, blueprint: CourseBlueprint, nodeIndex: number): NodeLesson {
  const node = blueprint.nodes[nodeIndex];
  const assessmentTargetIds = getNodeAssessmentTargetIds(node);
  return {
    courseId: raw.courseId || blueprint.courseId,
    nodeIndex: typeof raw.nodeIndex === 'number' ? raw.nodeIndex : nodeIndex,
    title: raw.title || node.title,
    teachingGoal: raw.teachingGoal || node.teachingGoal,
    teachConceptIds: Array.isArray(raw.teachConceptIds) && raw.teachConceptIds.length > 0 ? raw.teachConceptIds : node.teachConceptIds,
    assessmentTargetIds: Array.isArray(raw.assessmentTargetIds) && raw.assessmentTargetIds.length > 0 ? raw.assessmentTargetIds : assessmentTargetIds,
    cards: Array.isArray(raw.cards)
      ? raw.cards.map((card, index) => ({
        id: card.id || `${blueprint.courseId}-node-${nodeIndex}-card-${index + 1}`,
        title: card.title || `卡片 ${index + 1}`,
        content: card.content || '',
        imageUrl: card.imageUrl ?? null,
        visualization: card.visualization,
        coveredConceptIds: Array.isArray(card.coveredConceptIds) ? card.coveredConceptIds : [],
      }))
      : [],
    questions: Array.isArray(raw.questions)
      ? raw.questions.map((question, index) => ({
        id: question.id || `${blueprint.courseId}-node-${nodeIndex}-question-${index + 1}`,
        type: question.type || 'single',
        question: question.question || '',
        options: question.options,
        answer: question.answer || '',
        concept: question.concept,
        difficulty: question.difficulty,
        dimension: question.dimension,
        cardId: question.cardId,
        targetConceptId: question.targetConceptId || resolveConceptIdFromBlueprint(blueprint, question.concept || ''),
      }))
      : [],
    validatorSummary: raw.validatorSummary,
  };
}

function buildNodeLessonRefinePrompt(lesson: NodeLesson, issues: string[]): string {
  return `你需要修复一份 NodeLesson，只能返回修正后的 JSON。

当前 draft：
${JSON.stringify(lesson, null, 2)}

必须修复的问题：
${issues.map((issue) => `- ${issue}`).join('\n')}

修复要求：
- 保留已写好的高质量内容
- 逐条修复 issues
- 输出仍必须符合 NodeLesson 结构

只返回 JSON。`;
}

function createCoursePromptPayload(entry: (typeof SYSTEM_COURSE_CATALOG)[number]): CourseBlueprintPromptPayload {
  return {
    learnerSnapshot: {
      estimatedLevel: 'beginner',
      confidence: 0.88,
      targetGoal: `${entry.generation.learnerDescription}。${entry.generation.learnerGoal}`,
    },
    mustCoverConceptIds: entry.generation.mustCoverConceptNames.map((concept) => createConceptIdFromName(concept)),
    mustCoverConceptNames: entry.generation.mustCoverConceptNames,
    skippableConceptIds: entry.generation.skippableConceptNames.map((concept) => createConceptIdFromName(concept)),
    skippableConceptNames: entry.generation.skippableConceptNames,
    riskConceptIds: entry.generation.riskConceptNames.map((concept) => createConceptIdFromName(concept)),
    riskConceptNames: entry.generation.riskConceptNames,
    analogyFacts: entry.generation.analogyFacts,
    recentEpisodes: entry.generation.recentEpisodes,
  };
}

function buildNodeLessonPrompt(
  topic: string,
  nodeTitle: string,
  teachingGoal: string,
  entry: (typeof SYSTEM_COURSE_CATALOG)[number],
): string {
  const sections: string[] = [];

  if (entry.generation.analogyFacts.length) {
    sections.push(`## 可用类比\n${entry.generation.analogyFacts.map((item) => `- ${item.text}`).join('\n')}`);
  }

  if (entry.generation.preferredExplanationStyles.length) {
    sections.push(`## 偏好解释方式\n${entry.generation.preferredExplanationStyles.map((item) => `- ${item}`).join('\n')}`);
  }

  if (entry.generation.recentRelevantQuestions.length) {
    sections.push(`## 最近相关提问\n${entry.generation.recentRelevantQuestions.map((item) => `- ${item}`).join('\n')}`);
  }

  const contextSection = sections.length ? `\n${sections.join('\n\n')}\n` : '';

  return `你是 AI 导师，请生成一节 NodeLesson。

主题：${topic}
当前节点：${nodeTitle}
节点目标：${teachingGoal}
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
  "title": "${nodeTitle}",
  "teachingGoal": "${teachingGoal}",
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

async function generateBlueprint(entry: (typeof SYSTEM_COURSE_CATALOG)[number]): Promise<CourseBlueprint> {
  const promptPayload = createCoursePromptPayload(entry);
  console.log(`[generate:system-courses] blueprint prompt ready for ${entry.courseId}`);
  let draftContent: string;
  try {
    draftContent = await callWithAttempts(buildSystemCourseOutlinePrompt(entry), BLUEPRINT_ATTEMPTS, `${entry.courseId} blueprint`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('timed out')) {
      throw error;
    }
    console.log(`[generate:system-courses] blueprint fallback prompt for ${entry.courseId}`);
    draftContent = await callWithAttempts(buildMinimalSystemCourseOutlinePrompt(entry), BLUEPRINT_ATTEMPTS, `${entry.courseId} blueprint fallback`);
  }
  const outline = await parseOrRepairJson<SystemCourseOutline>(draftContent, 'CourseBlueprint');
  const patchedDraft: CourseBlueprint = normalizeBlueprintDraft(convertOutlineToBlueprint(entry, outline), entry);
  const validation = validateCourseBlueprint(patchedDraft, {
    mustCoverConceptIds: promptPayload.mustCoverConceptIds,
    riskConceptIds: promptPayload.riskConceptIds,
  });

  const finalBlueprint = validation.passed
    ? patchedDraft
    : normalizeBlueprintDraft(await parseOrRepairJson<Partial<CourseBlueprint>>(await callMiniMax(buildCourseBlueprintRefinePrompt(entry.title, patchedDraft, validation.issues), {
      maxTokens: BLUEPRINT_REFINE_MAX_TOKENS,
    }), 'CourseBlueprint'), entry);

  const normalizedBlueprint: CourseBlueprint = normalizeBlueprintDraft(finalBlueprint, entry);

  const finalValidation = validateCourseBlueprint(normalizedBlueprint, {
    mustCoverConceptIds: promptPayload.mustCoverConceptIds,
    riskConceptIds: promptPayload.riskConceptIds,
  });

  if (!finalValidation.passed) {
    throw new Error(`${entry.courseId} blueprint validation failed: ${finalValidation.issues.join('；')}`);
  }

  console.log(`[generate:system-courses] blueprint ok for ${entry.courseId}`);
  return normalizedBlueprint;
}

async function generateLesson(
  entry: (typeof SYSTEM_COURSE_CATALOG)[number],
  blueprint: CourseBlueprint,
  nodeIndex: number,
): Promise<NodeLesson> {
  const node = blueprint.nodes[nodeIndex];
  const assessmentTargetIds = getNodeAssessmentTargetIds(node);
  const personalizationHooks = getNodePersonalizationHooks(node);
  console.log(`[generate:system-courses] lesson start ${entry.courseId}#${nodeIndex} ${node.title}`);
  const prompt = buildNodeLessonPrompt(entry.title, node.title, node.teachingGoal, entry);
  const draftContent = await callWithAttempts(prompt, LESSON_ATTEMPTS, `${entry.courseId} node-${nodeIndex}`);
  const draftLesson = normalizeLessonDraft(await parseOrRepairJson<Partial<NodeLesson>>(draftContent, 'NodeLesson'), blueprint, nodeIndex);
  const patchedLesson: NodeLesson = draftLesson;

  const validation = validateNodeLesson(patchedLesson, {
    teachConceptIds: node.teachConceptIds,
    assessmentTargetIds,
    riskConceptIds: personalizationHooks.mustRemediateConceptIds,
  });

  const finalLesson = validation.passed
    ? patchedLesson
    : normalizeLessonDraft(await parseOrRepairJson<Partial<NodeLesson>>(await callMiniMax(buildNodeLessonRefinePrompt(patchedLesson, validation.issues), {
      maxTokens: LESSON_REFINE_MAX_TOKENS,
    }), 'NodeLesson'), blueprint, nodeIndex);

  const normalizedLesson: NodeLesson = normalizeLessonDraft(finalLesson, blueprint, nodeIndex);

  const finalValidation = validateNodeLesson(normalizedLesson, {
    teachConceptIds: node.teachConceptIds,
    assessmentTargetIds,
    riskConceptIds: personalizationHooks.mustRemediateConceptIds,
  });

  if (!finalValidation.passed) {
    throw new Error(`${entry.courseId} node-${nodeIndex} validation failed: ${finalValidation.issues.join('；')}`);
  }

  console.log(`[generate:system-courses] lesson ok ${entry.courseId}#${nodeIndex}`);
  return normalizedLesson;
}

async function generateBundle(entry: (typeof SYSTEM_COURSE_CATALOG)[number]): Promise<StoredCourseBundle> {
  const blueprint = await generateBlueprint(entry);
  const bundle = createStoredCourseBundleFromBlueprint(blueprint);

  for (const node of blueprint.nodes) {
    bundle.lessons[node.index] = await generateLesson(entry, blueprint, node.index);
  }

  return bundle;
}

async function main() {
  if (!process.env.LLM_API_KEY) {
    throw new Error('LLM_API_KEY is not set');
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const targetCourseId = process.argv[2];
  const targets = targetCourseId
    ? SYSTEM_COURSE_CATALOG.filter((entry) => entry.courseId === targetCourseId)
    : SYSTEM_COURSE_CATALOG;

  if (targetCourseId && targets.length === 0) {
    throw new Error(`Unknown system course id: ${targetCourseId}`);
  }

  for (const entry of targets) {
    console.log(`[generate:system-courses] start ${entry.courseId}`);
    const bundle = await generateBundle(entry);
    const outputPath = join(OUTPUT_DIR, `${entry.courseId}.json`);
    writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    console.log(`[generate:system-courses] wrote ${outputPath}`);
  }
}

main().catch((error) => {
  console.error('[generate:system-courses] failed:', error);
  process.exit(1);
});
