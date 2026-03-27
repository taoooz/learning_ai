'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

interface User {
  inviteCode: string
  nickname: string
  createdAt?: string
  updatedAt?: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isVerified: boolean  // 邀请码已验证但未注册
  verifiedCode: string | null
  verifyInviteCode: (code: string) => Promise<{ valid: boolean; error?: string }>
  register: (nickname: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  updateNickname: (nickname: string) => Promise<{ success: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const STORAGE_KEY = 'ai-learning-auth'
const USER_CACHE_KEY = 'ai-learning-user'

// 检查是否有 Redis 配置
const hasRedisConfig = typeof window !== 'undefined' && (
  process.env.NEXT_PUBLIC_KV_REST_API_URL || process.env.KV_REST_API_URL
)

// 设置 cookie（供 AuthContext 调用）
async function setAuthCookie(inviteCode: string) {
  try {
    await fetch('/api/auth/set-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode }),
    })
  } catch (error) {
    console.error('Failed to set auth cookie:', error)
  }
}

// 本地存储模式的用户数据管理
function getLocalUser(inviteCode: string): User | null {
  try {
    const cached = localStorage.getItem(`${USER_CACHE_KEY}:${inviteCode}`)
    if (cached) {
      return JSON.parse(cached)
    }
  } catch {}
  return null
}

function setLocalUser(inviteCode: string, user: User) {
  try {
    localStorage.setItem(`${USER_CACHE_KEY}:${inviteCode}`, JSON.stringify(user))
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isVerified, setIsVerified] = useState(false)
  const [verifiedCode, setVerifiedCode] = useState<string | null>(null)

  // 初始化：检查本地存储的邀请码
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const { inviteCode } = JSON.parse(stored)
        fetchUser(inviteCode)
      } catch {
        localStorage.removeItem(STORAGE_KEY)
        setIsLoading(false)
      }
    } else {
      setIsLoading(false)
    }
  }, [])

  const fetchUser = async (inviteCode: string) => {
    try {
      // 如果没有 Redis 配置，使用本地存储
      if (!hasRedisConfig) {
        const localUser = getLocalUser(inviteCode)
        if (localUser) {
          setUser(localUser)
          setVerifiedCode(inviteCode)
          setIsVerified(true)
          setAuthCookie(inviteCode)
        } else {
          // 本地模式：邀请码有效但未注册
          setVerifiedCode(inviteCode)
          setIsVerified(true)
          setUser(null)
          setAuthCookie(inviteCode)
        }
        setIsLoading(false)
        return
      }

      const res = await fetch('/api/user', {
        headers: { 'x-invite-code': inviteCode },
      })

      if (res.ok) {
        const userData = await res.json()
        setUser(userData)
        setVerifiedCode(inviteCode)
        setIsVerified(true)
        setAuthCookie(inviteCode) // 设置 cookie 供 middleware 使用
      } else if (res.status === 404) {
        // 用户不存在，但邀请码有效
        setVerifiedCode(inviteCode)
        setIsVerified(true)
        setUser(null)
        setAuthCookie(inviteCode) // 设置 cookie 供 middleware 使用
      }
    } catch (error) {
      console.error('Fetch user error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const verifyInviteCode = async (code: string) => {
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: code }),
      })

      const data = await res.json()

      if (data.valid) {
        // 检查是否已注册
        const userRes = await fetch('/api/user', {
          headers: { 'x-invite-code': code },
        })

        if (userRes.ok) {
          // 已注册，直接登录
          const userData = await userRes.json()
          setUser(userData)
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ inviteCode: code }))
        } else if (userRes.status === 404) {
          // 未注册，需要输入昵称
          setVerifiedCode(code)
          setIsVerified(true)
        }
        return { valid: true }
      } else {
        return { valid: false, error: data.error }
      }
    } catch {
      return { valid: false, error: '验证失败，请重试' }
    }
  }

  const register = async (nickname: string) => {
    if (!verifiedCode) {
      return { success: false, error: '请先验证邀请码' }
    }

    try {
      // 如果没有 Redis 配置，使用本地存储
      if (!hasRedisConfig) {
        const localUser: User = {
          inviteCode: verifiedCode,
          nickname: nickname.trim(),
          createdAt: new Date().toISOString(),
        }
        setUser(localUser)
        setLocalUser(verifiedCode, localUser)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ inviteCode: verifiedCode }))
        setAuthCookie(verifiedCode)
        return { success: true }
      }

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: verifiedCode, nickname }),
      })

      const data = await res.json()

      if (data.success) {
        setUser(data.user)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ inviteCode: verifiedCode }))
        setAuthCookie(verifiedCode) // 设置 cookie 供 middleware 使用
        return { success: true }
      } else {
        return { success: false, error: data.error }
      }
    } catch {
      return { success: false, error: '注册失败，请重试' }
    }
  }

  const logout = () => {
    setUser(null)
    setIsVerified(false)
    setVerifiedCode(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  const updateNickname = async (nickname: string) => {
    if (!verifiedCode) {
      return { success: false, error: '未登录' }
    }

    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-invite-code': verifiedCode,
        },
        body: JSON.stringify({ nickname }),
      })

      const data = await res.json()

      if (res.ok) {
        setUser(data)
        return { success: true }
      } else {
        return { success: false, error: data.error }
      }
    } catch {
      return { success: false, error: '更新失败，请重试' }
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isVerified,
        verifiedCode,
        verifyInviteCode,
        register,
        logout,
        updateNickname,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}