// app/api/generate/node/route.ts
import { NextRequest, NextResponse } from 'next/server';
import {
  createGenerationTrace,
  finalizeGenerationError,
  finalizeGenerationSuccess,
  GenerationTimeoutError,
  logGenerationMeta,
  withGenerationStage,
} from '@/lib/generation/observability';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { createMemoryRepository } from '@/lib/memory/repository';
import { buildNodeLessonPrompt } from '@/lib/prompt';
import { CourseBlueprint, MemoryStoreV2, MemoryStoreV3, NodeLesson, UserMemory, UserProfile } from '@/types/course';

const NODE_PRIMARY_ATTEMPTS = [
  { timeoutMs: 240_000 },
  { timeoutMs: 180_000 },
] as const;

function isAbortLikeError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

async function callNodePrimaryModel(prompt: string): Promise<string> {
  for (const [index, attempt] of NODE_PRIMARY_ATTEMPTS.entries()) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), attempt.timeoutMs);

    try {
      return await callMiniMax(prompt, {
        signal: controller.signal,
      });
    } catch (error) {
      if (!isAbortLikeError(error)) {
        throw error;
      }
      // 最后一次尝试失败后抛出超时错误
      if (index === NODE_PRIMARY_ATTEMPTS.length - 1) {
        throw new GenerationTimeoutError('primary_model', attempt.timeoutMs);
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
  throw new GenerationTimeoutError('primary_model', NODE_PRIMARY_ATTEMPTS[0].timeoutMs);
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[NodeContent] Starting at', new Date().toISOString());
  const trace = createGenerationTrace('node-lesson');

  try {
    const {
      topic,
      blueprint,
      nodeIndex,
      userProfile,
      userMemory,
    } = await request.json() as {
      topic: string;
      blueprint?: CourseBlueprint;
      nodeIndex?: number;
      userProfile?: UserProfile | null;
      userMemory?: UserMemory | MemoryStoreV2 | MemoryStoreV3 | null;
    };

    if (!topic || typeof nodeIndex !== 'number' || !blueprint) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const node = blueprint.nodes[nodeIndex];
    if (!node) {
      return NextResponse.json({ error: 'Node not found' }, { status: 404 });
    }
    const memoryRepository = createMemoryRepository({
      initialMemory: userMemory,
      getProfile: () => userProfile || null,
    });
    const insights = userProfile?.insights || null;
    const prompt = await withGenerationStage(trace, 'prompt_build', async () => {
      // 由于课程目录已简化，概念映射为空，memory 查询只基于 topic 和 nodeTitle
      const teachingPayload = memoryRepository.getTeachingPayload({
        topic,
        nodeTitle: node.title,
        nodeConcepts: [],
        prerequisiteConcepts: [],
      });

      return buildNodeLessonPrompt(topic, {
        nodeTopic: topic,
        nodeTitle: node.title,
        teachingGoal: node.teachingGoal,
        analogyFacts: (insights?.analogyExperiences || []).slice(0, 3).map((text, index) => ({ id: `fact-${index + 1}`, text })),
        preferredExplanationStyles: teachingPayload.preferredExplanationStyles,
        recentRelevantQuestions: teachingPayload.recentQuestionSummaries,
      });
    });
    console.log(`[NodeContent] Prompt built: ${Date.now() - startTime}ms`);

    console.log('[NodeContent] Calling MiniMax API...');
    const content = await withGenerationStage(trace, 'primary_model', async () => {
      return callNodePrimaryModel(prompt);
    });
    console.log('[NodeContent] Raw response length:', content.length);
    console.log('[NodeContent] Raw response preview:', content.substring(0, 500));

    const draftLesson = await withGenerationStage(trace, 'parse_primary', async () => {
      return parseJSONResponse<NodeLesson>(content);
    });
    const patchedLesson: NodeLesson = {
      ...draftLesson,
      courseId: draftLesson.courseId || blueprint.courseId,
      nodeIndex: typeof draftLesson.nodeIndex === 'number' ? draftLesson.nodeIndex : node.index,
      title: draftLesson.title || node.title,
      teachingGoal: draftLesson.teachingGoal || node.teachingGoal,
      cards: draftLesson.cards || [],
      questions: draftLesson.questions || [],
    };

    // 简化流程：不再验证 concept 覆盖，直接返回
    const data = patchedLesson;

    console.log(`[NodeContent] Total: ${Date.now() - startTime}ms`);
    const meta = finalizeGenerationSuccess(trace, {
      extra: {
        nodeIndex,
        questionCount: data.questions.length,
        cardCount: data.cards.length,
      },
    });
    logGenerationMeta('NodeContent', meta);

    return NextResponse.json({
      ...data,
      generationMeta: meta,
    });
  } catch (error) {
    console.error(`[NodeContent] Error after ${Date.now() - startTime}ms:`, error);
    const meta = finalizeGenerationError(trace, error);
    logGenerationMeta('NodeContent', meta);
    return NextResponse.json(
      {
        error: meta.error?.kind === 'timeout'
          ? '当前模型响应超时，已自动重试仍未完成，请手动重试这一节。'
          : '这一节内容生成失败，请稍后再试。',
        retryable: meta.error?.kind === 'timeout',
        generationMeta: meta,
      },
      { status: 500 }
    );
  }
}
