// app/api/learning/v2/tasks/stream/route.ts
// V2 任务内容流代理：字节级透传 Python Agent 的结构化 SSE（LearningSseEvent 外壳）
// 与 outline 透传的两点差异：显式 charset=utf-8（中文任意切分安全由前端 TextDecoder stream 保证）；
// 上游非 2xx 时原样转发错误体（如校验失败的 422 JSON），而不是抛通用 500

import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, code: 'INVALID_REQUEST', message: '请求体不是合法 JSON', retryable: false },
      { status: 422 },
    );
  }

  const { courseId, chapterId, planId, taskId } = (body ?? {}) as {
    courseId?: string;
    chapterId?: string;
    planId?: string;
    taskId?: string;
  };
  if (!courseId || !chapterId || !planId || !taskId) {
    return Response.json(
      { ok: false, code: 'INVALID_REQUEST', message: '缺少 courseId/chapterId/planId/taskId', retryable: false },
      { status: 422 },
    );
  }

  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/learning/v2/tasks/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      // 流未开始即失败（如 422 参数校验）：错误体原样转发，保留状态码与 code
      const text = await response.text();
      return new Response(text, {
        status: response.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // 字节级透传 SSE 流
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    // 客户端断开导致的 abort 不需要报 503
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    console.error('[V2 Task Stream Proxy] error:', error);
    return Response.json(
      { ok: false, code: 'UPSTREAM_UNREACHABLE', message: '任务流服务不可用，请稍后重试', retryable: true },
      { status: 503 },
    );
  }
}
