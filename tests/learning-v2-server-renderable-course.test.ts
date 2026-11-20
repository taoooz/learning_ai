// server 模式数据源回归：课程读取、treeView 自愈和章节完成必须走同一仓库边界。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  completeChapterV2,
  isSameCourseTreeView,
} from '../lib/learning-v2/chapter-complete';
import { createAndSaveStoredCourseV2, loadRenderableStoredCourse } from '../lib/learning-v2/dispatch';
import { setLessonRepository, ServerLessonRepository, type LessonRepository } from '../lib/learning-v2/lesson-repository';
import { createStoredCourseV2 } from '../lib/learning-v2/storage';
import type { EngagementEvent } from '../lib/learning-v2/engagement';
import type {
  CourseBlueprintV2,
  NodeLessonV2,
  StoredCourseV2,
} from '../types/learning-v2';

const META = { promptVersion: 'v1', modelVersion: 'test', generatedAt: 1, durationMs: 1, degraded: false };

function makeCourse(): StoredCourseV2 {
  const blueprint = {
    courseId: 'server-course-1',
    topic: '服务端课程',
    learnerStartingPoint: '入门',
    skipBasics: [],
    chapters: [
      {
        chapterId: 'ch-1', index: 1, title: '第一章',
        teachingGoal: '目标一', objectiveIds: ['obj-1'], conceptKeys: [],
        prerequisites: [], status: 'planned', evidencePolicy: 'none',
      },
      {
        chapterId: 'ch-2', index: 2, title: '第二章',
        teachingGoal: '目标二', objectiveIds: ['obj-2'], conceptKeys: [],
        prerequisites: ['ch-1'], status: 'planned', evidencePolicy: 'none',
      },
    ],
    learningObjectives: [
      { objectiveId: 'obj-1', description: '理解一', mustCover: true, conceptKeys: [] },
      { objectiveId: 'obj-2', description: '理解二', mustCover: true, conceptKeys: [] },
    ],
    generationMeta: META,
  } as unknown as CourseBlueprintV2;
  return createStoredCourseV2('server-course-1', blueprint, 1000);
}

class FakeLessonRepository implements LessonRepository {
  courses = new Map<string, StoredCourseV2>();
  lessons = new Map<string, NodeLessonV2>();

  async loadCourse(courseId: string): Promise<StoredCourseV2 | null> {
    return this.courses.get(courseId) ?? null;
  }

  async saveCourse(course: StoredCourseV2): Promise<boolean> {
    this.courses.set(course.courseId, course);
    return true;
  }

  async deleteCourse(courseId: string): Promise<boolean> {
    return this.courses.delete(courseId);
  }

  async loadLesson(courseId: string, chapterId: string): Promise<NodeLessonV2 | null> {
    return this.lessons.get(`${courseId}:${chapterId}`) ?? null;
  }

  async saveLesson(
    courseId: string,
    chapterId: string,
    lesson: NodeLessonV2,
  ): Promise<{ saved: boolean; archivedChapterIds: string[] }> {
    this.lessons.set(`${courseId}:${chapterId}`, lesson);
    return { saved: true, archivedChapterIds: [] };
  }

  async appendEngagement(_courseId: string, _events: EngagementEvent[]): Promise<void> {}
}

function withServerMode<T>(run: () => Promise<T>): Promise<T> {
  const previousMode = process.env.NEXT_PUBLIC_LESSON_STORE;
  process.env.NEXT_PUBLIC_LESSON_STORE = 'server';
  return run().finally(() => {
    if (previousMode === undefined) delete process.env.NEXT_PUBLIC_LESSON_STORE;
    else process.env.NEXT_PUBLIC_LESSON_STORE = previousMode;
    setLessonRepository(null);
  });
}

test('server 模式：课程读取时按章节事实自愈 treeView', async () => {
  await withServerMode(async () => {
    const repository = new FakeLessonRepository();
    const course = makeCourse();
    repository.courses.set(course.courseId, course);
    repository.lessons.set(`${course.courseId}:ch-1`, {
      runtime: { status: 'completed' },
    } as NodeLessonV2);
    setLessonRepository(repository);

    const result = await loadRenderableStoredCourse(course.courseId);
    assert.ok(result);
    assert.equal(result.treeView.chapters[0].status, 'completed');
    assert.equal(result.treeView.chapters[1].status, 'available');
    assert.equal(repository.courses.get(course.courseId)?.treeView.chapters[0].status, 'completed');
  });
});

test('server 模式：章节完成更新服务端课程树并解锁下一章', async () => {
  await withServerMode(async () => {
    const repository = new FakeLessonRepository();
    const course = makeCourse();
    repository.courses.set(course.courseId, course);
    setLessonRepository(repository);

    const saved = await completeChapterV2(course.courseId, 'ch-1');
    assert.equal(saved, true);
    const refreshed = repository.courses.get(course.courseId);
    assert.ok(refreshed);
    assert.equal(refreshed.treeView.chapters[0].status, 'completed');
    assert.equal(refreshed.treeView.chapters[1].status, 'available');
  });
});

test('server 模式：课程创建成功后才写本地缓存', async () => {
  await withServerMode(async () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value); },
      removeItem: (key: string) => { map.delete(key); },
      clear: () => map.clear(),
    };
    const globalThisWithBrowser = globalThis as Record<string, unknown>;
    const previousWindow = globalThisWithBrowser.window;
    const previousLocalStorage = globalThisWithBrowser.localStorage;
    globalThisWithBrowser.localStorage = storage;
    globalThisWithBrowser.window = { localStorage: storage, dispatchEvent: () => true };

    try {
      const repository = new FakeLessonRepository();
      setLessonRepository(repository);
      const course = makeCourse();

      const saved = await createAndSaveStoredCourseV2(course);
      assert.equal(saved, true);
      assert.equal(repository.courses.has(course.courseId), true);
      assert.equal(map.size > 0, true);

      repository.saveCourse = async () => false;
      const failedCourse = { ...course, courseId: 'server-course-2' };
      const failed = await createAndSaveStoredCourseV2(failedCourse);
      assert.equal(failed, false);
      assert.equal(repository.courses.has(failedCourse.courseId), false);
    } finally {
      globalThisWithBrowser.window = previousWindow;
      globalThisWithBrowser.localStorage = previousLocalStorage;
    }
  });
});

test('treeView 自愈只在缓存漂移时产生变化', () => {
  const course = makeCourse();
  assert.equal(isSameCourseTreeView(course.treeView, course.treeView), true);
});

test('server 仓库：保存使用独立 expected revision，冲突返回服务端版本', async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    requests.push(body);
    if (body.expectUpdatedAt === 100) {
      return new Response(JSON.stringify({ ok: false, code: 'CONFLICT', serverUpdatedAt: 200 }), { status: 409 });
    }
    return new Response(JSON.stringify({ ok: true, saved: true, serverUpdatedAt: 300 }), { status: 200 });
  }) as typeof fetch;

  try {
    const repository = new ServerLessonRepository();
    const lesson = { updatedAt: 999 } as unknown as NodeLessonV2;
    const conflicted = await repository.saveLesson('course', 'ch-1', lesson, makeCourse().blueprint, 100);
    assert.equal(conflicted.saved, false);
    assert.equal(conflicted.conflict, true);
    assert.equal(conflicted.serverUpdatedAt, 200);

    const saved = await repository.saveLesson('course', 'ch-1', lesson, makeCourse().blueprint, 200);
    assert.equal(saved.saved, true);
    assert.equal(saved.serverUpdatedAt, 300);
    assert.deepEqual(requests.map((request) => request.expectUpdatedAt), [100, 200]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('server 仓库：删除课程走 DELETE 并透传 courseId', async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ input: unknown; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ ok: true, existed: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const repository = new ServerLessonRepository();
    assert.equal(await repository.deleteCourse('course/删除?'), true);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].input,
      `/api/user/courses?courseId=${encodeURIComponent('course/删除?')}`,
    );
    assert.equal(calls[0].init?.method, 'DELETE');

    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    assert.equal(await repository.deleteCourse('course'), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
