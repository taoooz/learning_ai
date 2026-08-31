'use client'

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { unwrapApiResponse } from '@/lib/api-contract'

interface User {
  inviteCode: string
  nickname: string
  createdAt?: string
  updatedAt?: string
}

type AuthMode = 'redis' | 'local'

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
const INVITE_CODE_FORMAT = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/

// 向服务端获取真实鉴权模式（替代客户端用 NEXT_PUBLIC_* 环境变量猜测导致的错位）
// 获取失败时回退本地模式，保证本地调试始终可用
async function fetchAuthMode(): Promise<AuthMode> {
  try {
    const res = await fetch('/api/auth/config')
    if (res.ok) {
      const raw = await res.json()
      const mode = raw?.data?.mode ?? raw?.mode
      if (mode === 'redis' || mode === 'local') return mode
    }
  } catch {}
  return 'local'
}

// 请服务端校验邀请码并签发鉴权 cookie；返回是否成功
// 失败说明邀请码无效（格式或允许名单不通过），调用方应清理本地登录态
async function setAuthCookie(inviteCode: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/set-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode }),
    })
    return res.ok
  } catch (error) {
    console.error('Failed to set auth cookie:', error)
    return false
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
  const authModeRef = useRef<AuthMode>('local')

  // 初始化：先获取服务端鉴权模式，再检查本地存储的邀请码
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const mode = await fetchAuthMode()
      if (cancelled) return
      authModeRef.current = mode

      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        try {
          const { inviteCode } = JSON.parse(stored)
          if (typeof inviteCode !== 'string' || !inviteCode) throw new Error('invalid')
          await fetchUser(inviteCode)
        } catch {
          localStorage.removeItem(STORAGE_KEY)
          setIsLoading(false)
        }
      } else {
        setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const fetchUser = async (inviteCode: string) => {
    try {
      // 先请服务端校验并签发 cookie：失败说明邀请码已失效，清理本地登录态
      const cookieOk = await setAuthCookie(inviteCode)
      if (!cookieOk) {
        localStorage.removeItem(STORAGE_KEY)
        setUser(null)
        setIsVerified(false)
        setVerifiedCode(null)
        return
      }

      if (authModeRef.current === 'local') {
        // 本地模式：用户数据在浏览器 localStorage
        const localUser = getLocalUser(inviteCode)
        setUser(localUser)
        setVerifiedCode(inviteCode)
        setIsVerified(true)
        return
      }

      // Redis 模式：cookie 即身份，不再发送客户端可控的邀请码请求头
      const res = await fetch('/api/user')

      if (res.ok) {
        setUser(unwrapApiResponse<User>(await res.json()))
        setVerifiedCode(inviteCode)
        setIsVerified(true)
      } else if (res.status === 404) {
        // 邀请码有效但尚未注册
        setVerifiedCode(inviteCode)
        setIsVerified(true)
        setUser(null)
      } else if (res.status === 401) {
        localStorage.removeItem(STORAGE_KEY)
        setUser(null)
      }
    } catch (error) {
      console.error('Fetch user error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const verifyInviteCode = async (code: string) => {
    try {
      if (!INVITE_CODE_FORMAT.test(code)) {
        return { valid: false, error: '邀请码格式不正确' }
      }

      if (authModeRef.current === 'local') {
        // 本地模式：格式校验 + 签发 cookie
        const cookieOk = await setAuthCookie(code)
        if (!cookieOk) {
          return { valid: false, error: '邀请码无效' }
        }
        const localUser = getLocalUser(code)
        if (localUser) {
          setUser(localUser)
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ inviteCode: code }))
        } else {
          // 未注册，需要输入昵称
          setVerifiedCode(code)
          setIsVerified(true)
        }
        return { valid: true }
      }

      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: code }),
      })

      const data = await res.json()

      if (data.valid) {
        // 先签发 cookie，再以 cookie 身份查询注册状态
        const cookieOk = await setAuthCookie(code)
        if (!cookieOk) {
          return { valid: false, error: '邀请码无效' }
        }

        const userRes = await fetch('/api/user')

        if (userRes.ok) {
          // 已注册，直接登录
          setUser(unwrapApiResponse<User>(await userRes.json()))
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
      if (authModeRef.current === 'local') {
        const localUser: User = {
          inviteCode: verifiedCode,
          nickname: nickname.trim(),
          createdAt: new Date().toISOString(),
        }
        setUser(localUser)
        setLocalUser(verifiedCode, localUser)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ inviteCode: verifiedCode }))
        await setAuthCookie(verifiedCode)
        return { success: true }
      }

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: verifiedCode, nickname }),
      })

      const data = await res.json()

      if (data.success) {
        await setAuthCookie(verifiedCode)
        setUser(data.user)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ inviteCode: verifiedCode }))
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
    // 请服务端清除 httpOnly cookie（失败不影响本地状态清理）
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  }

  const updateNickname = async (nickname: string) => {
    const code = verifiedCode ?? user?.inviteCode
    if (!code) {
      return { success: false, error: '未登录' }
    }

    try {
      if (authModeRef.current === 'local') {
        // 本地模式：直接更新浏览器缓存
        const existing = getLocalUser(code) ?? user
        if (!existing) {
          return { success: false, error: '未登录' }
        }
        const updated: User = { ...existing, nickname: nickname.trim() }
        setLocalUser(code, updated)
        setUser(updated)
        return { success: true }
      }

      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname }),
      })

      const data = await res.json()

      if (res.ok) {
        setUser(unwrapApiResponse<User>(data))
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
