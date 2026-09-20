// tests/learning-v2-experiments.test.ts
// P5.5 A/B 实验框架：确定性分组 / 加权 / 未注册回退 / 分布合理性

import test from 'node:test';
import assert from 'node:assert/strict';

import { assignVariant, EXPERIMENTS, type ExperimentDefinition } from '../lib/learning-v2/experiments';

/** 注册临时实验（测试内注入，不改全局注册表） */
function withExperiment(def: ExperimentDefinition, fn: () => void): void {
  const mutable = EXPERIMENTS as ExperimentDefinition[];
  mutable.push(def);
  try {
    fn();
  } finally {
    const index = mutable.indexOf(def);
    if (index >= 0) mutable.splice(index, 1);
  }
}

const TEST_EXP: ExperimentDefinition = {
  key: 'test-exp',
  description: '测试实验',
  variants: { control: 1, treatment: 1 },
};

test('assignVariant: 同一账户确定性分组（多次调用结果一致）', () => {
  withExperiment(TEST_EXP, () => {
    const first = assignVariant('test-exp', 'user-abc');
    const second = assignVariant('test-exp', 'user-abc');
    assert.ok(first);
    assert.deepEqual(first, second);
  });
});

test('assignVariant: 未注册实验 → null（防拼写错误扩散）', () => {
  assert.equal(assignVariant('nonexistent-exp', 'user-abc'), null);
});

test('assignVariant: 空账户 → null', () => {
  withExperiment(TEST_EXP, () => {
    assert.equal(assignVariant('test-exp', ''), null);
  });
});

test('assignVariant: 加权分配（3:1 权重）边界正确', () => {
  withExperiment({
    key: 'weighted-exp',
    description: '加权测试',
    variants: { a: 3, b: 1 },
  }, () => {
    const results = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const assignment = assignVariant('weighted-exp', `user-${i}`);
      assert.ok(assignment);
      results.set(assignment.variant, (results.get(assignment.variant) ?? 0) + 1);
    }
    const a = results.get('a') ?? 0;
    const b = results.get('b') ?? 0;
    assert.equal(a + b, 200);
    // 3:1 加权下 a 应明显多于 b（统计合理性，非精确断言）
    assert.ok(a > b, `加权 a=${a} 应大于 b=${b}`);
  });
});

test('assignVariant: 50/50 分布大致均匀（200 账户，每组 60~140）', () => {
  withExperiment(TEST_EXP, () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const assignment = assignVariant('test-exp', `user-${i}`);
      assert.ok(assignment);
      counts.set(assignment.variant, (counts.get(assignment.variant) ?? 0) + 1);
    }
    const control = counts.get('control') ?? 0;
    assert.ok(control >= 60 && control <= 140, `control=${control} 应在 60~140 之间`);
  });
});
