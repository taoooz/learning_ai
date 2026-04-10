import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTocSSELine } from '../app/generate/toc/utils/tocSseParser';

test('parseTocSSELine parses TOC field and completion events', () => {
  const courseNameEvent = parseTocSSELine('data: {"type":"course_name","value":"React 面试冲刺课"}');
  const nodeEvent = parseTocSSELine('data: {"type":"node","node":{"index":0,"title":"先补基础","description":"建立共同语言"}}');
  const completeEvent = parseTocSSELine('data: {"type":"complete","result":{"courseName":"React 面试冲刺课","courseDescription":"带你系统梳理 React 面试重点","nodes":[{"index":0,"title":"先补基础","description":"建立共同语言"}]}}');

  assert.deepEqual(courseNameEvent, { type: 'course_name', value: 'React 面试冲刺课' });
  assert.deepEqual(nodeEvent, {
    type: 'node',
    node: { index: 0, title: '先补基础', description: '建立共同语言' },
  });
  assert.equal(completeEvent?.type, 'complete');
  if (completeEvent?.type === 'complete') {
    assert.equal(completeEvent.result.courseName, 'React 面试冲刺课');
    assert.equal(completeEvent.result.nodes.length, 1);
  }
});

test('parseTocSSELine ignores done sentinels and empty lines', () => {
  assert.equal(parseTocSSELine('data: [DONE]'), null);
  assert.equal(parseTocSSELine('[DONE]'), null);
  assert.equal(parseTocSSELine(''), null);
});
