// app/api/learning/v2/chapters/plan/route.ts
// V2 章节计划代理：薄透传层
// 前端校验（必填）→ Python Agent 生成/校验计划 → 原样回传（成功体或错误体）
// 上游错误体含 {ok, code, message, retryable}，状态码与 code 原样转发，前端据此决定重试与提示

import { NextRequest } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

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

  const { courseId, chapterId, blueprint } = (body ?? {}) as {
    courseId?: string;
    chapterId?: string;
    blueprint?: unknown;
  };
  if (!courseId || !chapterId || !blueprint) {
    return Response.json(
      { ok: false, code: 'INVALID_REQUEST', message: '缺少 courseId/chapterId/blueprint', retryable: false },
      { status: 422 },
    );
  }

  try {
    const response = await fetch(`${PYTHON_AGENT_URL}/api/learning/v2/chapters/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // 上游响应（成功或错误）原样转发，保留状态码与 code/message
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    console.error('[V2 Plan Proxy] error:', error);
    return Response.json(
      { ok: false, code: 'UPSTREAM_UNREACHABLE', message: '计划服务不可用，请稍后重试', retryable: true },
      { status: 503 },
    );
  }
}
