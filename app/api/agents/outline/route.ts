import { NextRequest } from 'next/server';

// Python Agent 服务地址
const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, userProfile, userMemory, userMessage, sessionId } = body;

    console.log('[Outline API] Request:', { topic, sessionId, hasUserMessage: !!userMessage });

    // 如果有 sessionId，说明是继续对话，调用 answer 端点
    const endpoint = sessionId
      ? `${PYTHON_AGENT_URL}/api/agents/outline/answer`
      : `${PYTHON_AGENT_URL}/api/agents/outline/generate`;

    const requestBody = sessionId
      ? { sessionId, answer: userMessage }
      : { topic, userProfile: userProfile || {}, userMemory: userMemory || {} };

    console.log('[Outline API] Calling Python Agent:', endpoint);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error('[Outline API] Python Agent error:', response.status);
      throw new Error(`Python Agent error: ${response.status}`);
    }

    // 检查是否是流式响应
    const contentType = response.headers.get('content-type');
    console.log('[Outline API] Response content-type:', contentType);
    
    if (contentType?.includes('text/event-stream')) {
      console.log('[Outline API] Forwarding SSE stream to client');
      
      // 直接转发流式响应给前端
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // 非流式响应
    console.log('[Outline API] Processing JSON response');
    const data = await response.json();
    console.log('[Outline API] Returning JSON data:', data.type);
    return Response.json(data);
  } catch (error) {
    console.error('[Outline API] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Agent 服务调用失败' },
      { status: 500 }
    );
  }
}
