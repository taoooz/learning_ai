// lib/learning-v2/stream-scroll.ts
// 学习流滚动跟随的纯函数决策：
// - 同一任务内保持当前跟随状态（用户是否在底部）
// - 任务切换后不主动抢滚动位置；用户再次靠近底部时恢复跟随

export function resolveAutoFollowOnTaskChange(
  previousTaskId: string | null | undefined,
  nextTaskId: string | null | undefined,
  currentAutoFollow: boolean,
): boolean {
  if (!nextTaskId || !previousTaskId) return currentAutoFollow;
  return previousTaskId === nextTaskId ? currentAutoFollow : false;
}
