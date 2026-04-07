import { NextRequest, NextResponse } from 'next/server';
import { createMemoryRepository } from '@/lib/memory/repository';
import { validateTocRequest } from '@/lib/validation/api-schemas';

// Python Agent 服务地址
const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const { blueprint, userMemory } = validateTocRequest(await request.json());

    // 获取个性化记忆
    const memoryRepository = createMemoryRepository({ initialMemory: userMemory });
    const planningPayload = memoryRepository.getPlanningPayload(blueprint.topic);

    console.log('[TOC API] Calling Python Agent');

    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/toc/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint, planningPayload }),
    });

    if (!response.ok) {
      throw new Error(`Python Agent error: ${response.status}`);
    }

    const result = await response.json();
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