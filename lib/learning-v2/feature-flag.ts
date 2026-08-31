// lib/learning-v2/feature-flag.ts
// V2 学习流 Feature Flag
// 依据 docs/architecture/v2_课程生成逻辑.md §11 P0：建立 Feature Flag 和 V1/V2 渲染分发；
// P0 默认关闭（不改变默认页面），灰度在 P1a 对系统课/测试账号放开。

const FLAG_STORAGE_KEY = 'ai-learning-v2-enabled';

/**
 * V2 学习流是否启用。
 * P0 默认 false；仅当本地显式开启（灰度/调试）时返回 true。
 * 服务端渲染（无 window）一律 false，保证默认页面不受影响。
 */
export function isV2LearningEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(FLAG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 显式开关（灰度/调试用），传 false 即移除标记恢复默认 */
export function setV2LearningEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) {
      window.localStorage.setItem(FLAG_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(FLAG_STORAGE_KEY);
    }
  } catch {
    // 存储不可用时静默忽略，开关不影响 V1 主流程
  }
}
