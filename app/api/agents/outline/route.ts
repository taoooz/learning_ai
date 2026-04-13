import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';

/**
 * Outline SSE 代理 — 直接 pipe Python Agent 的 SSE 流给前端
 * 前端自行流式消费 thinking/content/questions/blueprint 事件
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, userProfile, userMemory, userMessage, sessionId } = body;

    let agentUrl: string;
    let agentBody: Record<string, any>;

    if (sessionId) {
      agentUrl = `${PYTHON_AGENT_URL}/api/agents/outline/answer_agent`;
      agentBody = { sessionId, answer: userMessage };
    } else {
      agentUrl = `${PYTHON_AGENT_URL}/api/agents/outline/generate_agent`;
      agentBody = { topic, userProfile: userProfile || {}, userMemory: userMemory || {} };
    }

    const response = await fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentBody),
    });

    if (!response.ok) {
      throw new Error(`Python Agent error: ${response.status}`);
    }

    // 直接 pipe SSE 流给前端
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Agent proxy error:', error);
    return new Response(
      JSON.stringify({ error: 'Agent 服务调用失败，请确保 Python Agent 服务已启动' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
