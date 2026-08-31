// lib/auth.ts
// 统一鉴权模块：Edge middleware 与 Node API 路由共用，零 ioredis 依赖（Edge 安全）
//
// 鉴权模型：
//   - 身份凭证 = httpOnly cookie 中的邀请码（格式 xxxx-xxxx-xxxx）
//   - 校验 = 格式有效 && 允许名单通过（见 isAllowedInviteCode）
//   - 模式由服务端环境变量决定（见 getAuthMode），客户端通过 /api/auth/config 获取
//
// 扩展位：将来接入 Supabase 等外部用户系统时，在 getAuthMode 增加新的
// AuthMode 并在 requireAuth 中按模式分支即可，调用方无需改动。

import { NextRequest, NextResponse } from 'next/server'

export const AUTH_COOKIE_NAME = 'ai-learning-auth'

export type AuthMode = 'redis' | 'local'

// 邀请码格式校验：xxxx-xxxx-xxxx
export function isValidInviteCodeFormat(code: string): boolean {
  return /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(code)
}

// 解析环境变量中的邀请码允许名单（逗号分隔）
export function getInviteCodeAllowlist(): string[] {
  return process.env.INVITE_CODES
    ? process.env.INVITE_CODES.split(',').map((s) => s.trim()).filter(Boolean)
    : []
}

/**
 * 邀请码是否被允许。
 * 名单为空时放行所有格式有效的邀请码——保证本地调试（无 Redis、未配名单）可用；
 * 生产环境应显式配置 INVITE_CODES。
 */
export function isAllowedInviteCode(code: string): boolean {
  const allowlist = getInviteCodeAllowlist()
  if (allowlist.length === 0) return true
  return allowlist.includes(code)
}

// cookie 中的邀请码能否通过鉴权
export function isValidAuthCode(code: string | undefined | null): code is string {
  return !!code && isValidInviteCodeFormat(code) && isAllowedInviteCode(code)
}

// 当前鉴权模式：配置了 REDIS_URL 走 Redis，否则本地模式
export function getAuthMode(): AuthMode {
  return process.env.REDIS_URL ? 'redis' : 'local'
}

// 统一的鉴权 cookie 选项
export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30, // 30 天
    path: '/',
  }
}

/**
 * 检查请求是否已认证（cookie 携带格式有效且在允许名单内的邀请码）
 * 返回 inviteCode，或鉴权失败时返回 401 响应
 */
export function requireAuth(
  request: NextRequest
): { inviteCode: string } | { error: NextResponse } {
  const inviteCode = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (!isValidAuthCode(inviteCode)) {
    return { error: NextResponse.json({ error: '未登录或登录已失效' }, { status: 401 }) }
  }
  return { inviteCode }
}
