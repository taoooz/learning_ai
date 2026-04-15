// lib/api-response.ts
// 统一的 API 响应格式

import { NextRequest, NextResponse } from 'next/server';

interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export function apiSuccess<T>(data: T, status = 200): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(error: string, status = 400): NextResponse<ApiErrorResponse> {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * 检查请求是否已认证（cookie 中有有效的邀请码）
 * 返回 inviteCode 或 null（未认证时附带 401 响应）
 */
export function requireAuth(request: NextRequest): { inviteCode: string } | { error: NextResponse } {
  const inviteCode = request.cookies.get('ai-learning-auth')?.value;
  if (!inviteCode) {
    return { error: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  }
  return { inviteCode };
}
