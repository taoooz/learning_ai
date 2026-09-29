// 安全边界回归：生产邀请码 fail-closed，以及 BFF → Python 服务间凭证。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAllowedInviteCode,
  isValidInviteCodeFormat,
} from '../lib/auth';
import {
  PYTHON_INTERNAL_TOKEN_HEADER,
  pythonAgentHeaders,
} from '../lib/agent-config';

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  ) as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const VALID_CODE = 'a1b2-c3d4-e5f6';

test('生产环境未配置邀请码名单时拒绝所有登录', () => {
  withEnv({ NODE_ENV: 'production', INVITE_CODES: undefined }, () => {
    assert.equal(isValidInviteCodeFormat(VALID_CODE), true);
    assert.equal(isAllowedInviteCode(VALID_CODE), false);
  });
});

test('生产环境只接受名单内的邀请码', () => {
  withEnv({ NODE_ENV: 'production', INVITE_CODES: VALID_CODE }, () => {
    assert.equal(isAllowedInviteCode(VALID_CODE), true);
    assert.equal(isAllowedInviteCode('zzzz-zzzz-zzzz'), false);
  });
});

test('本地开发允许空名单放行格式有效的邀请码', () => {
  withEnv({ NODE_ENV: 'development', INVITE_CODES: undefined }, () => {
    assert.equal(isAllowedInviteCode(VALID_CODE), true);
  });
});

test('pythonAgentHeaders 注入服务间令牌且不覆盖调用方专用头', () => {
  withEnv({ PYTHON_INTERNAL_TOKEN: 'internal-secret' }, () => {
    const headers = pythonAgentHeaders({ 'X-Account-Id': 'user-a' });
    assert.equal(headers[PYTHON_INTERNAL_TOKEN_HEADER], 'internal-secret');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['X-Account-Id'], 'user-a');
  });
});

test('未配置服务间令牌时不注入空请求头', () => {
  withEnv({ PYTHON_INTERNAL_TOKEN: undefined }, () => {
    const headers = pythonAgentHeaders();
    assert.equal(PYTHON_INTERNAL_TOKEN_HEADER in headers, false);
  });
});
