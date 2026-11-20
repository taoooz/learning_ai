import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL, pythonAgentHeaders } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ memoryId: string }> },
) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;
  const { memoryId } = await context.params;
  const reason = request.nextUrl.searchParams.get('reason') || 'user_forget';
  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/user/memory/records/${encodeURIComponent(memoryId)}?reason=${encodeURIComponent(reason)}`, {
      method: 'DELETE',
      headers: pythonAgentHeaders({ 'X-Account-Id': auth.inviteCode }),
    });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch {
    return Response.json({ ok: false, code: 'UPSTREAM_UNREACHABLE', message: 'Memory 删除服务不可用', retryable: true }, { status: 503 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ memoryId: string }> },
) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;
  const { memoryId } = await context.params;
  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/user/memory/records/${encodeURIComponent(memoryId)}`, {
      method: 'PATCH',
      headers: pythonAgentHeaders({ 'X-Account-Id': auth.inviteCode }),
      body: await request.text(),
    });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch {
    return Response.json({ ok: false, code: 'UPSTREAM_UNREACHABLE', message: 'Memory 更新服务不可用', retryable: true }, { status: 503 });
  }
}
