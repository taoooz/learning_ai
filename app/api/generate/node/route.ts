// app/api/generate/node/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMaxWithSearch, parseJSONResponse } from '@/lib/minimax';
import { createMemoryRepository } from '@/lib/memory/repository';
import { buildNodeContentPrompt } from '@/lib/prompt';
import { CourseTree, MemoryStoreV2, UserMemory, UserProfile } from '@/types/course';

interface NodeContentResponse {
  cards: Array<{
    id: string;
    title: string;
    content: string;
    imageUrl: string | null;
  }>;
  questions: Array<{
    id: string;
    type: 'single' | 'multiple' | 'sorting';
    question: string;
    options?: string[];
    answer: string | string[];
    explanation: string;
    concept?: string;
    dimension?: 'memory' | 'understanding' | 'application' | 'analysis';
    difficulty?: 1 | 2 | 3;
    cardId?: string;
  }>;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[NodeContent] Starting at', new Date().toISOString());

  try {
    const {
      topic,
      title,
      cardCount,
      course,
      nodeIndex,
      userProfile,
      userMemory,
    } = await request.json() as {
      topic: string;
      title: string;
      cardCount: number;
      course?: CourseTree;
      nodeIndex?: number;
      userProfile?: UserProfile | null;
      userMemory?: UserMemory | MemoryStoreV2 | null;
    };

    if (!topic || !title || !cardCount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const promptBuildStart = Date.now();
    const insights = userProfile?.insights || null;
    const memoryRepository = createMemoryRepository({
      initialMemory: userMemory,
      getProfile: () => userProfile || null,
    });
    const prerequisiteConcepts = typeof nodeIndex === 'number' && nodeIndex > 0
      ? course?.nodes.slice(0, nodeIndex).map((node) => node.title).slice(-2)
      : [];
    const teachingPayload = memoryRepository.getTeachingPayload({
      topic,
      nodeTitle: title,
      nodeConcepts: [title],
      prerequisiteConcepts,
    });
    const prompt = buildNodeContentPrompt(topic, title, cardCount, insights, userMemory && !('signals' in userMemory) ? userMemory : null, {
      difficultySummary: course?.difficultySummary,
      courseOutline: course?.nodes?.map((node) => node.title) || [],
      previousNodeTitle: typeof nodeIndex === 'number' && nodeIndex > 0 ? course?.nodes[nodeIndex - 1]?.title : undefined,
      prerequisiteTitles: prerequisiteConcepts,
      nextNodeTitle: typeof nodeIndex === 'number' ? course?.nodes[nodeIndex + 1]?.title : undefined,
      currentNodeGoal: `帮助用户掌握 ${title}，并为后续节点做好准备`,
    }, undefined, undefined, teachingPayload);
    console.log(`[NodeContent] Prompt built: ${Date.now() - promptBuildStart}ms`);

    const apiStart = Date.now();
    console.log('[NodeContent] Calling MiniMax API...');
    const content = await callMiniMaxWithSearch(prompt);
    console.log(`[NodeContent] MiniMax API: ${Date.now() - apiStart}ms`);
    console.log('[NodeContent] Raw response length:', content.length);
    console.log('[NodeContent] Raw response preview:', content.substring(0, 500));

    const parseStart = Date.now();
    const data = parseJSONResponse<NodeContentResponse>(content);
    console.log(`[NodeContent] Parse JSON: ${Date.now() - parseStart}ms`);

    console.log(`[NodeContent] Total: ${Date.now() - startTime}ms`);

    return NextResponse.json(data);
  } catch (error) {
    console.error(`[NodeContent] Error after ${Date.now() - startTime}ms:`, error);
    return NextResponse.json(
      { error: 'Failed to generate node content' },
      { status: 500 }
    );
  }
}
