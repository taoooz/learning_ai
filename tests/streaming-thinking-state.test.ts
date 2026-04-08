import test from 'node:test';
import assert from 'node:assert/strict';

import { getStreamingThinkingState } from '../app/generate/chat/utils/contentParser';

test('getStreamingThinkingState keeps thinking active while think block is still open', () => {
  const isThinking = getStreamingThinkingState({
    sawThinkTag: true,
    hasOpenThinkBlock: true,
    hasThinkingContent: true,
  });

  assert.equal(isThinking, true);
});

test('getStreamingThinkingState ends thinking as soon as the think block is closed', () => {
  const isThinking = getStreamingThinkingState({
    sawThinkTag: true,
    hasOpenThinkBlock: false,
    hasThinkingContent: true,
  });

  assert.equal(isThinking, false);
});
