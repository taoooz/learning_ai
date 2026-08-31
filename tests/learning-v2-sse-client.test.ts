// tests/learning-v2-sse-client.test.ts
// parseLearningSseStream 覆盖（计划 T7 / 文档 §10）：
// 中文任意 chunk 拆分（含汉字字节中间切）、事件边界切分、CRLF、[DONE]、
// 坏 JSON 跳过不中断、末尾无空行的残留块兜底

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLearningSseStream } from '../lib/learning-v2/sse-client';
import type { ContentBlockDeltaPayload, LearningSseEvent } from '../types/learning-v2';

const encoder = new TextEncoder();

function makeEvent(
  sequence: number,
  payload: Record<string, unknown>,
  type: LearningSseEvent['type'] = 'content_block_delta',
): LearningSseEvent {
  return {
    eventId: `req-1:${sequence}`,
    requestId: 'req-1',
    type,
    courseId: 'course-1',
    chapterId: 'ch-1',
    planVersion: 1,
    sequence,
    timestamp: 1756700000000 + sequence,
    payload,
  };
}

function frame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * 构造每次 read 恰好返回一个 chunk 的 Response 替身，
 * 保证 chunk 切分点完全由测试控制（真 ReadableStream 不保证逐块交付）
 */
function responseFromChunks(chunks: Uint8Array[]): Response {
  let index = 0;
  return {
    body: {
      getReader() {
        return {
          async read(): Promise<{ done: boolean; value: Uint8Array | undefined }> {
            if (index < chunks.length) return { done: false, value: chunks[index++] };
            return { done: true, value: undefined };
          },
          releaseLock() {},
        };
      },
    },
  } as unknown as Response;
}

async function collect(response: Response): Promise<LearningSseEvent[]> {
  const events: LearningSseEvent[] = [];
  for await (const event of parseLearningSseStream(response)) events.push(event);
  return events;
}

test('基本序列：多事件按顺序解析，中文载荷完整', async () => {
  const text = [frame(makeEvent(1, { blockId: 'b1', delta: '你好，' })),
    frame(makeEvent(2, { blockId: 'b1', delta: '世界' })),
    'data: [DONE]\n\n'].join('');
  const events = await collect(responseFromChunks([encoder.encode(text)]));
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.sequence), [1, 2]);
  assert.equal((events[0].payload as ContentBlockDeltaPayload).delta, '你好，');
  assert.equal((events[1].payload as ContentBlockDeltaPayload).delta, '世界');
});

test('汉字字节中间切：多字节字符被拆到两个 chunk 也能正确还原', async () => {
  // 「学」= E5 AD A6 三字节；在第一个字节后切开
  const full = frame(makeEvent(1, { blockId: 'b1', delta: '学好' }));
  const prefixBytes = encoder.encode(full.slice(0, full.indexOf('学')));
  const bytes = encoder.encode(full);
  const cut = prefixBytes.length + 1; // 落在「学」的第 2 个字节前
  const events = await collect(responseFromChunks([bytes.slice(0, cut), bytes.slice(cut)]));
  assert.equal(events.length, 1);
  assert.equal((events[0].payload as ContentBlockDeltaPayload).delta, '学好');
});

test('事件边界被切开：\\n\\n 分属两个 chunk、JSON 行被任意截断', async () => {
  const text = frame(makeEvent(1, { blockId: 'b1', delta: '甲' })) +
    frame(makeEvent(2, { blockId: 'b1', delta: '乙' }));
  const bytes = encoder.encode(text);
  // 切三刀：事件1 JSON 中间、\n\n 正中间、事件2 中间
  const firstBoundary = text.indexOf('\n\n');
  const cuts = [10, firstBoundary + 1, firstBoundary + 15].sort((a, b) => a - b);
  const chunks = [
    bytes.slice(0, cuts[0]),
    bytes.slice(cuts[0], cuts[1]),
    bytes.slice(cuts[1], cuts[2]),
    bytes.slice(cuts[2]),
  ];
  const events = await collect(responseFromChunks(chunks));
  assert.deepEqual(events.map((e) => e.sequence), [1, 2]);
  assert.equal((events[1].payload as ContentBlockDeltaPayload).delta, '乙');
});

test('CRLF 事件边界同样可解析', async () => {
  const text = `data: ${JSON.stringify(makeEvent(1, { blockId: 'b1', delta: '丙' }))}\r\n\r\n` +
    `data: [DONE]\r\n\r\n`;
  const events = await collect(responseFromChunks([encoder.encode(text)]));
  assert.equal(events.length, 1);
  assert.equal((events[0].payload as ContentBlockDeltaPayload).delta, '丙');
});

test('坏 JSON 跳过且不中断后续事件；注释行被忽略', async () => {
  const text = [
    ': heartbeat\n\n',
    'data: {这不是合法 JSON}\n\n',
    frame(makeEvent(1, { blockId: 'b1', delta: '存活' })),
    'data: [DONE]\n\n',
  ].join('');
  const events = await collect(responseFromChunks([encoder.encode(text)]));
  assert.equal(events.length, 1);
  assert.equal((events[0].payload as ContentBlockDeltaPayload).delta, '存活');
});

test('末尾无空行的残留事件块在流结束时兜底解析', async () => {
  const text = frame(makeEvent(1, { blockId: 'b1', delta: '尾' })) +
    `data: ${JSON.stringify(makeEvent(2, { blockId: 'b1', delta: '声' }))}`; // 无尾部 \n\n
  const events = await collect(responseFromChunks([encoder.encode(text)]));
  assert.deepEqual(events.map((e) => e.sequence), [1, 2]);
});

test('空响应体：直接结束不抛错', async () => {
  const events = await collect({ body: null } as unknown as Response);
  assert.deepEqual(events, []);
});
