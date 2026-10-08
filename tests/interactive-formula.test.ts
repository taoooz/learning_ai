import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFormula } from '../lib/interactive/formula';

test('支持中文变量名与乘法', () => {
  assert.equal(evaluateFormula('加班小时 * 每小时补贴', { 加班小时: 5, 每小时补贴: 30 }), 150);
});

test('先乘除后加减', () => {
  assert.equal(evaluateFormula('2 + 3 * 4', {}), 14);
});

test('括号与负数', () => {
  assert.equal(evaluateFormula('(2 + 3) * -2', {}), -10);
});

test('除以零返回 null', () => {
  assert.equal(evaluateFormula('10 / 0', {}), null);
});

test('未知变量返回 null', () => {
  assert.equal(evaluateFormula('工资 * 2', { 奖金: 100 }), null);
});

test('非法字符返回 null', () => {
  assert.equal(evaluateFormula('评分 ^ 2', {}), null);
  assert.equal(evaluateFormula('window.alert(1)', {}), null);
});
