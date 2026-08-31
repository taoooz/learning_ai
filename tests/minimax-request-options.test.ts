import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { callMiniMax, DEFAULT_LLM_API_BASE, DEFAULT_LLM_MODEL } from '../lib/minimax';

test('callMiniMax sends explicit max_tokens when provided', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LLM_API_KEY;
  const originalBase = process.env.LLM_API_BASE;
  const originalModel = process.env.LLM_MODEL;
  process.env.LLM_API_KEY = 'test-key';
  delete process.env.LLM_API_BASE;
  delete process.env.LLM_MODEL;

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
    assert.equal(fetchCalls[0].url, `${DEFAULT_LLM_API_BASE}/chat/completions`);
    assert.equal(fetchCalls[0].body.model, DEFAULT_LLM_MODEL);
    assert.equal(fetchCalls[0].body.max_tokens, 900);
    assert.equal('max_completion_tokens' in fetchCalls[0].body, false);
    assert.equal('reasoning_split' in fetchCalls[0].body, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalApiKey;
    }
    if (originalBase === undefined) {
      delete process.env.LLM_API_BASE;
    } else {
      process.env.LLM_API_BASE = originalBase;
    }
    if (originalModel === undefined) {
      delete process.env.LLM_MODEL;
    } else {
      process.env.LLM_MODEL = originalModel;
    }
  }
});

test('callMiniMax can fall back to api key from env file when process.env is empty', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LLM_API_KEY;
  const originalEnvFile = process.env.LLM_ENV_FILE;
  delete process.env.LLM_API_KEY;

  const tempDir = mkdtempSync(join(tmpdir(), 'llm-env-'));
  const envFile = join(tempDir, '.env.local');
  writeFileSync(envFile, 'LLM_API_KEY=file-key\n', 'utf8');
  process.env.LLM_ENV_FILE = envFile;

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
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalApiKey;
    }
    if (originalEnvFile === undefined) {
      delete process.env.LLM_ENV_FILE;
    } else {
      process.env.LLM_ENV_FILE = originalEnvFile;
    }
  }
});
