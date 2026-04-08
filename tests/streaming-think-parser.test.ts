import test from 'node:test';
import assert from 'node:assert/strict';

import { extractThinkingAndVisibleContent } from '../app/generate/chat/utils/contentParser';

test('extractThinkingAndVisibleContent keeps complete think blocks out of visible content', () => {
  const parsed = extractThinkingAndVisibleContent(
    '<think>先判断用户基础</think><quiz id="1"><div slot="question">你更关注哪部分？</div></quiz>',
  );

  assert.equal(parsed.thinkingContent, '先判断用户基础');
  assert.equal(parsed.visibleContent, '<quiz id="1"><div slot="question">你更关注哪部分？</div></quiz>');
  assert.equal(parsed.hasOpenThinkBlock, false);
});

test('extractThinkingAndVisibleContent routes an unfinished think block into the thinking area only', () => {
  const parsed = extractThinkingAndVisibleContent('<think>我先想想用户现在最缺什么');

  assert.equal(parsed.thinkingContent, '我先想想用户现在最缺什么');
  assert.equal(parsed.visibleContent, '');
  assert.equal(parsed.hasOpenThinkBlock, true);
});
