import test from 'node:test';
import assert from 'node:assert/strict';

import { PROMPT_LAB_STAGES, getNextPromptLabStage } from '../lib/prompt-lab/stages';
import { buildPromptLabInputs, buildPromptLabSnapshot, hydratePromptLabSnapshot } from '../lib/prompt-lab/defaults';
import { parsePromptLabSSE } from '../lib/prompt-lab/sse';
import type { PromptLabSSEEvent } from '../types/prompt-lab';

test('Prompt Lab exposes all course generation stages', () => {
  assert.equal(PROMPT_LAB_STAGES.length, 9);
  assert.equal(getNextPromptLabStage('architect_chapters'), 'architect_meta');
  assert.equal(getNextPromptLabStage('architect_meta'), 'chapter_plan');
  assert.equal(getNextPromptLabStage('chapter_plan'), 'task_search_decision');
  assert.equal(getNextPromptLabStage('task_content'), null);
});

test('Prompt Lab builds editable defaults for every stage', () => {
  const snapshot = buildPromptLabSnapshot();
  for (const stage of PROMPT_LAB_STAGES) {
    const inputs = buildPromptLabInputs(stage.id, snapshot, {});
    assert.ok(Object.keys(inputs).length > 0, stage.id);
  }
  const chapterPlan = buildPromptLabInputs('chapter_plan', snapshot, {});
  assert.equal(typeof chapterPlan.blueprint, 'string');
  assert.equal(chapterPlan.chapterId, snapshot.chapterId);

  const outlineAnswer = buildPromptLabInputs('outline_answer', snapshot, {
    outline_raw: '上一轮输出的澄清问题',
  });
  assert.match(String(outlineAnswer.history), /上一轮输出的澄清问题/);

  const taskContent = buildPromptLabInputs('task_content', snapshot, {
    task_search_decision: { toolResults: [{ tool: 'web_search', result: '补充搜索结果' }] },
  });
  assert.match(String(taskContent.evidence), /补充搜索结果/);
});

test('Prompt Lab SSE parser handles thinking, content, parsed and metrics', async () => {
  const body = [
    'data: {"type":"thinking","message":"先判断"}',
    '',
    'data: {"type":"content_delta","content":"输出"}',
    '',
    'data: {"type":"parsed","parsed":{"ok":true},"validation":{"valid":true,"errors":[],"warnings":[]},"toolResults":[]}',
    '',
    'data: {"type":"metrics","elapsedMs":1200,"finishReason":"stop"}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  const events: PromptLabSSEEvent[] = [];
  for await (const event of parsePromptLabSSE(new Response(body))) {
    events.push(event);
  }
  assert.deepEqual(events.map((event) => event.type), ['thinking', 'content_delta', 'parsed', 'metrics']);
});

test('Prompt Lab falls back to local profile when server Memory profile is empty', async () => {
  const originalFetch = globalThis.fetch;
  const snapshot = buildPromptLabSnapshot();
  snapshot.userProfile = {
    targetJob: '本地画像中的产品经理',
    insights: { summary: '本地画像摘要' },
  } as typeof snapshot.userProfile;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: true,
    source: 'server_memory_v4',
    userProfile: { targetJob: '', insights: {} },
    planningMemory: { learnerSnapshot: { estimatedLevel: 'novice' } },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    const hydrated = await hydratePromptLabSnapshot(snapshot);
    assert.equal((hydrated.userProfile as { targetJob?: string } | null)?.targetJob, '本地画像中的产品经理');
    assert.equal(hydrated.memorySource, 'mixed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
