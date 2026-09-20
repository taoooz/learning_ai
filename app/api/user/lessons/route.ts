// app/api/user/lessons/route.ts
// P5.1 用户学习容器代理：GET 读取 / PUT 保存（乐观锁 409 原样透传）

import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

async function proxy(request: NextRequest, method: 'GET' | 'PUT'): Promise<Response> {
  const nextRequest = request instanceof NextRequest ? request : new NextRequest(request);
  const auth = requireAuth(nextRequest);
  if ('error' in auth) return auth.error;

  let url = `${PYTHON_AGENT_URL}/api/user/lessons`;
  let body: string | undefined;
  if (method === 'GET') {
    const courseId = nextRequest.nextUrl.searchParams.get('courseId');
    const chapterId = nextRequest.nextUrl.searchParams.get('chapterId');
    if (!courseId || !chapterId) {
      return Response.json({ ok: false, code: 'INVALID_REQUEST', message: '缺少 courseId/chapterId', retryable: false }, { status: 422 });
    }
    url += `?courseId=${encodeURIComponent(courseId)}&chapterId=${encodeURIComponent(chapterId)}`;
  } else {
    body = await request.text();
  }
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Account-Id': auth.inviteCode },
      body,
    });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (error) {
    console.error('[UserLessons Proxy] error:', error);
    return Response.json({ ok: false, code: 'UPSTREAM_UNREACHABLE', message: '用户数据服务不可用', retryable: true }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  return proxy(request, 'GET');
}

export async function PUT(request: NextRequest) {
  return proxy(request, 'PUT');
}
