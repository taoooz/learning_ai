import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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
    const codeExists = await prisma.inviteCode.findUnique({
      where: { code: inviteCode },
    })

    if (!codeExists) {
      return NextResponse.json(
        { success: false, error: '邀请码不存在' },
        { status: 404 }
      )
    }

    // 检查用户是否已存在（同一邀请码不可重复注册）
    const existingUser = await prisma.user.findUnique({
      where: { inviteCode },
    })

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: '该邀请码已被注册' },
        { status: 409 }
      )
    }

    // 创建用户
    const user = await prisma.user.create({
      data: {
        inviteCode,
        nickname: nickname.trim(),
      },
    })

    return NextResponse.json({
      success: true,
      user: {
        inviteCode: user.inviteCode,
        nickname: user.nickname,
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