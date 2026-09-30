# 用户体系实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现基于邀请码的用户认证系统，用户通过预置邀请码注册，数据存储到 Vercel Postgres

**Architecture:** 使用 Prisma ORM 连接 Vercel Postgres，邀请码作为用户唯一标识符，本地存储邀请码作为登录态，API 通过 `x-invite-code` Header 识别用户

**Tech Stack:** Prisma, Vercel Postgres, Next.js API Routes

---

## 文件结构

```
prisma/
├── schema.prisma          # 数据模型定义
└── seed.ts                # 种子数据（10个邀请码）

lib/
└── prisma.ts              # Prisma 客户端单例

app/
├── api/
│   ├── auth/
│   │   ├── verify/route.ts       # POST 验证邀请码
│   │   └── register/route.ts     # POST 注册用户
│   └── user/route.ts             # GET/PATCH 用户信息
└── login/
│   └── page.tsx                  # 登录页面
    └── page.module.css           # 登录页样式

hooks/
└── useAuth.ts             # 认证状态 Hook

contexts/
└── AuthContext.tsx        # 认证 Context Provider

middleware.ts              # 路由中间件（检查登录态）
```

---

## 任务清单

### Task 1: 配置 Prisma + Vercel Postgres

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`

- [ ] **Step 1: 安装 Prisma 依赖**

```bash
npm install prisma @prisma/client
npm install -D @types/node
```

- [ ] **Step 2: 创建 Prisma schema**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("POSTGRES_URL")
  directUrl = env("POSTGRES_URL_NON_POOLING")
}

model User {
  inviteCode    String      @id
  nickname      String
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  courses       UserCourse[]
  memory        UserMemory?
}

model UserCourse {
  id          String   @id @default(cuid())
  inviteCode  String
  courseId    String
  progress    Json
  createdAt   DateTime @default(now())

  user        User     @relation(fields: [inviteCode], references: [inviteCode])
}

model UserMemory {
  id          String   @id @default(cuid())
  inviteCode  String   @unique
  data        Json
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [inviteCode], references: [inviteCode])
}

model InviteCode {
  code       String   @id
  createdAt  DateTime @default(now())
}
```

- [ ] **Step 3: 创建 Prisma 客户端单例**

```typescript
// lib/prisma.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 4: 配置环境变量**

```bash
# .env.local
POSTGRES_URL="postgresql://..."
```

- [ ] **Step 5: 初始化 Prisma 客户端**

Run: `npx prisma generate`
Expected: Generated PrismaClient

- [ ] **Step 6: 创建数据库**

Run: `npx prisma db push`
Expected: Database created successfully

- [ ] **Step 7: 提交代码**

```bash
git add prisma/schema.prisma lib/prisma.ts
git commit -m "feat(auth): 配置 Prisma + Vercel Postgres"
```

---

### Task 2: 种子数据 - 10个邀请码

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: 创建种子数据脚本**

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const inviteCodes = [
  'a1b2-c3d4-e5f6',
  'g7h8-i9j0-k1l2',
  'm3n4-o5p6-q7r8',
  's9t0-u1v2-w3x4',
  'y5z6-a7b8-c9d0',
  'e1f2-g3h4-i5j6',
  'k7l8-m9n0-o1p2',
  'q3r4-s5t6-u7v8',
  'w9x0-y1z2-a3b4',
  'c5d6-e7f8-g9h0',
]

async function main() {
  console.log('Start seeding invite codes...')

  for (const code of inviteCodes) {
    await prisma.inviteCode.create({
      data: { code },
    })
    console.log(`Created invite code: ${code}`)
  }

  console.log('Seeding finished.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

- [ ] **Step 2: 添加 package.json scripts**

```json
{
  "prisma": {
    "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
  }
}
```

Run: `npm install -D ts-node`

- [ ] **Step 3: 运行种子脚本**

Run: `npx prisma db seed`
Expected: 10 invite codes created

- [ ] **Step 4: 提交代码**

```bash
git add prisma/seed.ts package.json
git commit -m "feat(auth): 添加10个邀请码种子数据"
```

---

### Task 3: API - 验证邀请码

**Files:**
- Create: `app/api/auth/verify/route.ts`

- [ ] **Step 1: 编写验证 API**

```typescript
// app/api/auth/verify/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

    // 查询邀请码是否存在
    const exists = await prisma.inviteCode.findUnique({
      where: { code: inviteCode },
    })

    if (!exists) {
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
```

- [ ] **Step 2: 提交代码**

```bash
git add app/api/auth/verify/route.ts
git commit -m "feat(auth): 添加邀请码验证 API"
```

---

### Task 4: API - 注册用户

**Files:**
- Create: `app/api/auth/register/route.ts`

- [ ] **Step 1: 编写注册 API**

```typescript
// app/api/auth/register/route.ts
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
```

- [ ] **Step 2: 提交代码**

```bash
git add app/api/auth/register/route.ts
git commit -m "feat(auth): 添加用户注册 API"
```

---

### Task 5: API - 获取/更新用户信息

**Files:**
- Create: `app/api/user/route.ts`

- [ ] **Step 1: 编写用户 API**

```typescript
// app/api/user/route.ts
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
```

- [ ] **Step 2: 提交代码**

```bash
git add app/api/user/route.ts
git commit -m "feat(auth): 添加用户信息 GET/PATCH API"
```

---

### Task 6: Auth Context + useAuth Hook

**Files:**
- Create: `contexts/AuthContext.tsx`
- Create: `hooks/useAuth.ts`

- [ ] **Step 1: 创建 AuthContext**

```typescript
// contexts/AuthContext.tsx
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
      const res = await fetch('/api/user', {
        headers: { 'x-invite-code': inviteCode },
      })

      if (res.ok) {
        const userData = await res.json()
        setUser(userData)
        setVerifiedCode(inviteCode)
        setIsVerified(true)
      } else if (res.status === 404) {
        // 用户不存在，但邀请码有效
        setVerifiedCode(inviteCode)
        setIsVerified(true)
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
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: verifiedCode, nickname }),
      })

      const data = await res.json()

      if (data.success) {
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
```

- [ ] **Step 2: 创建 useAuth Hook（导出简化版本）**

```typescript
// hooks/useAuth.ts
export { useAuth } from '@/contexts/AuthContext'
```

- [ ] **Step 3: 在 layout 中引入 AuthProvider**

```typescript
// app/layout.tsx (在合适位置添加)
import { AuthProvider } from '@/contexts/AuthContext'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 4: 提交代码**

```bash
git add contexts/AuthContext.tsx hooks/useAuth.ts
git commit -m "feat(auth): 添加 AuthContext 和 useAuth Hook"
```

---

### Task 7: 登录页面 /login

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/login/page.module.css`

- [ ] **Step 1: 创建登录页面样式**

```css
/* app/login/page.module.css */
.container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: linear-gradient(180deg, #f5f3ff 0%, #ffffff 100%);
}

.logo {
  margin-bottom: 8px;
}

.title {
  font-size: 24px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 4px;
}

.subtitle {
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 32px;
}

.form {
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.input {
  width: 100%;
  padding: 14px 16px;
  font-size: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-sizing: border-box;
}

.input:focus {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
}

.button {
  width: 100%;
  padding: 14px 16px;
  font-size: 16px;
  font-weight: 500;
  color: #ffffff;
  background: #7c3aed;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.2s, transform 0.1s;
}

.button:hover {
  background: #6d28d9;
}

.button:active {
  transform: scale(0.98);
}

.button:disabled {
  background: #a5b4fc;
  cursor: not-allowed;
}

.successMessage {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  font-size: 14px;
  color: #059669;
  background: #d1fae5;
  border-radius: 8px;
  margin-bottom: 8px;
}

.error {
  font-size: 14px;
  color: #dc2626;
  text-align: center;
}
```

- [ ] **Step 2: 创建登录页面**

```typescript
// app/login/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import styles from './page.module.css'

export default function LoginPage() {
  const router = useRouter()
  const { isLoading, isVerified, verifiedCode, verifyInviteCode, register } = useAuth()

  const [inviteCode, setInviteCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 加载中或已登录
  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.title}>加载中...</div>
      </div>
    )
  }

  // 已登录，跳转首页
  if (isVerified && verifiedCode && !error) {
    router.replace('/')
    return null
  }

  const handleVerify = async () => {
    if (!inviteCode.trim()) {
      setError('请输入邀请码')
      return
    }

    setError('')
    setIsSubmitting(true)

    const result = await verifyInviteCode(inviteCode.trim())

    if (!result.valid) {
      setError(result.error || '验证失败')
    }

    setIsSubmitting(false)
  }

  const handleRegister = async () => {
    if (!nickname.trim()) {
      setError('请输入昵称')
      return
    }

    setError('')
    setIsSubmitting(true)

    const result = await register(nickname.trim())

    if (result.success) {
      router.replace('/')
    } else {
      setError(result.error || '注册失败')
    }

    setIsSubmitting(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter') {
      action()
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.logo}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="12" fill="#7c3aed" />
          <path
            d="M24 12L32 20L24 28L16 20L24 12Z"
            fill="white"
          />
          <path
            d="M24 20L32 28L24 36L16 28L24 20Z"
            fill="white"
            fillOpacity="0.6"
          />
        </svg>
      </div>
      <h1 className={styles.title}>AI Learning</h1>
      <p className={styles.subtitle}>让学习更智能</p>

      <div className={styles.form}>
        {!isVerified ? (
          <>
            <input
              type="text"
              className={styles.input}
              placeholder="输入邀请码"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, handleVerify)}
              autoComplete="off"
              autoCapitalize="characters"
            />
            <button
              className={styles.button}
              onClick={handleVerify}
              disabled={isSubmitting}
            >
              {isSubmitting ? '验证中...' : '验证'}
            </button>
          </>
        ) : (
          <>
            <div className={styles.successMessage}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm3.72 5.97l-4.47 4.47a.75.75 0 01-1.06 0l-2.22-2.22a.75.75 0 111.06-1.06l1.72 1.72 3.97-3.97a.75.75 0 111.06 1.06h-.06z"/>
              </svg>
              邀请码有效
            </div>
            <input
              type="text"
              className={styles.input}
              placeholder="输入昵称"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, handleRegister)}
              autoComplete="nickname"
            />
            <button
              className={styles.button}
              onClick={handleRegister}
              disabled={isSubmitting}
            >
              {isSubmitting ? '登录中...' : '开始学习'}
            </button>
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 提交代码**

```bash
git add app/login/page.tsx app/login/page.module.css
git commit -m "feat(auth): 添加登录页面"
```

---

### Task 8: 路由中间件

**Files:**
- Create: `middleware.ts`

- [ ] **Step 1: 创建中间件**

```typescript
// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 需要登录才能访问的路径
const protectedPaths = ['/', '/course']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 检查是否是受保护路径
  const isProtectedPath = protectedPaths.some((path) =>
    pathname === path || pathname.startsWith(path + '/')
  )

  if (!isProtectedPath) {
    return NextResponse.next()
  }

  // 检查登录态
  const inviteCode = request.cookies.get('ai-learning-auth')?.value

  if (!inviteCode) {
    // 重定向到登录页
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/course/:path*'],
}
```

- [ ] **Step 2: 提交代码**

```bash
git add middleware.ts
git commit -m "feat(auth): 添加路由中间件检查登录态"
```

---

### Task 9: Vercel 部署配置

**Files:**
- Modify: `.env.example`
- Create: `vercel.json` (如需要)

- [ ] **Step 1: 创建环境变量示例文件**

```bash
# .env.example
POSTGRES_URL="postgresql://..."
POSTGRES_URL_NON_POOLING="postgresql://..."
```

- [ ] **Step 2: 更新文档**

在 `.env.example` 添加 Vercel Postgres 相关环境变量说明

- [ ] **Step 3: 提交代码**

```bash
git add .env.example
git commit -m "docs: 添加 Vercel Postgres 环境变量说明"
```

---

## 实施顺序

1. Task 1: 配置 Prisma + Vercel Postgres
2. Task 2: 种子数据 - 10个邀请码
3. Task 3: API - 验证邀请码
4. Task 4: API - 注册用户
5. Task 5: API - 获取/更新用户信息
6. Task 6: Auth Context + useAuth Hook
7. Task 7: 登录页面 /login
8. Task 8: 路由中间件
9. Task 9: Vercel 部署配置

---

## 测试验证

部署后测试以下流程：

1. **首次访问 /login** → 显示邀请码输入框
2. **输入无效邀请码** → 提示"邀请码不存在"
3. **输入有效邀请码（未注册）** → 显示昵称输入框
4. **输入昵称点击登录** → 跳转首页
5. **刷新页面** → 自动登录，跳转首页
6. **在不同设备使用同一邀请码** → 可正常注册或登录
