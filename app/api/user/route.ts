import { NextRequest } from 'next/server'
import { getRedis, userKey, UserData } from '@/lib/redis'
import { apiSuccess, apiError, requireAuth } from '@/lib/api-response'

// GET /api/user - 获取当前用户信息（身份取自鉴权 cookie，不再信任客户端请求头）
export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if ('error' in auth) return auth.error

  try {
    const userDataRaw = await getRedis().get(userKey(auth.inviteCode))
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
  const auth = requireAuth(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const { nickname } = body

    let nextNickname: string | undefined
    if (nickname !== undefined) {
      if (typeof nickname !== 'string' || nickname.trim().length < 1 || nickname.trim().length > 20) {
        return apiError('昵称长度应为1-20字符', 400)
      }
      nextNickname = nickname.trim()
    }

    const existingUserRaw = await getRedis().get(userKey(auth.inviteCode))
    const existingUser = existingUserRaw ? JSON.parse(existingUserRaw) as UserData : null

    if (!existingUser) {
      return apiError('用户不存在', 404)
    }

    const updatedUser: UserData = {
      ...existingUser,
      nickname: nextNickname ?? existingUser.nickname,
    }

    await getRedis().set(userKey(auth.inviteCode), JSON.stringify(updatedUser))

    return apiSuccess(updatedUser)
  } catch (error) {
    console.error('Update user error:', error)
    return apiError('更新用户信息失败', 500)
  }
}
