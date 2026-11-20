// Memory V3 refine 已彻底下线，防止旧入口或客户端模块被重新引入。

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('旧 Memory V3 refine 入口与客户端均已移除', () => {
  assert.equal(existsSync('app/api/memory/refine/route.ts'), false);
  assert.equal(existsSync('lib/memory/refine.ts'), false);
  assert.equal(existsSync('lib/memory/repository.ts'), false);

  const pythonMain = readFileSync('python-agent/main.py', 'utf8');
  assert.equal(pythonMain.includes('/api/agents/memory/refine'), false);
  assert.equal(pythonMain.includes('memory_refine_service'), false);
});
