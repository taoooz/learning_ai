// tests/v1-sunset-course-flow.test.ts
// V1 学习流下线后的课程入口集成测试：系统课程 / TOC 建课 → V2 容器 → 首页列表 → 删除。
// 在内存 localStorage 上跑真实存储链路（local 模式），覆盖首页与课程页依赖的全部读写函数。

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSystemCourseV2, getSystemCourseRecommendations } from '../lib/data/system-courses';
import { createAndSaveStoredCourseV2, loadRenderableStoredCourse } from '../lib/learning-v2/dispatch';
import {
  deleteCourseV2,
  getCourseTopicV2,
  listCoursesV2,
  toCourseListEntry,
} from '../lib/learning-v2/course-list';
import { mapTocToBlueprintV2 } from '../lib/learning-v2/blueprint-map';
import { validateCourseBlueprintV2 } from '../lib/learning-v2/validators';
import { createStoredCourseV2, deriveCourseTreeViewV2 } from '../lib/learning-v2/storage';
import { getV2ChapterStorageKey } from '../lib/storage';
import { setLessonRepository, type LessonRepository } from '../lib/learning-v2/lesson-repository';

function withMemoryStorage(run: (store: Map<string, string>) => Promise<void> | void) {
  return async () => {
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
    const g = globalThis as { window?: unknown; localStorage?: unknown };
    const originalWindow = g.window;
    const originalLocalStorage = g.localStorage;
    g.window = { localStorage: fakeStorage, dispatchEvent: () => true };
    g.localStorage = fakeStorage;
    try {
      await run(store);
    } finally {
      if (originalWindow === undefined) delete g.window; else g.window = originalWindow;
      if (originalLocalStorage === undefined) delete g.localStorage; else g.localStorage = originalLocalStorage;
    }
  };
}

test('每门系统推荐课程都能映射为通过校验的 V2 蓝图', () => {
  for (const { courseId } of getSystemCourseRecommendations()) {
    const course = createSystemCourseV2(courseId);
    assert.ok(course, `${courseId} 应可映射`);
    const validation = validateCourseBlueprintV2(course.blueprint);
    assert.equal(validation.passed, true, `${courseId} 校验失败：${validation.issues.join('；')}`);
    // 章节 index 为 1 基，章节树按 index - 1 渲染节点数字
    assert.deepEqual(course.blueprint.chapters.map((c) => c.index), [1, 2, 3, 4]);
  }
});

test('系统课程启动后出现在首页列表并可被课程页读取', withMemoryStorage(async () => {
  const course = createSystemCourseV2('system-personal-finance');
  assert.ok(course);
  assert.equal(await createAndSaveStoredCourseV2(course), true);

  const list = listCoursesV2();
  assert.equal(list.length, 1);
  assert.equal(list[0].courseId, 'system-personal-finance');
  assert.equal(list[0].percent, 0);
  assert.equal(list[0].nextChapterTitle, '资产配置与再平衡');

  const resolved = await loadRenderableStoredCourse('system-personal-finance');
  assert.ok(resolved);
  assert.equal(resolved?.treeView.chapters[0].status, 'available');
  assert.equal(getCourseTopicV2('system-personal-finance'), '实战投资进阶课');
}));

test('重复启动同一门系统课程不会产生重复条目', withMemoryStorage(async () => {
  const first = createSystemCourseV2('system-ai-for-everyone');
  const second = createSystemCourseV2('system-ai-for-everyone');
  assert.ok(first && second);
  await createAndSaveStoredCourseV2(first);
  await createAndSaveStoredCourseV2(second);
  assert.equal(listCoursesV2().length, 1);
}));

test('TOC 生成结果只落入当前 V2 课程容器', withMemoryStorage(async (store) => {
  const courseId = 'course-toc-1';
  const blueprint = mapTocToBlueprintV2({
    courseId,
    courseName: 'Agent 入门',
    description: '理解 Agent 的基本结构',
    nodes: [
      { index: 1, title: '什么是 Agent', description: '建立 Agent 的基本框架' },
      { index: 2, title: '工具调用', description: '理解工具调用机制' },
    ],
    outline: {
      topic: 'Agent',
      learningGoal: '转型 AI 产品经理',
      learnerPositioning: { estimatedLevel: '初级' },
    },
  });
  assert.equal(validateCourseBlueprintV2(blueprint).passed, true);
  assert.equal(await createAndSaveStoredCourseV2(createStoredCourseV2(courseId, blueprint)), true);

  const [raw] = [...store.values()];
  const persisted = JSON.parse(raw) as Record<string, unknown> & { v2Courses: unknown[] };
  assert.equal('courses' in persisted, false, '不得保留 V1 courses 字段');
  assert.equal('currentCourseId' in persisted, false, '不得保留 V1 当前课程字段');
  assert.equal('courseProgress' in persisted, false, '不得保留 V1 节点进度字段');
  assert.equal(persisted.v2Courses.length, 1);
}));

test('删除课程同时清理章节学习流 key', withMemoryStorage(async (store) => {
  const course = createSystemCourseV2('system-ai-for-everyone');
  assert.ok(course);
  await createAndSaveStoredCourseV2(course);
  const chapterKey = getV2ChapterStorageKey(course.courseId, course.blueprint.chapters[0].chapterId);
  store.set(chapterKey, '{}');

  await deleteCourseV2(course.courseId);

  assert.equal(listCoursesV2().length, 0);
  assert.equal(store.has(chapterKey), false);
  assert.equal(await loadRenderableStoredCourse(course.courseId), null);
}));

test('课程列表进度按已完成章节计算，全部完成时无下一章', () => {
  const course = createSystemCourseV2('system-ai-for-everyone', 1000);
  assert.ok(course);
  const ids = course.blueprint.chapters.map((c) => c.chapterId);

  const half = toCourseListEntry({ ...course, treeView: deriveCourseTreeViewV2(course.courseId, course.blueprint, ids.slice(0, 2)) });
  assert.equal(half.percent, 50);
  assert.equal(half.nextChapterTitle, 'Agent与工具调用');

  const done = toCourseListEntry({ ...course, treeView: deriveCourseTreeViewV2(course.courseId, course.blueprint, ids) });
  assert.equal(done.percent, 100);
  assert.equal(done.nextChapterTitle, null);
});

test('server 模式删除课程会先删服务端再清本地缓存', withMemoryStorage(async () => {
  const previousMode = process.env.NEXT_PUBLIC_LESSON_STORE;
  process.env.NEXT_PUBLIC_LESSON_STORE = 'server';
  const deleted: string[] = [];
  const repository: LessonRepository = {
    loadCourse: async () => null,
    saveCourse: async () => true,
    deleteCourse: async (courseId) => {
      deleted.push(courseId);
      return true;
    },
    loadLesson: async () => null,
    saveLesson: async () => ({ saved: true, archivedChapterIds: [] }),
    appendEngagement: async () => {},
  };
  setLessonRepository(repository);

  try {
    const course = createSystemCourseV2('system-personal-finance');
    assert.ok(course);
    // 先写入本地缓存，模拟 server 模式创建后的本地镜像。
    await createAndSaveStoredCourseV2(course);
    await deleteCourseV2(course.courseId);
    assert.deepEqual(deleted, [course.courseId]);
    assert.equal(listCoursesV2().length, 0);
  } finally {
    if (previousMode === undefined) delete process.env.NEXT_PUBLIC_LESSON_STORE;
    else process.env.NEXT_PUBLIC_LESSON_STORE = previousMode;
    setLessonRepository(null);
  }
}));
