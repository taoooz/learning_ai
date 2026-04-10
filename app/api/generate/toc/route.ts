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
      const responseText = await response.text();
      let parsedDetail = responseText;

      try {
        const parsed = JSON.parse(responseText) as { detail?: string; error?: string; message?: string };
        parsedDetail = parsed.detail || parsed.error || parsed.message || responseText;
      } catch {
        // keep raw text
      }

      throw new Error(`Python Agent error: ${response.status}${parsedDetail ? ` - ${parsedDetail}` : ''}`);
    }

    // 检查是否是流式响应（Python Agent返回SSE）
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('text/event-stream')) {
      // 直接转发流式响应给前端
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // 兼容非流式响应（如果Python Agent返回JSON）
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
