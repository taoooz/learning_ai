import { NextRequest, NextResponse } from 'next/server'
import { redis, isValidInviteCode, userKey, UserData } from '@/lib/redis'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { inviteCode, nickname } = body

    // 验证必填
    if (!inviteCode || !nickname) {
      return NextResponse.json(
        { success: false, error: '邀请码和昵称不能为空' },
        { status: 400 }
      )
    }

    // 验证昵称长度
    if (nickname.length < 1 || nickname.length > 20) {
      return NextResponse.json(
        { success: false, error: '昵称长度应为1-20字符' },
        { status: 400 }
      )
    }

    // 验证邀请码格式
    const formatRegex = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/
    if (!formatRegex.test(inviteCode)) {
      return NextResponse.json(
        { success: false, error: '邀请码格式不正确' },
        { status: 400 }
      )
    }

    // 验证邀请码存在
    if (!isValidInviteCode(inviteCode)) {
      return NextResponse.json(
        { success: false, error: '邀请码不存在' },
        { status: 404 }
      )
    }

    // 检查用户是否已存在
    const existingUser = await redis.get<UserData>(userKey(inviteCode))

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: '该邀请码已被注册' },
        { status: 409 }
      )
    }

    // 创建用户（存储到 Redis）
    const userData: UserData = {
      inviteCode,
      nickname: nickname.trim(),
      createdAt: new Date().toISOString(),
    }

    await redis.set(userKey(inviteCode), JSON.stringify(userData))

    return NextResponse.json({
      success: true,
      user: {
        inviteCode: userData.inviteCode,
        nickname: userData.nickname,
      },
    })
  } catch (error) {
    console.error('Register error:', error)
    return NextResponse.json(
      { success: false, error: '注册失败，请重试' },
      { status: 500 }
    )
  }
}