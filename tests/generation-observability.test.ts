import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGenerationTrace,
  finalizeGenerationError,
  finalizeGenerationSuccess,
  GenerationTimeoutError,
  withGenerationStage,
} from '../lib/generation/observability';

test('generation trace records stage timings and refine trigger on success', async () => {
  const trace = createGenerationTrace('course-blueprint');

  await withGenerationStage(trace, 'prompt_build', async () => {
    return 'prompt';
  });

  await withGenerationStage(trace, 'primary_model', async () => {
    return 'draft';
  });

  trace.markRefineTriggered();

  await withGenerationStage(trace, 'refine_model', async () => {
    return 'fixed';
  });

  const meta = finalizeGenerationSuccess(trace, {
    extra: { nodeCount: 6 },
  });

  assert.equal(meta.flow, 'course-blueprint');
  assert.equal(meta.refineTriggered, true);
  assert.equal(meta.status, 'success');
  assert.equal(meta.stages.some((item: { name: string; status: string }) => item.name === 'primary_model' && item.status === 'success'), true);
  assert.equal(meta.extra?.nodeCount, 6);
});

test('generation trace classifies timeout errors with failing stage', async () => {
  const trace = createGenerationTrace('node-lesson');

  await assert.rejects(
    withGenerationStage(trace, 'primary_model', async () => {
      throw new GenerationTimeoutError('primary_model', 45000);
    }),
    GenerationTimeoutError,
  );

  const meta = finalizeGenerationError(trace, new GenerationTimeoutError('primary_model', 45000));

  assert.equal(meta.status, 'error');
  assert.equal(meta.error?.kind, 'timeout');
  assert.equal(meta.error?.stage, 'primary_model');
  assert.equal(meta.stages.some((item: { name: string; status: string }) => item.name === 'primary_model' && item.status === 'timeout'), true);
});
