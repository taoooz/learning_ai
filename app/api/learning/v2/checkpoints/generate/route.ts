// app/api/learning/v2/checkpoints/generate/route.ts
// P3a Checkpoint 生成代理：薄透传层（鉴权 + 必填校验 → Python Agent）

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

  const { courseId, chapterId, taskId, objectiveId, courseTopic, chapter, task, taskContentSummary, idempotencyKey } = body as {
    courseId?: string; chapterId?: string; taskId?: string; objectiveId?: string;
    courseTopic?: string; chapter?: unknown; task?: unknown;
    taskContentSummary?: string; idempotencyKey?: string;
  };
  if (!courseId || !chapterId || !taskId || !objectiveId || !courseTopic || !chapter || !task || !taskContentSummary || !idempotencyKey) {
    return Response.json(
      { ok: false, code: 'INVALID_REQUEST', message: '缺少必填字段（courseId/chapterId/taskId/objectiveId/courseTopic/chapter/task/taskContentSummary/idempotencyKey）', retryable: false },
      { status: 422 },
    );
  }

  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/learning/v2/checkpoints/generate`, {
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
    console.error('[V2 Checkpoint Generate Proxy] error:', error);
    return Response.json({ ok: false, code: 'UPSTREAM_UNREACHABLE', message: '检查题生成服务不可用，请稍后重试', retryable: true }, { status: 503 });
  }
}
