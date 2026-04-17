import Redis from 'ioredis'

// 邀请码列表：优先从环境变量读取，逗号分隔
// 环境变量格式：INVITE_CODES="a1b2-c3d4-e5f6,g7h8-i9j0-k1l2"
const INVITE_CODES: string[] = process.env.INVITE_CODES
  ? process.env.INVITE_CODES.split(',').map(s => s.trim()).filter(Boolean)
  : [];

// 用户数据结构
export interface UserData {
  inviteCode: string
  nickname: string
  createdAt: string
}

// 验证邀请码是否有效
export function isValidInviteCode(code: string): boolean {
  return INVITE_CODES.includes(code)
}

// 邀请码格式校验
export function isValidInviteCodeFormat(code: string): boolean {
  return /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(code)
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
