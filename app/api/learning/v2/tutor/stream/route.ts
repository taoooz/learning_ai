// app/api/learning/v2/tutor/stream/route.ts
// V2 流内答疑（Tutor）代理：鉴权与必填字段校验后，字节级透传 Python Agent 的结构化 SSE
// 与任务流代理一致的约定：显式 charset=utf-8（中文任意切分安全由前端 TextDecoder stream 保证）；
// 上游非 2xx 时原样转发错误体（如校验失败的 422 JSON），而不是抛通用 500

import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // 兼容测试环境直接构造原生 Request 的调用（Next 运行时传入的本就是 NextRequest）
  const nextRequest = request instanceof NextRequest ? request : new NextRequest(request);

  const auth = requireAuth(nextRequest);
  if ('error' in auth) return auth.error;

  let body: unknown;
  try {
    body = await nextRequest.json();
  } catch {
    return Response.json(
      { ok: false, code: 'INVALID_REQUEST', message: '请求体不是合法 JSON', retryable: false },
      { status: 422 },
    );
  }

  const { mode, question, chapter, task, idempotencyKey } = (body ?? {}) as {
    mode?: string;
    question?: unknown;
    chapter?: unknown;
    task?: unknown;
    idempotencyKey?: string;
  };
  if (!mode || !question || !chapter || !task || !idempotencyKey) {
    return Response.json(
      { ok: false, code: 'INVALID_REQUEST', message: '缺少 mode/question/chapter/task/idempotencyKey', retryable: false },
      { status: 422 },
    );
  }

  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/learning/v2/tutor/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: nextRequest.signal,
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
    console.error('[V2 Tutor Stream Proxy] error:', error);
    return Response.json(
      { ok: false, code: 'UPSTREAM_UNREACHABLE', message: '答疑服务不可用，请稍后重试', retryable: true },
      { status: 503 },
    );
  }
}
