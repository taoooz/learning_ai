import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

    const user = await prisma.user.findUnique({
      where: { inviteCode },
      select: {
        inviteCode: true,
        nickname: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json(user)
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

    const user = await prisma.user.update({
      where: { inviteCode },
      data: {
        ...(nickname && { nickname: nickname.trim() }),
      },
      select: {
        inviteCode: true,
        nickname: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json(user)
  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json(
      { error: '更新用户信息失败' },
      { status: 500 }
    )
  }
}