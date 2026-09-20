// app/api/user/courses/route.ts
// P5.1 用户课程数据代理：鉴权 → 以 X-Account-Id 传递账户身份 → Python Agent 文件存储

import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

async function proxy(request: NextRequest, method: 'GET' | 'POST'): Promise<Response> {
  const nextRequest = request instanceof NextRequest ? request : new NextRequest(request);
  const auth = requireAuth(nextRequest);
  if ('error' in auth) return auth.error;

  let body: string | undefined;
  if (method === 'POST') {
    body = await request.text();
  }
  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/user/courses`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Account-Id': auth.inviteCode },
      body,
    });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (error) {
    console.error('[UserCourses Proxy] error:', error);
    return Response.json({ ok: false, code: 'UPSTREAM_UNREACHABLE', message: '用户数据服务不可用', retryable: true }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  return proxy(request, 'GET');
}

export async function POST(request: NextRequest) {
  return proxy(request, 'POST');
}
