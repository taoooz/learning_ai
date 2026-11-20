// app/api/learning/v2/checkpoints/evaluate/route.ts
// P3a Checkpoint 程序判分代理：薄透传层（鉴权 + 必填校验 → Python Agent）

import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL, pythonAgentHeaders } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const nextRequest = request instanceof NextRequest ? request : new NextRequest(request);
  const auth = requireAuth(nextRequest);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, code: 'INVALID_REQUEST', message: '请求体不是合法 JSON', retryable: false }, { status: 422 });
  }

  const { checkpointId, answer, idempotencyKey } = body as {
    checkpointId?: string; answer?: unknown; idempotencyKey?: string;
  };
  if (!checkpointId || answer === undefined || !idempotencyKey) {
    return Response.json(
      { ok: false, code: 'INVALID_REQUEST', message: '缺少必填字段（checkpointId/answer/idempotencyKey）', retryable: false },
      { status: 422 },
    );
  }

  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/learning/v2/checkpoints/evaluate`, {
      method: 'POST',
      headers: pythonAgentHeaders({ 'X-Account-Id': auth.inviteCode }),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    console.error('[V2 Checkpoint Evaluate Proxy] error:', error);
    return Response.json({ ok: false, code: 'UPSTREAM_UNREACHABLE', message: '判分服务不可用，请稍后重试', retryable: true }, { status: 503 });
  }
}
