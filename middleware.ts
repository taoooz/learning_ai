import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 需要登录才能访问的路径
const protectedPaths = ['/', '/course']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 检查是否是受保护路径
  const isProtectedPath = protectedPaths.some((path) =>
    pathname === path || pathname.startsWith(path + '/')
  )

  if (!isProtectedPath) {
    return NextResponse.next()
  }

  // 检查登录态
  const inviteCode = request.cookies.get('ai-learning-auth')?.value

  if (!inviteCode) {
    // 重定向到登录页
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/course/:path*'],
}