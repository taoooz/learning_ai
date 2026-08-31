// app/api/memory/refine/route.ts — Memory 精炼代理
// 前端发送最近对话和事件数据，Python Agent 调用 LLM 分析后返回结构化洞察
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_AGENT_URL } from '@/lib/agent-config';
import { requireAuth } from '@/lib/api-response';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();

    if (!body.recentMessages || !Array.isArray(body.recentMessages)) {
      return NextResponse.json({ error: 'Missing recentMessages' }, { status: 400 });
    }

    const response = await fetch(`${PYTHON_AGENT_URL}/api/agents/memory/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Python Agent error: ${response.status}`);
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Memory Refine] Error:', error);
    return NextResponse.json(
      { summary: null, preferenceUpdates: [], conceptCorrections: [] },
      { status: 500 },
    );
  }
}
