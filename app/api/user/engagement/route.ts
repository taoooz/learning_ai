// app/api/user/engagement/route.ts
// P5.1 参与信号服务端追加代理（fire-and-forget，前端写失败静默）

import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const nextRequest = request instanceof NextRequest ? request : new NextRequest(request);
  const auth = requireAuth(nextRequest);
  if ('error' in auth) return auth.error;

  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/user/engagement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Id': auth.inviteCode },
      body: await request.text(),
    });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (error) {
    console.error('[UserEngagement Proxy] error:', error);
    return Response.json({ ok: false, code: 'UPSTREAM_UNREACHABLE', message: '参与信号服务不可用', retryable: true }, { status: 503 });
  }
}
