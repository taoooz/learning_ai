import Redis from 'ioredis'
import { isAllowedInviteCode, isValidInviteCodeFormat as isValidFormat } from './auth'

// 用户数据结构
export interface UserData {
  inviteCode: string
  nickname: string
  createdAt: string
}

// 验证邀请码是否有效（允许名单逻辑统一在 lib/auth.ts，名单为空时本地模式放行）
export function isValidInviteCode(code: string): boolean {
  return isAllowedInviteCode(code)
}

// 邀请码格式校验
export function isValidInviteCodeFormat(code: string): boolean {
  return isValidFormat(code)
}

// 用户存储key
export function userKey(inviteCode: string): string {
  return `user:${inviteCode}`
}

// Redis 客户端单例缓存
let redisInstance: Redis | null = null;

// 获取 Redis 客户端（单例复用）
export function getRedis(): Redis {
  if (redisInstance) return redisInstance;
  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error('REDIS_URL environment variable is not set')
  }
  redisInstance = new Redis(url)
  return redisInstance
}
