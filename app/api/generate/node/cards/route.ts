// app/api/generate/node/cards/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildCardsPrompt } from '@/lib/prompt';
import { createMemoryRepository } from '@/lib/memory/repository';
import { validateCardsRequest } from '@/lib/validation/api-schemas';

export async function POST(request: NextRequest) {
  try {
    const { topic, nodeInfo, userMemory } = validateCardsRequest(await request.json());

    // 获取教学记忆
    const memoryRepository = createMemoryRepository({ initialMemory: userMemory });
    const teachingPayload = memoryRepository.getTeachingPayload({
      topic,
      nodeTitle: nodeInfo.title || '',
      nodeConcepts: nodeInfo.teachConceptIds || [],
      prerequisiteConcepts: nodeInfo.prerequisiteConceptIds || [],
    });

    const prompt = buildCardsPrompt(
      topic, 
      nodeInfo, 
      { backgroundSummary: '', skipBasics: [] }
    );
    const content = await callMiniMax(prompt, { maxTokens: 4000 });
    const result = parseJSONResponse<{ cards: any[] }>(content);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Cards API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cards generation failed' },
      { status: error instanceof Error && error.message.startsWith('Missing') ? 400 : 500 }
    );
  }
}
