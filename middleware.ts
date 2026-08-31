import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { AUTH_COOKIE_NAME, isValidAuthCode } from '@/lib/auth'

// 需要登录才能访问的路径（排除公开页面）
const protectedPaths = ['/', '/course', '/generate', '/profile', '/review']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 公开页面不需要登录
  if (pathname === '/login') {
    return NextResponse.next()
  }

  // 检查是否是受保护路径
  const isProtectedPath = protectedPaths.some((path) =>
    pathname === path || pathname.startsWith(path + '/')
  )

  if (!isProtectedPath) {
    return NextResponse.next()
  }

  // 检查登录态（cookie 中的邀请码必须格式有效且在允许名单内）
  const inviteCode = request.cookies.get(AUTH_COOKIE_NAME)?.value

  if (!isValidAuthCode(inviteCode)) {
    // 重定向到登录页，带上原页面路径；无效/过期 cookie 一并清除
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    const response = NextResponse.redirect(loginUrl)
    if (inviteCode) {
      response.cookies.delete(AUTH_COOKIE_NAME)
    }
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/course/:path*', '/generate/:path*', '/profile/:path*', '/review/:path*'],
}
