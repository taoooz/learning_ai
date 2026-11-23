import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_AGENT_URL, pythonAgentHeaders } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';
import { isPromptLabEnabled } from '@/lib/prompt-lab/config';

export async function POST(request: NextRequest) {
  if (!isPromptLabEnabled()) {
    return NextResponse.json({ error: 'Prompt Lab 未启用' }, { status: 404 });
  }
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const response = await fetch(`${PYTHON_AGENT_URL}/api/debug/course-pipeline/run`, {
      method: 'POST',
      headers: pythonAgentHeaders({ 'X-Account-Id': auth.inviteCode }),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Prompt 运行失败' }));
      return NextResponse.json(payload, { status: response.status });
    }
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Prompt Lab run]', error);
    return NextResponse.json({ error: 'Prompt 运行失败，请确认 Python Agent 已启动' }, { status: 500 });
  }
}
