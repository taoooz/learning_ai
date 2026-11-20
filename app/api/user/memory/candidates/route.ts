import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL, pythonAgentHeaders } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;
  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/user/memory/candidates`, {
      headers: pythonAgentHeaders({ 'X-Account-Id': auth.inviteCode }),
      cache: 'no-store',
    });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch {
    return Response.json({ ok: false, code: 'UPSTREAM_UNREACHABLE', message: 'Memory 候选服务不可用', retryable: true }, { status: 503 });
  }
}
