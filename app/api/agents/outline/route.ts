import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Outline SSE 代理 — 直接 pipe Python Agent 的 SSE 流给前端
 * 前端自行流式消费 thinking/content/questions/blueprint 事件
 */
export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { topic, userProfile, planningMemory, userMessage, sessionId } = body;

    // 只有 sessionId 和 userMessage 都存在时才走 answer_agent（多轮回答）
    // 否则走 generate_agent（新课程生成），忽略可能残留的 sessionId
    const hasAnswer = !!(sessionId && userMessage);

    const agentUrl = hasAnswer
      ? `${PYTHON_AGENT_URL}/api/agents/outline/answer_agent`
      : `${PYTHON_AGENT_URL}/api/agents/outline/generate_agent`;
    const agentBody = hasAnswer
      ? { sessionId, answer: userMessage }
      : { topic, userProfile: userProfile || {}, planningMemory: planningMemory || {} };

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
