# 用户体系设计文档

## 概述

实现基于邀请码的用户认证系统，用户通过预置邀请码注册，数据云端存储，本地存储邀请码作为登录态。

## 架构

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   浏览器端       │      │   Next.js API   │      │  Vercel Postgres│
│                 │      │                 │      │                 │
│  inviteCode     │─────▶│   /api/auth     │─────▶│  User           │
│  (localStorage) │      │   /api/user     │      │  ├── inviteCode │
│                 │      │                 │      │  ├── nickname   │
│                 │      │                 │      │  └── ...         │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

## 数据库设计 (Prisma)

```prisma
model User {
  inviteCode    String   @id
  nickname     String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  courses      UserCourse[]
  memory       UserMemory?
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
  code      String   @id
  createdAt DateTime @default(now())
}
```

### 预置邀请码

格式：`xxxx-xxxx-xxxx`（3段，每段4位，a-z 和 0-9）

种子数据（10个）：
- a1b2-c3d4-e5f6
- g7h8-i9j0-k1l2
- m3n4-o5p6-q7r8
- s9t0-u1v2-w3x4
- y5z6-a7b8-c9d0
- e1f2-g3h4-i5j6
- k7l8-m9n0-o1p2
- q3r4-s5t6-u7v8
- w9x0-y1z2-a3b4
- c5d6-e7f8-g9h0

## API 设计

### POST /api/auth/verify
验证邀请码是否有效（仅需存在，不限制使用次数）

**请求：**
```json
{ "inviteCode": "a1b2-c3d4-e5f6" }
```

**响应：**
```json
{ "valid": true, "exists": true }
// 或
{ "valid": false, "error": "邀请码不存在" }
```

### POST /api/auth/register
注册用户

**请求：**
```json
{ "inviteCode": "AI2024-001", "nickname": "小明" }
```

**响应：**
```json
{ "success": true, "user": { "inviteCode": "AI2024-001", "nickname": "小明" } }
```

### GET /api/user
获取当前用户信息

**Headers:** `x-invite-code: AI2024-001`

**响应：**
```json
{ "inviteCode": "AI2024-001", "nickname": "小明", "createdAt": "..." }
```

### PATCH /api/user
更新用户信息

**Headers:** `x-invite-code: AI2024-001`

**请求：**
```json
{ "nickname": "新昵称" }
```

## 用户流程

### 访问 /login
```
┌──────────────────┐
│  检查 localStorage │
│  有 inviteCode?   │
└────────┬─────────┘
         │
    No   │    Yes
    ┌────┴────┐
    ▼         ▼
┌────────┐  ┌──────────────────┐
│显示邀请码 │  │  调用 /api/user  │
│输入表单   │  │  验证inviteCode  │
└────┬───┘  │  是否已注册?      │
     │      └────────┬─────────┘
     │               │
     │         Yes   │   No
     │         ┌─────┴─────┐
     │         ▼           ▼
     │    ┌────────┐  ┌────────┐
     │    │自动登录│  │显示昵称│
     │    │跳转首页│  │输入表单│
     │    └────────┘  └────┬───┘
     │                    │
     │              ┌─────┴─────┐
     │              ▼           ▼
     │         ┌────────┐  ┌────────┐
     │         │存储昵称│  │存储昵称│
     │         │注册用户│  │注册用户│
     │         └────┬───┘  └────┬───┘
     │              │           │
     │              └─────┬─────┘
     │                    ▼
     │              ┌────────┐
     │              │跳转首页│
     │              └────────┘
     ▼
┌──────────────────┐
│  输入邀请码       │
│  点击验证        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  调用 /api/auth  │
│  /verify        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  验证通过        │
│  检查是否已注册  │
└────────┬─────────┘
         │
    已注册  │  未注册
    ┌──────┴──────┐
    ▼             ▼
┌────────┐  ┌──────────────┐
│直接登录│  │显示昵称输入  │
│存local │  │点击登录      │
└────┬───┘  └──────┬───────┘
     │             │
     │       ┌─────┴─────┐
     │       ▼           ▼
     │  ┌────────┐  ┌────────┐
     │  │存储昵称│  │存储昵称│
     │  │注册用户│  │注册用户│
     │  └────┬───┘  └────┬───┘
     │       └─────┬─────┘
     │             ▼
     │       ┌────────┐
     └──────▶│跳转首页│
             └────────┘
```

### 邀请码核心逻辑

1. **邀请码只是"钥匙"** - 不绑定设备，不限制使用次数
2. **同一邀请码可多设备使用** - 共享同一用户数据
3. **首次使用需注册** - 输入昵称，之后直接登录
4. **本地存储邀请码** - 作为登录态，下次访问自动识别

## 移动端 UI 设计

### 页面：/login

**布局（垂直居中）：**
```
┌────────────────────────┐
│                        │
│       [Logo]           │
│    AI Learning         │
│   让学习更智能          │
│                        │
│  ┌──────────────────┐  │
│  │ 输入邀请码        │  │
│  └──────────────────┘  │
│                        │
│  [ 验证 ]  按钮        │
│                        │
└────────────────────────┘
```

**验证通过后：**
```
┌────────────────────────┐
│                        │
│       [Logo]           │
│    AI Learning         │
│   让学习更智能          │
│                        │
│  ✓ 邀请码有效          │
│                        │
│  ┌──────────────────┐  │
│  │ 输入昵称          │  │
│  └──────────────────┘  │
│                        │
│  [ 开始学习 ]  按钮    │
│                        │
└────────────────────────┘
```

## localStorage 结构

```typescript
// 存储键
const STORAGE_KEY = 'ai-learning-auth'

// 存储值
interface AuthData {
  inviteCode: string  // "AI2024-001"
}
```

## 错误处理

| 场景 | 提示 |
|------|------|
| 邀请码为空 | 请输入邀请码 |
| 邀请码格式错误 | 邀请码格式不正确 |
| 邀请码不存在 | 邀请码不存在 |
| 注册失败 | 注册失败，请重试 |
| 未登录访问受保护页面 | 跳转 /login |

## 实施步骤

1. 配置 Prisma + Vercel Postgres
2. 创建 Prisma Schema
3. 添加种子数据（10个邀请码）
4. 实现 /api/auth/verify
5. 实现 /api/auth/register
6. 实现 /api/user GET/PATCH
7. 创建 /login 页面（两阶段表单）
8. 实现登录态检测中间件
9. 数据迁移（现有 localStorage 数据迁移到云端）
