import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL, pythonAgentHeaders } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

async function proxy(request: NextRequest, method: 'GET' | 'POST') {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;
  const courseId = request.nextUrl.searchParams.get('courseId');
  const url = new URL(`${PYTHON_AGENT_URL}/api/user/memory/chat-summary`);
  if (courseId) url.searchParams.set('courseId', courseId);
  try {
    const response = await fetch(url, {
      method,
      headers: pythonAgentHeaders({ 'X-Account-Id': auth.inviteCode }),
      body: method === 'POST' ? await request.text() : undefined,
    });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch {
    return Response.json({ ok: false, code: 'UPSTREAM_UNREACHABLE', message: '对话摘要服务不可用', retryable: true }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  return proxy(request, 'GET');
}

export async function POST(request: NextRequest) {
  return proxy(request, 'POST');
}
