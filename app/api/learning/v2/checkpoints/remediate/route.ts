// app/api/learning/v2/checkpoints/remediate/route.ts
// P3a 补救内容生成代理：薄透传层（鉴权 + 必填校验 → Python Agent）

import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';
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

  const required = ['courseTopic', 'chapterTitle', 'taskId', 'taskTitle', 'taskGoal', 'originalPrompt', 'userAnswer', 'correctAnswer', 'originalHint', 'taskContentSummary', 'idempotencyKey'] as const;
  const missing = required.filter((key) => !body[key]);
  if (missing.length > 0) {
    return Response.json(
      { ok: false, code: 'INVALID_REQUEST', message: `缺少必填字段：${missing.join('、')}`, retryable: false },
      { status: 422 },
    );
  }

  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/learning/v2/checkpoints/remediate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    console.error('[V2 Checkpoint Remediate Proxy] error:', error);
    return Response.json({ ok: false, code: 'UPSTREAM_UNREACHABLE', message: '补救内容服务不可用，请稍后重试', retryable: true }, { status: 503 });
  }
}
