// app/api/chat/route.ts — Chat SSE 代理
// 前端发送结构化数据，直接 pipe 到 Python Agent
// Python Agent 负责构建 system prompt 并调用 LLM
import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.courseTopic || !body.messages) {
      return new Response('Missing required fields', { status: 400 });
    }

    // 直接转发到 Python Agent（prompt 构建已迁移到 chat_agent.py）
    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/chat/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    console.error('[Chat] Error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
