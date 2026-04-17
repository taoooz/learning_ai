import { NextRequest } from 'next/server'
import { getRedis, userKey, UserData } from '@/lib/redis'
import { apiSuccess, apiError } from '@/lib/api-response'

// GET /api/user - 获取当前用户信息
export async function GET(request: NextRequest) {
  try {
    const inviteCode = request.headers.get('x-invite-code')

    if (!inviteCode) {
      return apiError('未提供邀请码', 401)
    }

    const userDataRaw = await getRedis().get(userKey(inviteCode))
    const userData = userDataRaw ? JSON.parse(userDataRaw) as UserData : null

    if (!userData) {
      return apiError('用户不存在', 404)
    }

    return apiSuccess(userData)
  } catch (error) {
    console.error('Get user error:', error)
    return apiError('获取用户信息失败', 500)
  }
}

// PATCH /api/user - 更新用户信息
export async function PATCH(request: NextRequest) {
  try {
    const inviteCode = request.headers.get('x-invite-code')

    if (!inviteCode) {
      return apiError('未提供邀请码', 401)
    }

    const body = await request.json()
    const { nickname } = body

    if (nickname !== undefined) {
      if (nickname.length < 1 || nickname.length > 20) {
        return apiError('昵称长度应为1-20字符', 400)
      }
    }

    const existingUserRaw = await getRedis().get(userKey(inviteCode))
    const existingUser = existingUserRaw ? JSON.parse(existingUserRaw) as UserData : null

    if (!existingUser) {
      return apiError('用户不存在', 404)
    }

    const updatedUser: UserData = {
      ...existingUser,
      nickname: nickname?.trim() || existingUser.nickname,
    }

    await getRedis().set(userKey(inviteCode), JSON.stringify(updatedUser))

    return apiSuccess(updatedUser)
  } catch (error) {
    console.error('Update user error:', error)
    return apiError('更新用户信息失败', 500)
  }
}
