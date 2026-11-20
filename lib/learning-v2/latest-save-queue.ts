// lib/learning-v2/latest-save-queue.ts
// 单写入器 + 最新快照合并：并发保存时只保证最终最新状态落盘。

export interface LatestSaveQueue<T> {
  schedule(value: T): Promise<void>;
}

interface PendingBatch<T> {
  value: T;
  resolvers: Array<() => void>;
  rejecters: Array<(reason?: unknown) => void>;
}

/**
 * 同一时间最多一个 write。write 在途时，新值只替换 pending 值；
 * pending 的调用方在该批最新值写入完成后统一 resolve。
 */
export function createLatestSaveQueue<T>(
  write: (value: T) => Promise<void>,
): LatestSaveQueue<T> {
  let pending: PendingBatch<T> | null = null;
  let running: Promise<void> | null = null;

  const drain = async (): Promise<void> => {
    while (pending) {
      const batch = pending;
      pending = null;
      try {
        await write(batch.value);
        batch.resolvers.forEach((resolve) => resolve());
      } catch (error) {
        batch.rejecters.forEach((reject) => reject(error));
      }
    }
  };

  const startDrain = (): void => {
    if (running) return;
    running = drain().finally(() => {
      running = null;
      // 失败分支可能先让调用方恢复并 schedule 新值，此时需要续跑。
      if (pending) startDrain();
    });
  };

  return {
    schedule(value: T): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (pending) {
          pending.value = value;
          pending.resolvers.push(resolve);
          pending.rejecters.push(reject);
        } else {
          pending = { value, resolvers: [resolve], rejecters: [reject] };
        }
        startDrain();
      });
    },
  };
}
