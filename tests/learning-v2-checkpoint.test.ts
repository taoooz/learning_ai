// tests/learning-v2-checkpoint.test.ts
// P3a 结构化 Checkpoint：Next 代理鉴权/校验 + CheckpointCard 可导入

import test from 'node:test';
import assert from 'node:assert/strict';

import { POST as generatePOST } from '../app/api/learning/v2/checkpoints/generate/route';
import { POST as evaluatePOST } from '../app/api/learning/v2/checkpoints/evaluate/route';
import { CheckpointCard } from '../components/learning-v2/CheckpointCard';
import type { CheckpointDefinition } from '../types/learning-v2';

const validDefinition: CheckpointDefinition = {
  checkpointId: 'cp-1',
  objectiveId: 'obj-1',
  taskId: 'task-1',
  conceptKeys: ['etag'],
  kind: 'scenario_choice',
  prompt: '浏览器收到 304 时应该怎么做？',
  options: [
    { id: 'a', text: '重新下载资源' },
    { id: 'b', text: '使用本地缓存' },
    { id: 'c', text: '清空缓存' },
    { id: 'd', text: '报错退出' },
  ],
  correctAnswer: 'b',
  remediationHint: '304 表示资源未变化。',
  estimatedSeconds: 45,
  generationMeta: { promptVersion: 'v1', modelVersion: 'test', generatedAt: 1, durationMs: 1, degraded: false },
};

// ---- 生成代理 ----

test('checkpoint generate proxy 无鉴权 → 401', async () => {
  const req = new Request('http://localhost/api/learning/v2/checkpoints/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const res = await generatePOST(req as never);
  assert.equal(res.status, 401);
});

test('checkpoint generate proxy 缺少必填字段 → 422', async () => {
  const req = new Request('http://localhost/api/learning/v2/checkpoints/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'ai-learning-auth=abcd-1234-ef56' },
    body: JSON.stringify({ courseId: 'c1' }),
  });
  const res = await generatePOST(req as never);
  assert.equal(res.status, 422);
});

// ---- 判分代理 ----

test('checkpoint evaluate proxy 无鉴权 → 401', async () => {
  const req = new Request('http://localhost/api/learning/v2/checkpoints/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const res = await evaluatePOST(req as never);
  assert.equal(res.status, 401);
});

test('checkpoint evaluate proxy 缺少 checkpoint → 422', async () => {
  const req = new Request('http://localhost/api/learning/v2/checkpoints/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'ai-learning-auth=abcd-1234-ef56' },
    body: JSON.stringify({
      courseId: 'c1', chapterId: 'ch1', taskId: 'task-1',
      checkpointId: 'cp-1', answer: 'b', attempt: 1,
      idempotencyKey: 'cp:ch1:v1:task-1:cp-1',
    }),
  });
  const res = await evaluatePOST(req as never);
  assert.equal(res.status, 422);
});

// ---- CheckpointCard ----

test('CheckpointCard 组件可导入', () => {
  assert.ok(typeof CheckpointCard === 'function');
});

test('CheckpointDefinition 类型完整性', () => {
  assert.ok(validDefinition.checkpointId);
  assert.equal(validDefinition.options?.length, 4);
  assert.equal(typeof validDefinition.correctAnswer, 'string');
});
