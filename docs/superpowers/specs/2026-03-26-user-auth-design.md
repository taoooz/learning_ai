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
  used      Boolean  @default(false)
  usedAt    DateTime?
  createdAt DateTime @default(now())
}
```

### 预置邀请码

种子数据：AI2024-001 ~ AI2024-010（共10个）

## API 设计

### POST /api/auth/verify
验证邀请码是否有效（存在且未使用）

**请求：**
```json
{ "inviteCode": "AI2024-001" }
```

**响应：**
```json
{ "valid": true }
// 或
{ "valid": false, "error": "邀请码不存在或已使用" }
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

### 首次访问
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
│邀请码页 │  │  自动登录        │
│/login  │  │  跳转首页        │
└────┬───┘  └──────────────────┘
     │
     ▼
┌──────────────────┐
│  输入邀请码       │
│  点击验证        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  验证通过        │
│  显示昵称输入    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  输入昵称        │
│  点击登录        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  调用 /api/auth  │
│  /register       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  存储 inviteCode │
│  到 localStorage │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  跳转首页 /       │
└──────────────────┘
```

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
| 邀请码已使用 | 该邀请码已被使用 |
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
