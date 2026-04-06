// app/api/generate/node/questions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { buildQuestionsPrompt } from '@/lib/prompt';
import { createMemoryRepository } from '@/lib/memory/repository';
import { validateQuestionsRequest } from '@/lib/validation/api-schemas';

export async function POST(request: NextRequest) {
  try {
    const { topic, nodeInfo, cards, userMemory } = validateQuestionsRequest(await request.json());

    // 获取教学记忆
    const memoryRepository = createMemoryRepository({ initialMemory: userMemory });
    const teachingPayload = memoryRepository.getTeachingPayload({
      topic,
      nodeTitle: nodeInfo.title || '',
      nodeConcepts: nodeInfo.teachConceptIds || [],
      prerequisiteConcepts: nodeInfo.prerequisiteConceptIds || [],
    });

    const prompt = buildQuestionsPrompt(topic, nodeInfo, cards);
    const content = await callMiniMax(prompt, { maxTokens: 3000 });
    const result = parseJSONResponse<{ questions: any[] }>(content);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Questions API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Questions generation failed' },
      { status: error instanceof Error && error.message.startsWith('Missing') ? 400 : 500 }
    );
  }
}
