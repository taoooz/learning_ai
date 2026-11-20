// app/api/memory/refine/route.ts — V3 Memory 精炼入口（已下线）
// Memory V4 已替换 V3；这里显式拒绝，避免旧客户端误用双轨写入。
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-response';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;
  return NextResponse.json(
    {
      ok: false,
      code: 'MEMORY_V3_RETIRED',
      message: '旧版 Memory 精炼接口已停用，请使用 Memory V4。',
      retryable: false,
    },
    { status: 410 },
  );
}
