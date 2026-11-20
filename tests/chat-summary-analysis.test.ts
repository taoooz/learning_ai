import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeChatMessageForMemory,
  detectChatLearningPreferences,
  detectAssistantExplanationStyle,
} from '../lib/chat/summary-analysis';

test('summary analysis ignores normal questions', () => {
  const result = analyzeChatMessageForMemory('工具调用是什么？');
  assert.equal(result.shouldAddKnowledgeGap, false);
});

test('summary analysis extracts confusion concept', () => {
  const result = analyzeChatMessageForMemory('我还是分不清工具调用和工作流编排');
  assert.equal(result.shouldAddKnowledgeGap, true);
  assert.equal(result.extractedConcept, '工具调用和工作流编排');
});

test('summary analysis detects explanation styles', () => {
  assert.deepEqual(detectChatLearningPreferences('请一步一步解释并举个例子').map((item) => item.value), ['分步拆解', '例子驱动']);
  assert.equal(detectAssistantExplanationStyle('我们一步一步来看'), '分步拆解');
});
