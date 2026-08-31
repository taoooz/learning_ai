import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, authCookieOptions, isValidAuthCode } from '@/lib/auth'

// 签发鉴权 cookie：必须先通过邀请码校验（格式 + 允许名单），杜绝任意字符串换取登录态
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { inviteCode } = body

    if (!isValidAuthCode(inviteCode)) {
      return NextResponse.json({ error: '邀请码无效' }, { status: 403 })
    }

    const response = NextResponse.json({ success: true })
    response.cookies.set(AUTH_COOKIE_NAME, inviteCode, authCookieOptions())

    return response
  } catch (error) {
    console.error('Set cookie error:', error)
    return NextResponse.json({ error: '设置失败' }, { status: 500 })
  }
}
