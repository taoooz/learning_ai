// lib/api-contract.ts
// 前后端共享的 API 响应契约（纯函数，无 next/server 依赖，客户端可安全引用）

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * 客户端解包 apiSuccess/apiError 响应
 * 返回 data 或抛出错误
 */
export function unwrapApiResponse<T>(raw: { success?: boolean; data?: T; error?: string }): T {
  if (raw.success === true && raw.data !== undefined) {
    return raw.data;
  }
  if (raw.success === false && raw.error) {
    throw new Error(raw.error);
  }
  // 兼容未包装的旧格式
  return raw as unknown as T;
}
