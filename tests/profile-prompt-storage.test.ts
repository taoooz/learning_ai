// 当前画像 prompt 与本地存储 key 的回归：不保留旧 Memory payload/迁移层。

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProfileInsightPrompt } from '../lib/prompt';
import { getStoredData } from '../lib/storage';

function withBrowserStorage(run: (store: Map<string, string>) => void) {
  return () => {
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
    const g = globalThis as { window?: unknown; localStorage?: unknown };
    const originalWindow = g.window;
    const originalLocalStorage = g.localStorage;
    g.window = { localStorage: fakeStorage };
    g.localStorage = fakeStorage;
    try {
      run(store);
    } finally {
      if (originalWindow === undefined) delete g.window; else g.window = originalWindow;
      if (originalLocalStorage === undefined) delete g.localStorage; else g.localStorage = originalLocalStorage;
    }
  };
}

test('画像洞察 prompt 只包含当前事实提取契约', () => {
  const prompt = buildProfileInsightPrompt({
    name: '测试用户',
    targetJob: 'AI 产品经理',
    workExperience: [{ id: 'w1', company: '示例公司', position: '产品经理', description: '负责 Agent 产品' }],
    education: [{ id: 'e1', school: '示例大学', major: '计算机' }],
  });

  assert.equal(prompt.includes('目标岗位：AI 产品经理'), true);
  assert.equal(prompt.includes('示例公司，产品经理，内容：负责 Agent 产品'), true);
  assert.equal(prompt.includes('knowledgeBackground'), true);
  assert.equal(prompt.includes('analogyExperiences'), true);
});

test('带邀请码时只读取 account-scoped key，不迁移旧无后缀 key', withBrowserStorage((store) => {
  store.set('ai-learning-auth', JSON.stringify({ inviteCode: 'invite-123' }));
  store.set('ai-learning-data-v2', JSON.stringify({
    courses: [{ courseId: 'legacy-course' }],
    userProfile: { name: '旧数据' },
  }));

  const data = getStoredData();

  assert.equal(data.courses?.length || 0, 0);
  assert.equal(data.userProfile, null);
  assert.equal(store.has('ai-learning-data-v2:invite-123'), false);
}));

test('带邀请码时仍读取当前 scoped key', withBrowserStorage((store) => {
  store.set('ai-learning-auth', JSON.stringify({ inviteCode: 'invite-123' }));
  store.set('ai-learning-data-v2:invite-123', JSON.stringify({
    courses: [{ courseId: 'current-course' }],
    currentCourseId: 'v1-course',
    courseProgress: { 'v1-course': { 0: 'completed' } },
    userProfile: { name: '当前用户' },
    recommendations: [],
  }));

  const data = getStoredData();

  assert.equal(data.courses.length, 1);
  assert.equal(data.courses[0].courseId, 'current-course');
  assert.equal(data.userProfile?.name, '当前用户');
  assert.equal('courses' in data, true);
  assert.equal('currentCourseId' in data, false);
  assert.equal('courseProgress' in data, false);
}));
