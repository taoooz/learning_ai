import { NextRequest, NextResponse } from 'next/server';
import { buildTocPrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { createMemoryRepository } from '@/lib/memory/repository';
import { validateTocRequest } from '@/lib/validation/api-schemas';

export async function POST(request: NextRequest) {
  try {
    const { blueprint, userMemory } = validateTocRequest(await request.json());

    // 获取个性化记忆
    const memoryRepository = createMemoryRepository({ initialMemory: userMemory });
    const planningPayload = memoryRepository.getPlanningPayload(blueprint.topic);

    const prompt = buildTocPrompt(blueprint, planningPayload);

    const content = await callMiniMax(prompt);

    const result = parseJSONResponse(content);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[TOC API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'TOC generation failed',
        details: error instanceof Error ? error.stack : String(error),
      },
      { status: 500 }
    );
  }
}