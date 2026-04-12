import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { inviteCode } = body

    if (!inviteCode) {
      return NextResponse.json({ error: '缺少邀请码' }, { status: 400 })
    }

    const response = NextResponse.json({ success: true })
    response.cookies.set('ai-learning-auth', inviteCode, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 天
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Set cookie error:', error)
    return NextResponse.json({ error: '设置失败' }, { status: 500 })
  }
}