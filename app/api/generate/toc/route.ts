import { NextRequest, NextResponse } from 'next/server';
import { buildTocPrompt } from '@/lib/prompt';
import { callMiniMax, parseJSONResponse } from '@/lib/minimax';
import { createMemoryRepository } from '@/lib/memory/repository';

export async function POST(request: NextRequest) {
  try {
    const { blueprint, userMemory } = await request.json();

    console.log('[TOC API] Received blueprint:', JSON.stringify(blueprint, null, 2));

    // 获取个性化记忆
    const memoryRepository = createMemoryRepository({ initialMemory: userMemory });
    const planningPayload = memoryRepository.getPlanningPayload(blueprint.topic);

    const prompt = buildTocPrompt(blueprint, planningPayload);
    console.log('[TOC API] Calling MiniMax with personalized memory...');

    const content = await callMiniMax(prompt);
    console.log('[TOC API] Received content length:', content.length);

    const result = parseJSONResponse(content);
    console.log('[TOC API] Parsed result:', JSON.stringify(result, null, 2));

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