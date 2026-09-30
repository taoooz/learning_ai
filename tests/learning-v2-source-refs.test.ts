import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDisplaySourceRefs,
  getSourceDisplayTitle,
  getSourceDomain,
  isSafeHttpUrl,
} from '../lib/learning-v2/source-refs';

test('来源展示只保留安全 http(s) 外链，按 URL 去重并限制数量', () => {
  const refs = getDisplaySourceRefs([
    { title: 'MDN Cache-Control', url: 'https://developer.mozilla.org/docs/Web/HTTP/Headers/Cache-Control' },
    { title: '重复来源', url: 'https://developer.mozilla.org/docs/Web/HTTP/Headers/Cache-Control' },
    { title: '危险协议', url: 'javascript:alert(1)' },
    { title: '', url: 'https://www.example.com/guide' },
    { title: '第五条', url: 'https://example.com/fifth' },
  ]);

  assert.equal(refs.length, 3);
  assert.equal(refs[0]?.title, 'MDN Cache-Control');
  assert.equal(refs[1]?.title, 'example.com');
});

test('来源标题和域名有稳定兜底', () => {
  assert.equal(getSourceDomain('https://www.web.dev/learn/http'), 'web.dev');
  assert.equal(getSourceDomain('not-a-url'), '');
  assert.equal(isSafeHttpUrl('https://web.dev'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(getSourceDisplayTitle({ title: '  React 官方文档  ', url: 'https://react.dev' }), 'React 官方文档');
  assert.equal(getSourceDisplayTitle({ title: '', url: 'https://react.dev' }), 'react.dev');
});

test('来源清洗保留证据 ID、类型和用途元数据', () => {
  const refs = getDisplaySourceRefs([{
    title: 'React useActionState',
    url: 'https://react.dev/reference/react/useActionState',
    evidenceId: 'ev-01',
    kind: 'knowledge',
    useFor: '官方 API 事实',
  }]);

  assert.equal(refs[0]?.evidenceId, 'ev-01');
  assert.equal(refs[0]?.kind, 'knowledge');
  assert.equal(refs[0]?.useFor, '官方 API 事实');
});

test('来源清洗保留主推来源标记', () => {
  const refs = getDisplaySourceRefs([{
    title: 'React 官方文档',
    url: 'https://react.dev/reference/react',
    isPrimary: true,
  }]);
  assert.equal(refs[0]?.isPrimary, true);
});
