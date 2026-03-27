import { NextRequest, NextResponse } from 'next/server'
import { isValidInviteCode } from '@/lib/redis'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { inviteCode } = body

    // 验证格式 xxxx-xxxx-xxxx
    const formatRegex = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/
    if (!formatRegex.test(inviteCode)) {
      return NextResponse.json(
        { valid: false, error: '邀请码格式不正确' },
        { status: 400 }
      )
    }

    // 验证邀请码是否存在
    if (!isValidInviteCode(inviteCode)) {
      return NextResponse.json(
        { valid: false, error: '邀请码不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json({ valid: true })
  } catch (error) {
    console.error('Verify invite code error:', error)
    return NextResponse.json(
      { valid: false, error: '验证失败，请重试' },
      { status: 500 }
    )
  }
}