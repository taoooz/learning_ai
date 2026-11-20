// tests/learning-v2-lesson-repository.test.ts
// P5.1 存储抽象层：LocalLessonRepository 包装现有行为（load/save/roundtrip）

import test from 'node:test';
import assert from 'node:assert/strict';

import { LocalLessonRepository } from '../lib/learning-v2/lesson-repository';
import { createStoredCourse } from '../lib/learning-v2/storage';
import { mapTocToBlueprint } from '../lib/learning-v2/blueprint-map';
import type { CourseBlueprint, StoredCourse } from '../types/learning-v2';

/** 安装 window/localStorage 全局（与 protocol.test 同模式），返回还原函数 */
function installBrowserGlobals(): () => void {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => map.clear(),
  };
  const g = globalThis as Record<string, unknown>;
  const hadWindow = 'window' in g;
  const hadLocalStorage = 'localStorage' in g;
  const prevWindow = g.window;
  const prevLocalStorage = g.localStorage;
  g.localStorage = storage;
  g.window = { localStorage: storage, dispatchEvent: () => true };
  return () => {
    if (hadWindow) g.window = prevWindow;
    else delete g.window;
    if (hadLocalStorage) g.localStorage = prevLocalStorage;
    else delete g.localStorage;
  };
}

function makeBlueprint(): CourseBlueprint {
  return mapTocToBlueprint({
    courseId: 'repo-course-1',
    courseName: '测试课程',
    description: '完成课程仓库往返测试',
    nodes: [{ index: 1, title: '第一章', description: '理解测试概念' }],
    outline: {
      topic: '测试课程',
      learningGoal: '完成仓库往返测试',
      learnerPositioning: { estimatedLevel: 'beginner' },
    },
  });
}

test('LocalLessonRepository: saveCourse → loadCourse roundtrip', async () => {
  const restore = installBrowserGlobals();
  try {
    const repo = new LocalLessonRepository();
    const blueprint = makeBlueprint();
    const course: StoredCourse = createStoredCourse('repo-course-1', blueprint);
    const saved = await repo.saveCourse(course);
    assert.equal(saved, true, '保存课程应成功');

    const loaded = await repo.loadCourse(course.courseId);
    assert.ok(loaded);
    assert.equal(loaded.courseId, course.courseId);
  } finally {
    restore();
  }
});

test('LocalLessonRepository: loadCourse 不存在 → null', async () => {
  const repo = new LocalLessonRepository();
  const loaded = await repo.loadCourse('nonexistent-course-xyz');
  assert.equal(loaded, null);
});
