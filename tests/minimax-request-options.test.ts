import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { callMiniMax, callMiniMaxWithSearch } from '../lib/minimax';

test('callMiniMax sends explicit max_tokens when provided', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.MINIMAX_API_KEY;
  process.env.MINIMAX_API_KEY = 'test-key';

  const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
    });

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"ok":true}',
          },
        },
      ],
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await callMiniMax('生成一份 JSON', { maxTokens: 900 });
    assert.equal(result, '{"ok":true}');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].body.max_tokens, 900);
    assert.equal(fetchCalls[0].body.max_completion_tokens, 900);
    assert.equal(fetchCalls[0].body.reasoning_split, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MINIMAX_API_KEY;
    } else {
      process.env.MINIMAX_API_KEY = originalApiKey;
    }
  }
});

test('callMiniMaxWithSearch forwards explicit max_tokens into the primary request', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.MINIMAX_API_KEY;
  process.env.MINIMAX_API_KEY = 'test-key';

  const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
    });

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"done":true}',
          },
        },
      ],
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await callMiniMaxWithSearch('只返回 JSON', undefined, undefined, 1, { maxTokens: 1200 });
    assert.equal(result, '{"done":true}');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].body.max_tokens, 1200);
    assert.equal(fetchCalls[0].body.max_completion_tokens, 1200);
    assert.equal(fetchCalls[0].body.reasoning_split, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MINIMAX_API_KEY;
    } else {
      process.env.MINIMAX_API_KEY = originalApiKey;
    }
  }
});

test('callMiniMax can fall back to api key from env file when process.env is empty', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.MINIMAX_API_KEY;
  const originalEnvFile = process.env.MINIMAX_ENV_FILE;
  delete process.env.MINIMAX_API_KEY;

  const tempDir = mkdtempSync(join(tmpdir(), 'minimax-env-'));
  const envFile = join(tempDir, '.env.local');
  writeFileSync(envFile, 'MINIMAX_API_KEY=file-key\n', 'utf8');
  process.env.MINIMAX_ENV_FILE = envFile;

  const fetchCalls: Array<{ headers: HeadersInit | undefined }> = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ headers: init?.headers });

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"ok":true}',
          },
        },
      ],
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await callMiniMax('生成一份 JSON');
    assert.equal(result, '{"ok":true}');
    assert.equal(fetchCalls.length, 1);
    assert.equal((fetchCalls[0].headers as Record<string, string>).Authorization, 'Bearer file-key');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
    if (originalApiKey === undefined) {
      delete process.env.MINIMAX_API_KEY;
    } else {
      process.env.MINIMAX_API_KEY = originalApiKey;
    }
    if (originalEnvFile === undefined) {
      delete process.env.MINIMAX_ENV_FILE;
    } else {
      process.env.MINIMAX_ENV_FILE = originalEnvFile;
    }
  }
});
