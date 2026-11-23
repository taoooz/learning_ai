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
    const response = await fetch(`${PYTHON_AGENT_URL}/api/debug/course-pipeline/memory-snapshot`, {
      method: 'POST',
      headers: pythonAgentHeaders({ 'X-Account-Id': auth.inviteCode }),
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({ error: 'Memory 快照读取失败' }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error('[Prompt Lab memory snapshot]', error);
    return NextResponse.json({ error: 'Memory 快照读取失败' }, { status: 500 });
  }
}
