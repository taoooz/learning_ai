import { NextRequest } from 'next/server';
import { validateOutlineRequest } from '@/lib/validation/api-schemas';

// Python Agent 服务地址
const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { topic, userProfile, userMemory, userMessage, sessionId } = validateOutlineRequest(await request.json());

    // 如果有 sessionId，说明是继续对话，调用 answer 端点
    const endpoint = sessionId
      ? `${PYTHON_AGENT_URL}/api/agents/outline/answer_agent`
      : `${PYTHON_AGENT_URL}/api/agents/outline/generate_agent`;

    const requestBody = sessionId
      ? { sessionId, answer: userMessage }
      : { topic, userProfile: userProfile ?? {}, userMemory: userMemory ?? {} };

    console.log('[Outline API] Calling Python Agent:', endpoint);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[Outline API] Python Agent error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: `Agent 服务调用失败 (${response.status})` }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const upstreamContentType = response.headers.get('content-type') || '';
    console.log('[Outline API] Upstream content-type:', upstreamContentType);

    // 上游返回 SSE → 直接透传
    if (upstreamContentType.includes('text/event-stream')) {
      console.log('[Outline API] → SSE passthrough');
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // 上游返回 JSON → 包装为单条 SSE 事件，前端无需区分
    // （兼容 Python Agent 尚未改造为 SSE 的过渡阶段）
    const json = await response.json();
    console.log('[Outline API] → JSON wrapped as SSE. Keys:', Object.keys(json), '| type:', (json as any).type);
    const ssePayload = `data: ${JSON.stringify(json)}\n\n`;
    return new Response(ssePayload, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Outline API] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Agent 服务调用失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
