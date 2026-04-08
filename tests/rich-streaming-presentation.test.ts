import test from 'node:test';
import assert from 'node:assert/strict';

import { getThinkingPresentationMode } from '../components/chat/rich-streaming-presentation';

test('getThinkingPresentationMode keeps the thinking section prominent while only thinking content exists', () => {
  const mode = getThinkingPresentationMode({
    isThinking: true,
    hasPrimaryContent: false,
    isExpanded: true,
  });

  assert.equal(mode, 'thinking-only');
});

test('getThinkingPresentationMode downgrades the thinking section after primary content takes over', () => {
  const mode = getThinkingPresentationMode({
    isThinking: false,
    hasPrimaryContent: true,
    isExpanded: false,
  });

  assert.equal(mode, 'secondary-collapsed');
});
