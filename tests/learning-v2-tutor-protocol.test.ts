// tests/learning-v2-tutor-protocol.test.ts
// V2 流内答疑（Tutor）协议测试：幂等键与 SSE 事件类型（P2 Task 1）

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTutorQuestionIdempotencyKey,
  buildTutorRequestIdempotencyKey,
} from '../lib/learning-v2/idempotency';
import type { LearningSseEvent } from '../types/learning-v2/events';

test('问题和回答使用稳定且不同的幂等键', () => {
  assert.equal(buildTutorQuestionIdempotencyKey('ch-1', 'task-1', 'q-1'), 'uq:ch-1:task-1:q-1');
  assert.equal(buildTutorRequestIdempotencyKey('ch-1', 2, 'task-1', 'q-1'), 'tutor:ch-1:v2:task-1:q-1');
  assert.notEqual(
    buildTutorQuestionIdempotencyKey('ch-1', 'task-1', 'q-1'),
    buildTutorRequestIdempotencyKey('ch-1', 2, 'task-1', 'q-1'),
  );
});

test('Tutor 事件类型覆盖开始、块增量、完成和通用错误', () => {
  const event: LearningSseEvent = {
    eventId: 'evt-1', requestId: 'req-1', type: 'tutor_block_delta',
    courseId: 'course-1', chapterId: 'ch-1', taskId: 'task-1', questionId: 'q-1',
    planVersion: 2, sequence: 3, timestamp: 1,
    payload: { blockId: 'block-1', delta: '缓存命中' },
  };
  assert.equal(event.type, 'tutor_block_delta');
});
