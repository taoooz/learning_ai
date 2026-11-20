import test from 'node:test';
import assert from 'node:assert/strict';

import { createLatestSaveQueue } from '../lib/learning-v2/latest-save-queue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('并发保存只写入首个在途快照和最终最新快照', async () => {
  const releases: Array<() => void> = [];
  const writes: string[] = [];
  const queue = createLatestSaveQueue(async (value: string) => {
    writes.push(value);
    const gate = deferred();
    releases.push(gate.resolve);
    await gate.promise;
  });

  const first = queue.schedule('a');
  const middle = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((value) => queue.schedule(value));
  const latest = queue.schedule('j');
  assert.deepEqual(writes, ['a'], '首个写入在途时，其它快照只替换 pending');

  releases.shift()!();
  await first;
  await Promise.resolve();
  assert.deepEqual(writes, ['a', 'j'], '首个写完后只写 pending 的最新值');

  const newest = queue.schedule('k');
  releases.shift()!();
  await Promise.all([...middle, latest]);
  await Promise.resolve();
  assert.deepEqual(writes, ['a', 'j', 'k']);

  releases.shift()!();
  await newest;
});

test('写入器严格串行且失败不会卡死后续保存', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const writes: Array<{ value: string; fail: boolean }> = [];
  const queue = createLatestSaveQueue(async (value: string) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    writes.push({ value, fail: value === 'bad' });
    await Promise.resolve();
    inFlight -= 1;
    if (value === 'bad') throw new Error('injected write failure');
  });

  await assert.rejects(queue.schedule('bad'), /injected write failure/);
  await queue.schedule('ok');
  await Promise.all([
    queue.schedule('x'),
    queue.schedule('y'),
    queue.schedule('z'),
  ]);

  assert.equal(maxInFlight, 1, '任何时刻最多一个写入在途');
  assert.deepEqual(writes.map((item) => item.value), ['bad', 'ok', 'z']);
});
