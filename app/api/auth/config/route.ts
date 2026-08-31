import { getAuthMode } from '@/lib/auth'
import { apiSuccess } from '@/lib/api-response'

// 返回服务端鉴权模式，客户端据此决定本地存储 or Redis 流程
// （取代客户端用 NEXT_PUBLIC_* 环境变量猜测导致的错位问题）
export async function GET() {
  return apiSuccess({ mode: getAuthMode() })
}
