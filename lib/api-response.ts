// lib/api-response.ts
// 统一的 API 响应格式（服务端用；客户端请从 lib/api-contract.ts 引入）

import { NextResponse } from 'next/server';
import type { ApiSuccessResponse, ApiErrorResponse } from './api-contract';

export type { ApiResponse, ApiSuccessResponse, ApiErrorResponse } from './api-contract';
export { unwrapApiResponse } from './api-contract';

export function apiSuccess<T>(data: T, status = 200): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(error: string, status = 400): NextResponse<ApiErrorResponse> {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * 检查请求是否已认证（cookie 中有有效的邀请码）
 * 返回 inviteCode 或 null（未认证时附带 401 响应）
 * 实现统一在 lib/auth.ts，此处保留导出以兼容现有调用方
 */
export { requireAuth } from './auth';
