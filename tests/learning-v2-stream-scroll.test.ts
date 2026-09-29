import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAutoFollowOnTaskChange } from '../lib/learning-v2/stream-scroll';

test('任务切换后关闭自动跟随，避免抢走用户当前阅读位置', () => {
  assert.equal(resolveAutoFollowOnTaskChange('t1', 't2', true), false);
});

test('同一任务内保持当前跟随状态，流式可继续贴底', () => {
  assert.equal(resolveAutoFollowOnTaskChange('t1', 't1', true), true);
  assert.equal(resolveAutoFollowOnTaskChange('t1', 't1', false), false);
});

test('首次进入章节沿用当前状态，用户上滑时不强制跟随', () => {
  assert.equal(resolveAutoFollowOnTaskChange(undefined, 't1', true), true);
  assert.equal(resolveAutoFollowOnTaskChange(undefined, 't1', false), false);
  assert.equal(resolveAutoFollowOnTaskChange(null, null, true), true);
});
