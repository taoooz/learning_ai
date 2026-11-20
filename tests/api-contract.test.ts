import test from 'node:test';
import assert from 'node:assert/strict';

import { unwrapApiResponse } from '../lib/api-contract';

test('unwrapApiResponse 只接受当前 success/data 响应包装', () => {
  const data = { id: 'user-1' };
  assert.deepEqual(unwrapApiResponse<{ id: string }>({ success: true, data }), data);
});

test('unwrapApiResponse 遇到业务错误时抛出服务端错误', () => {
  assert.throws(
    () => unwrapApiResponse({ success: false, error: '提取学习洞察失败' }),
    /提取学习洞察失败/,
  );
});

test('unwrapApiResponse 不再放行未包装的旧响应格式', () => {
  assert.throws(
    () => unwrapApiResponse({ id: 'legacy-user' } as unknown as { success?: boolean; data?: unknown; error?: string }),
    /Invalid API response envelope/,
  );
});
