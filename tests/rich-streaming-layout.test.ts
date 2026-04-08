import test from 'node:test';
import assert from 'node:assert/strict';

import { getRichStreamingLayoutState } from '../components/chat/rich-streaming-layout';
import type { ContentBlock } from '../app/generate/chat/utils/contentParser';

test('getRichStreamingLayoutState does not reserve a primary content area for thinking-only messages', () => {
  const blocks: ContentBlock[] = [];

  const state = getRichStreamingLayoutState({
    blocks,
    content: '',
    thinkingContent: '先分析一下用户当前目标',
  });

  assert.equal(state.hasPrimaryContent, false);
  assert.equal(state.hasStructuredPrimaryContent, false);
});

test('getRichStreamingLayoutState shows the primary area once structured content starts streaming', () => {
  const blocks: ContentBlock[] = [
    {
      type: 'question',
      id: '1',
      question: '你更想先补基础，还是直接做项目？',
      options: { A: '先补基础', B: '直接做项目' },
      complete: false,
    },
  ];

  const state = getRichStreamingLayoutState({
    blocks,
    content: '<quiz id="1"><div slot="question">你更想先补基础，还是直接做项目？',
    thinkingContent: '我先判断用户当前处于什么阶段',
  });

  assert.equal(state.hasPrimaryContent, true);
  assert.equal(state.hasStructuredPrimaryContent, true);
});
