import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRenderLearnerPositioningCard } from '../components/chat/outline-card-utils';

test('shouldRenderLearnerPositioningCard stays hidden when only the default beginner level is present', () => {
  const visible = shouldRenderLearnerPositioningCard({
    estimatedLevel: 'beginner',
    backgroundSummary: '',
    skipBasics: [],
  });

  assert.equal(visible, false);
});

test('shouldRenderLearnerPositioningCard becomes visible once any real learner positioning content appears', () => {
  const visible = shouldRenderLearnerPositioningCard({
    estimatedLevel: 'intermediate',
    backgroundSummary: '',
    skipBasics: [],
  });

  assert.equal(visible, true);
});

test('shouldRenderLearnerPositioningCard shows likely gaps and example policy', () => {
  assert.equal(shouldRenderLearnerPositioningCard({
    estimatedLevel: 'beginner',
    backgroundSummary: '',
    skipBasics: [],
    likelyGaps: ['召回与排序边界'],
  }), true);
  assert.equal(shouldRenderLearnerPositioningCard({
    estimatedLevel: 'beginner',
    backgroundSummary: '',
    skipBasics: [],
    preferredExampleDomains: ['电商推荐'],
  }), true);
});
