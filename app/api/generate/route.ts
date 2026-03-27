// app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createConceptIdFromName, deriveCourseTreeViewFromBlueprint, normalizeCourseBlueprint } from '@/lib/course-blueprint';
import {
  createGenerationTrace,
  finalizeGenerationError,
  finalizeGenerationSuccess,
  GenerationTimeoutError,
  logGenerationMeta,
  withGenerationStage,
  withGenerationTimeout,
} from '@/lib/generation/observability';
import { callMiniMax, callMiniMaxWithSearch, parseJSONResponse } from '@/lib/minimax';
import { createMemoryRepository } from '@/lib/memory/repository';
import { buildCompactCourseBlueprintPrompt } from '@/lib/prompt';
import {
  CourseBlueprint,
  CourseBlueprintPromptPayload,
  MemoryStoreV3,
  MemoryStoreV2,
  UserMemory,
  UserProfile,
} from '@/types/course';

// CourseOutlineDraft 是简化版课程目录结构
interface CourseOutlineDraft {
  courseName?: string;
  difficultySummary?: string;
  courseGoal?: string;
  nodes?: Array<{
    title?: string;
    teachingGoal?: string;
  }>;
}

const COURSE_PRIMARY_TIMEOUT_MS = 300_000;
const COURSE_PRIMARY_ATTEMPTS = [
  { timeoutMs: 180_000 },
  { timeoutMs: 120_000 },
] as const;

function createPromptPayloadFromPlanningPayload(topic: string, planningPayload: ReturnType<ReturnType<typeof createMemoryRepository>['getPlanningPayload']>): CourseBlueprintPromptPayload {
  return {
    learnerSnapshot: planningPayload.learnerSnapshot,
    mustCoverConceptIds: planningPayload.mustCoverConcepts.map((concept) => createConceptIdFromName(concept)),
    mustCoverConceptNames: planningPayload.mustCoverConcepts,
    skippableConceptIds: planningPayload.skippableBasics.map((concept) => createConceptIdFromName(concept)),
    skippableConceptNames: planningPayload.skippableBasics,
    riskConceptIds: planningPayload.riskConcepts.map((concept) => createConceptIdFromName(concept)),
    riskConceptNames: planningPayload.riskConcepts,
    analogyFacts: planningPayload.transferableBackground.map((text, index) => ({ id: `fact-${index + 1}`, text })),
    recentEpisodes: planningPayload.recentRelevantCourses.map((item, index) => ({
      topic: item.topic || topic,
      summary: item.summary || `相关课程 ${index + 1}`,
    })),
  };
}

function convertOutlineToBlueprint(
  topic: string,
  payload: CourseBlueprintPromptPayload,
  outline: CourseOutlineDraft,
): CourseBlueprint {
  return normalizeCourseBlueprint({
    courseId: `course-${Date.now()}`,
    topic: outline.courseName || topic,
    learnerPositioning: {
      estimatedLevel: payload.learnerSnapshot.estimatedLevel,
      difficultySummary: outline.difficultySummary || '适合先快速建立整体认知的学习者。',
      whyThisCourseFits: payload.learnerSnapshot.targetGoal || '先得到目录，再逐节深入。',
    },
    courseGoal: outline.courseGoal || `建立关于${topic}的基础学习路径。`,
    globalConcepts: [],
    nodes: (outline.nodes || []).slice(0, 15).map((node, index) => ({
      index,
      title: node.title || `第 ${index + 1} 节`,
      teachingGoal: node.teachingGoal || `理解${topic}的基础概念`,
      teachConceptIds: [],
      prerequisiteConceptIds: [],
      bridgeFromPreviousNode: index === 0 ? '从最核心的基础开始。' : '承接上一节继续深入。',
      status: index === 0 ? 'available' : 'locked',
    })),
  });
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

async function callCoursePrimaryModel(primaryPrompt: string, allowSearch: boolean, retryPrompt?: string): Promise<string> {
  if (allowSearch) {
    return withGenerationTimeout(
      'primary_model',
      COURSE_PRIMARY_TIMEOUT_MS,
      callMiniMaxWithSearch(primaryPrompt, undefined, undefined, 1),
    );
  }

  for (const [index, attempt] of COURSE_PRIMARY_ATTEMPTS.entries()) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), attempt.timeoutMs);
    const prompt = index === 0 ? primaryPrompt : retryPrompt || primaryPrompt;

    try {
      return await callMiniMax(prompt, {
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

  throw new GenerationTimeoutError('primary_model', COURSE_PRIMARY_TIMEOUT_MS);
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[CourseTree] Starting at', new Date().toISOString());
  const trace = createGenerationTrace('course-blueprint');

  try {
    const {
      topic,
      userProfile,
      userMemory,
    } = await request.json() as {
      topic: string;
      userProfile?: UserProfile | null;
      userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null;
    };

    if (!topic || typeof topic !== 'string') {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    const memoryRepository = createMemoryRepository({
      initialMemory: userMemory,
      getProfile: () => userProfile || null,
    });
    const { planningPayload, blueprintPromptPayload } = await withGenerationStage(trace, 'prompt_build', async () => {
      const nextPlanningPayload = memoryRepository.getPlanningPayload(topic);
      const nextBlueprintPromptPayload = createPromptPayloadFromPlanningPayload(topic, nextPlanningPayload);
      return {
        planningPayload: nextPlanningPayload,
        blueprintPromptPayload: nextBlueprintPromptPayload,
      };
    });
    console.log(`[CourseTree] Prompt built: ${Date.now() - startTime}ms`);

    console.log('[CourseTree] Calling MiniMax API...');
    const content = await withGenerationStage(trace, 'primary_model', async () => {
      const primaryPrompt = buildCompactCourseBlueprintPrompt(topic, blueprintPromptPayload);
      const retryPrompt = buildCompactCourseBlueprintPrompt(topic, blueprintPromptPayload);
      return callCoursePrimaryModel(primaryPrompt, true, retryPrompt);
    });

    const course = await withGenerationStage(trace, 'parse_primary', async () => {
      return parseJSONResponse<CourseOutlineDraft>(content);
    });

    const blueprint = convertOutlineToBlueprint(topic, blueprintPromptPayload, course);
    if (blueprint.nodes?.length > 0 && blueprint.nodes[0].status === 'locked') {
      blueprint.nodes[0].status = 'available';
    }

    console.log(`[CourseTree] Total: ${Date.now() - startTime}ms`);
    const meta = finalizeGenerationSuccess(trace, {
      extra: {
        nodeCount: blueprint.nodes.length,
        planningMustCoverCount: planningPayload.mustCoverConcepts.length,
      },
    });
    logGenerationMeta('CourseTree', meta);

    return NextResponse.json({
      blueprint,
      treeView: deriveCourseTreeViewFromBlueprint(blueprint),
      generationMeta: meta,
    });
  } catch (error) {
    console.error(`[CourseTree] Error after ${Date.now() - startTime}ms:`, error);
    const meta = finalizeGenerationError(trace, error);
    logGenerationMeta('CourseTree', meta);
    return NextResponse.json(
      {
        error: meta.error?.kind === 'timeout'
          ? '当前模型响应超时，已自动重试仍未完成，请手动重试。'
          : '课程生成失败，请稍后再试。',
        retryable: meta.error?.kind === 'timeout',
        generationMeta: meta,
      },
      { status: 500 }
    );
  }
}
