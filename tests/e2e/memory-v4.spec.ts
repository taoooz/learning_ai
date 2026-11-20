import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ACCOUNT = 'eeee-eeee-eeee';
const BASE_URL = 'http://127.0.0.1:3000';
const SEED_FILE = path.join('/tmp', 'learning-ai-e2e-seed.json');

interface Seed {
  account: string;
  courseId: string;
  chapterId: string;
  checkpointId: string;
  remediationCheckpointId: string;
  checkpointPrompt: string;
  remediationPrompt: string;
  explicitMemoryId: string;
  repeatedMemoryId: string;
  teachingMemoryId: string;
  deleteMemoryId: string;
}

function loadSeed(): Seed {
  return JSON.parse(readFileSync(SEED_FILE, 'utf8')) as Seed;
}

test.describe.configure({ mode: 'serial' });
test.describe('Memory V4 server-mode E2E', () => {
  let seed: Seed;

  test.beforeAll(() => {
    execFileSync(path.resolve('python-agent/.venv/bin/python'), ['scripts/seed_e2e.py'], {
      cwd: path.resolve('python-agent'),
      stdio: 'pipe',
    });
    seed = loadSeed();
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([{
      name: 'ai-learning-auth',
      value: ACCOUNT,
      url: BASE_URL,
      httpOnly: true,
      sameSite: 'Lax',
    }]);
  });

  test('server boot、Checkpoint、补救与刷新恢复', async ({ page }) => {
    await page.goto(`/course/${seed.courseId}/chapter/${seed.chapterId}`);
    await expect(page.getByRole('heading', { name: 'E2E：ETag 与 Last-Modified' })).toBeVisible();
    await expect(page.getByText(seed.checkpointPrompt)).toBeVisible();

    const original = page.locator(`section[data-checkpoint-id="${seed.checkpointId}"]`);
    await original.locator('input[type="radio"]').first().check();
    const wrongEvaluation = page.waitForResponse((response) =>
      response.url().includes('/api/learning/v2/checkpoints/evaluate')
      && response.request().method() === 'POST',
    );
    await original.getByRole('button', { name: '提交答案' }).click();
    expect((await wrongEvaluation).ok()).toBeTruthy();
    await expect(original.getByText('✗ 回答不正确')).toBeVisible();

    await page.route('**/api/learning/v2/checkpoints/remediate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          remediationContent: 'E2E 补救讲解：ETag 在场时只认指纹，Last-Modified 只在指纹缺席时兜底。',
          newCheckpoint: {
            checkpointId: seed.remediationCheckpointId,
            objectiveId: 'obj-1',
            taskId: 't1',
            conceptKeys: ['ETag', 'Last-Modified'],
            kind: 'scenario_choice',
            prompt: seed.remediationPrompt,
            options: [
              { id: 'a', text: 'A. 优先校验 Last-Modified' },
              { id: 'b', text: 'B. 优先校验 If-None-Match' },
              { id: 'c', text: 'C. 两个都不校验' },
              { id: 'd', text: 'D. 随机选择' },
            ],
            remediationHint: 'ETag 优先。',
            estimatedSeconds: 45,
            sourceRefs: [],
          },
          remediationId: 'rem-e2e-ui',
        }),
      });
    });
    await original.getByRole('button', { name: '获取补救内容并重试' }).click();
    await expect(page.getByText('E2E 补救讲解：ETag 在场时只认指纹，Last-Modified 只在指纹缺席时兜底。')).toBeVisible();

    const remediated = page.locator('section').filter({ hasText: seed.remediationPrompt }).first();
    await expect(remediated.getByText(seed.remediationPrompt)).toBeVisible();
    await remediated.locator('input[type="radio"]').nth(1).check();
    const correctEvaluation = page.waitForResponse((response) =>
      response.url().includes('/api/learning/v2/checkpoints/evaluate')
      && response.request().method() === 'POST',
    );
    await remediated.getByRole('button', { name: '提交答案' }).click();
    expect((await correctEvaluation).ok()).toBeTruthy();
    await expect(remediated.getByText('✓ 回答正确')).toBeVisible();

    await expect.poll(async () => {
      const response = await page.request.get(`/api/user/lessons?courseId=${seed.courseId}&chapterId=${seed.chapterId}`);
      if (!response.ok()) return false;
      const body = await response.json();
      const checkpoint = (body.lesson?.streamItems ?? []).find(
        (item: { type?: string; checkpoint?: { checkpointId?: string }; evaluation?: { correct?: boolean } }) =>
          item.type === 'checkpoint'
          && item.checkpoint?.checkpointId === seed.remediationCheckpointId,
      );
      return checkpoint?.evaluation?.correct === true;
    }, { timeout: 20_000 }).toBe(true);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'E2E：ETag 与 Last-Modified' })).toBeVisible();
    const afterReload = page.locator('section').filter({ hasText: seed.remediationPrompt }).first();
    await expect(afterReload.getByText('✓ 回答正确')).toBeVisible();
    await expect(page.getByRole('button', { name: '完成本章' })).toBeEnabled();
  });

  test('Chat Summary、Candidate 来源、Memory 编辑与删除', async ({ page }) => {
    const summaryResponse = await page.request.post('/api/user/memory/chat-summary', {
      data: { courseId: seed.courseId },
    });
    expect(summaryResponse.ok()).toBeTruthy();
    const summaryBody = await summaryResponse.json();
    expect(summaryBody.summary.sourceRefs[0]).toEqual({
      type: 'user_message',
      conversationId: `course:${seed.courseId}`,
      messageId: 'e2e-chat-1',
    });

    await page.goto('/profile');
    await expect(page.getByText('ETag 与 Last-Modified 优先级')).toBeVisible();

    const preferences = page.locator('[data-memory-dimension="preferences"]');
    await expect(preferences).toBeVisible();
    await preferences.getByRole('button', { name: /查看 \d+ 条原始事实/ }).click();

    const explicit = page.locator('article').filter({ hasText: 'E2E 分步骤偏好' }).first();
    await expect(explicit.getByText('你的明确表达', { exact: true })).toBeVisible();
    await expect(explicit.getByText(/包含重复行为证据/)).toBeVisible();

    const teaching = page.locator('[data-memory-dimension="teaching"]');
    await teaching.getByRole('button', { name: /查看 \d+ 条原始事实/ }).click();
    await expect(teaching.locator('article').filter({ hasText: 'llm-remediation-v1' }).first()).toBeVisible();

    const history = page.locator('[data-memory-dimension="history"]');
    await history.getByRole('button', { name: /查看 \d+ 条原始事实/ }).click();
    await expect(history.locator('article').filter({ hasText: '课程对话摘要' }).first()).toContainText('讨论了：');

    await preferences.getByRole('button', { name: /查看 \d+ 条原始事实/ }).click();
    const explicitForEdit = page.locator('article').filter({ hasText: 'E2E 分步骤偏好' }).first();
    await expect(explicitForEdit.getByText(/包含重复行为证据/)).toBeVisible();
    await explicitForEdit.getByRole('button', { name: '编辑' }).click();
    const editBox = page.getByLabel('修改原始事实');
    await editBox.fill('E2E 分步骤偏好已修正');
    const saveResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/user/memory/records/${seed.explicitMemoryId}`)
      && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存修改' }).click();
    expect((await saveResponse).ok()).toBeTruthy();
    await expect(page.locator('article').filter({ hasText: 'E2E 分步骤偏好已修正' }).first()).toBeVisible();

    await page.reload();
    const preferencesAfterReload = page.locator('[data-memory-dimension="preferences"]');
    await preferencesAfterReload.getByRole('button', { name: /查看 \d+ 条原始事实/ }).click();
    await expect(page.locator('article').filter({ hasText: 'E2E 分步骤偏好已修正' }).first()).toBeVisible();

    page.once('dialog', async (dialog) => dialog.accept());
    const deletable = preferencesAfterReload.locator('article').filter({ hasText: 'E2E 临时删除记忆' }).first();
    await deletable.getByRole('button', { name: '删除' }).click();
    await expect(preferencesAfterReload.locator('article').filter({ hasText: 'E2E 临时删除记忆' })).toHaveCount(0);

    const storeResponse = await page.request.get('/api/user/memory');
    expect(storeResponse.ok()).toBeTruthy();
    const store = await storeResponse.json();
    const deleted = (store.store.records ?? []).find(
      (record: { memoryId?: string; status?: string }) => record.memoryId === seed.deleteMemoryId,
    );
    expect(deleted?.status).toBe('tombstoned');
  });
});
