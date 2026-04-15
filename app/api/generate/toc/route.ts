import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';

/**
 * TOC SSE 代理 — 直接 pipe Python Agent 的 SSE 流给前端
 * 前端自行消费 thinking/course_name/course_description/node/complete 事件
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { blueprint } = body;

    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/toc/generate_agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint }),
    });

    if (!response.ok) {
      throw new Error(`Python Agent error: ${response.status}`);
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[TOC proxy] Error:', error);
    return new Response(
      JSON.stringify({ error: '目录生成失败，请确保 Python Agent 服务已启动' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
