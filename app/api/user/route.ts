import { NextRequest, NextResponse } from 'next/server'
import { getRedis, userKey, UserData } from '@/lib/redis'

// GET /api/user - 获取当前用户信息
export async function GET(request: NextRequest) {
  try {
    const inviteCode = request.headers.get('x-invite-code')

    if (!inviteCode) {
      return NextResponse.json(
        { error: '未提供邀请码' },
        { status: 401 }
      )
    }

    const userDataRaw = await getRedis().get(userKey(inviteCode))
    const userData = userDataRaw ? JSON.parse(userDataRaw) as UserData : null

    if (!userData) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json(userData)
  } catch (error) {
    console.error('Get user error:', error)
    return NextResponse.json(
      { error: '获取用户信息失败' },
      { status: 500 }
    )
  }
}

// PATCH /api/user - 更新用户信息
export async function PATCH(request: NextRequest) {
  try {
    const inviteCode = request.headers.get('x-invite-code')

    if (!inviteCode) {
      return NextResponse.json(
        { error: '未提供邀请码' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { nickname } = body

    if (nickname !== undefined) {
      if (nickname.length < 1 || nickname.length > 20) {
        return NextResponse.json(
          { error: '昵称长度应为1-20字符' },
          { status: 400 }
        )
      }
    }

    // 获取现有用户
    const existingUserRaw = await getRedis().get(userKey(inviteCode))
    const existingUser = existingUserRaw ? JSON.parse(existingUserRaw) as UserData : null

    if (!existingUser) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      )
    }

    // 更新用户
    const updatedUser: UserData = {
      ...existingUser,
      nickname: nickname?.trim() || existingUser.nickname,
    }

    await getRedis().set(userKey(inviteCode), JSON.stringify(updatedUser))

    return NextResponse.json(updatedUser)
  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json(
      { error: '更新用户信息失败' },
      { status: 500 }
    )
  }
}